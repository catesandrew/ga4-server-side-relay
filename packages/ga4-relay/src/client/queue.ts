import type { ConsentSignal, Ga4Event, SignedCaptureIdentity } from "../shared/event.js";

const DB_NAME = "ga4_relay_queue";
const STORE_NAME = "events";
const CONFIG_STORE_NAME = "config";
const DB_VERSION = 2;
export const MAX_QUEUE_SIZE = 500;
export const QUEUE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 120_000;

/** Schema-versioned so a future field addition can migrate old records rather than silently misreading them. */
export interface QueuedRecord {
  schemaVersion: 1;
  id?: number;
  event: Ga4Event;
  capturedAt: number;
  identity: SignedCaptureIdentity;
  capturedConsentGranted: boolean;
  /** Retry scheduling (exponential backoff) — absent/0 on a freshly-enqueued record. */
  attempts?: number;
  nextAttemptAt?: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) {
        db.createObjectStore(CONFIG_STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Every operation opens a fresh connection (see the many `await
      // openDb()` call sites below) and never explicitly closed it, so an
      // old tab still on schema v1 could hold a connection open
      // indefinitely and block a v2 upgrade attempted elsewhere — hanging
      // that other context's queue/config reads with no error, no
      // timeout, nothing (codex critic review round 4, reproduced live).
      // Closing on `versionchange` lets a newer connection's upgrade
      // proceed instead of blocking on this one.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(record: Omit<QueuedRecord, "id">): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const countReq = store.count();
  await new Promise<void>((resolve, reject) => {
    countReq.onsuccess = () => resolve();
    countReq.onerror = () => reject(countReq.error);
  });
  if (countReq.result >= MAX_QUEUE_SIZE) {
    // Bounded FIFO, drop-oldest.
    const cursorReq = store.openCursor();
    await new Promise<void>((resolve, reject) => {
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) cursor.delete();
        resolve();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  }
  store.add({ attempts: 0, nextAttemptAt: record.capturedAt, ...record });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAll(): Promise<QueuedRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as QueuedRecord[]);
    req.onerror = () => reject(req.error);
  });
}

export async function remove(id: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Records a failed retryable attempt's exponential backoff (with jitter) for the next flush pass to respect. */
export async function scheduleRetry(record: QueuedRecord, now = Date.now(), minBackoffMs?: number): Promise<void> {
  if (record.id === undefined) return;
  const attempts = (record.attempts ?? 0) + 1;
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
  // Jitter applies to the exponential component only, THEN the server's
  // retryAfterMs floor is enforced — applying jitter after the max() could
  // pull the delay up to 25% below a floor the server explicitly asked for
  // (codex critic review round 2).
  const jittered = exponential * (0.75 + Math.random() * 0.5);
  const backoffMs = Math.max(jittered, minBackoffMs ?? 0);
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put({ ...record, attempts, nextAttemptAt: now + backoffMs });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** AC32: purges the entire queue on an explicit consent-denial signal. */
export async function purgeAll(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** AC13: drop queued records older than the 48h TTL. */
export function isExpired(record: QueuedRecord, now = Date.now()): boolean {
  return now - record.capturedAt > QUEUE_MAX_AGE_MS;
}

/**
 * Shared config store (collectUrl, consent) — persisted here, not just in
 * `globalThis`, because the service worker runs in its own JS realm with
 * its own `self`/`globalThis` that the page's `window.__ga4RelayConsent`
 * (or any in-memory variable set via postMessage) never reaches. IndexedDB
 * is the one storage both realms actually share (codex critic review: the
 * SW's Background Sync flushes were unconditionally no-op'ing because its
 * `self` never had consent set, and its in-memory collectUrl vanished
 * whenever the browser terminated and later restarted the worker).
 */
export interface PersistedConfig {
  collectUrl: string;
  consent: ConsentSignal;
}

export async function setConfigValue<K extends keyof PersistedConfig>(
  key: K,
  value: PersistedConfig[K],
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(CONFIG_STORE_NAME, "readwrite");
  tx.objectStore(CONFIG_STORE_NAME).put({ key, value });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getConfigValue<K extends keyof PersistedConfig>(
  key: K,
): Promise<PersistedConfig[K] | undefined> {
  const db = await openDb();
  const tx = db.transaction(CONFIG_STORE_NAME, "readonly");
  return new Promise((resolve, reject) => {
    const req = tx.objectStore(CONFIG_STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as { value: PersistedConfig[K] } | undefined)?.value);
    req.onerror = () => reject(req.error);
  });
}
