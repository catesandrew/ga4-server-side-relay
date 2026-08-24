// Background Sync API types are not part of TS's built-in lib.webworker.d.ts.
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
  readonly lastChance: boolean;
}

interface ServiceWorkerGlobalScopeEventMap {
  sync: SyncEvent;
}
