import { describe, expect, it } from "vitest";
import { extractClientIp, parseCookies, serializeSetCookie } from "./http.js";

describe("parseCookies", () => {
  it("parses a well-formed cookie header", () => {
    expect(parseCookies("a=1; b=2")).toEqual({ a: "1", b: "2" });
  });

  it("returns an empty object for a null header", () => {
    expect(parseCookies(null)).toEqual({});
  });

  it("skips a malformed percent-encoding instead of throwing (codex critic review round 4)", () => {
    // A bare "%" is not a valid percent-escape and throws URIError from
    // decodeURIComponent — a prior version let that crash the whole
    // request with a framework-level 500 before it even reached the
    // origin/token checks.
    expect(() => parseCookies("bad=%; good=1")).not.toThrow();
    expect(parseCookies("bad=%; good=1")).toEqual({ good: "1" });
  });
});

describe("serializeSetCookie", () => {
  it("includes the core directives", () => {
    const cookie = serializeSetCookie({
      name: "n",
      value: "v",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    });
    expect(cookie).toContain("n=v");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });
});

describe("extractClientIp", () => {
  it("takes the first hop of x-vercel-forwarded-for", () => {
    const headers = new Headers({ "x-vercel-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(extractClientIp(headers)).toBe("1.2.3.4");
  });

  it("returns undefined when the platform header is absent", () => {
    expect(extractClientIp(new Headers())).toBeUndefined();
  });
});
