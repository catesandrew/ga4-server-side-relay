import { describe, expect, it } from "vitest";
import { withGa4Token } from "./with-token-middleware.js";
import { TOKEN_COOKIE_NAME, verifyToken } from "./token.js";

describe("withGa4Token", () => {
  it("mints a fresh token when the request has none", async () => {
    const resolve = withGa4Token({ tokenSecret: "secret" });
    const req = new Request("https://example.com/api/ga4/collect", { headers: { origin: "https://example.com" } });
    const { token, cookie } = await resolve(req);
    expect(token).toBeTruthy();
    expect(cookie.name).toBe(TOKEN_COOKIE_NAME);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
  });

  it("passes an existing valid token through unchanged", async () => {
    const resolve = withGa4Token({ tokenSecret: "secret" });
    const req1 = new Request("https://example.com/api/ga4/collect", { headers: { origin: "https://example.com" } });
    const first = await resolve(req1);

    const req2 = new Request("https://example.com/api/ga4/collect", {
      headers: { origin: "https://example.com", cookie: `${TOKEN_COOKIE_NAME}=${first.token}` },
    });
    const second = await resolve(req2);
    expect(second.token).toBe(first.token);
  });

  it("the resolved token verifies against the same secret", async () => {
    const resolve = withGa4Token({ tokenSecret: "secret" });
    const req = new Request("https://example.com/api/ga4/collect", { headers: { origin: "https://example.com" } });
    const { token } = await resolve(req);
    const verified = await verifyToken(token, "secret");
    expect(verified.valid).toBe(true);
  });
});
