/**
 * AC28: the client SDK (main thread, on page load) calls
 * registration.unregister() directly — not solely relying on the SW's
 * own activate handler, which does not re-run on an unchanged script.
 */
export async function applyKillSwitch(enabled: boolean, scope: string): Promise<void> {
  if (enabled) return;
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  const registration = await navigator.serviceWorker.getRegistration(scope);
  if (registration) await registration.unregister();
}
