import { relay } from "../../../../lib/relay";

// Next.js route segment config must be statically analyzable literals, not
// imported references — RECOMMENDED_MAX_DURATION (10s) from the package is
// documented as the value to use, not importable here.
export const runtime = "nodejs";
export const maxDuration = 10;

export const POST = relay.createCollectHandler();
