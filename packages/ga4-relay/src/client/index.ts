export { createGa4Client, type Ga4ClientOptions } from "./client-sdk.js";
export { flushQueue } from "./flush.js";
export { purgeAll, getAll as getQueuedRecords } from "./queue.js";
export { getCurrentConsent, isCurrentlyDenied, onConsentChange } from "./consent-bridge.js";
export { applyKillSwitch } from "./kill-switch.js";
