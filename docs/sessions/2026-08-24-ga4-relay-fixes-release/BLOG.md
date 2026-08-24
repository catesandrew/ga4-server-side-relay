<!--
PUBLIC blog post draft. ⚠ SANITIZE before publishing:
  - Remove client names, internal repo/package names, hostnames, ticket ids, secrets.
  - Generalize the setting ("a multi-tenant SaaS", "an internal infra monorepo").
  - When in doubt, leave it out. Ask the user before publishing anywhere.
  Keep it a story about the PROBLEM and the TECHNIQUE, not the proprietary system.

  ⚠ THIS DRAFT currently names a real personal domain used for live testing and a real,
  already-public npm package name. Both are already public (the package is published, the
  domain was deliberately chosen as a low-stakes personal test target), so this is lower-risk
  than a client engagement — but confirm with the author before publishing regardless, and
  consider whether to genericize the domain name specifically.
-->

# Two bugs my unit tests couldn't find — because they only existed in the real thing

*Mocking the boundary you're building hides exactly the bugs that live at that boundary.*

## The problem

I'd built a small open-source package: a self-hosted, first-party server-side relay for Google
Analytics 4's Measurement Protocol, meant to run on Next.js/Vercel. It had 165 passing unit and
integration tests, a mock HTTP server standing in for GA4's collect endpoint, and a service worker
tested against a stubbed script loader. Everything green. Published to npm.

Then I actually pointed it at a real GA4 property and a real browser. Two genuine bugs surfaced —
both in code paths my test suite had faithfully exercised, and both invisible precisely *because*
the tests mocked the one thing that mattered: the real external system.

## What I tried

**Bug one** lived in the payload sent to GA4's Measurement Protocol. My test suite asserted the
payload shape was correct — and it was, by my own definition of correct. GA4's own live debug
endpoint disagreed: it flagged a `NAME_DUPLICATED` validation error. I was sending both a manual
`session_id` field and a `ga_session_id` field, and GA4 canonicalizes the second into the same
internal slot as the first. My mock server had no opinion on this; the real one did.

```ts
// Before: two fields silently colliding, only GA4's real validator caught it
{
  session_id: sessionId,
  ga_session_id: sessionId,
  ga_session_number,
  engagement_time_msec: 1,
}
// After: only the field GA4 actually treats as canonical for web streams
{
  ga_session_id: sessionId,
  ga_session_number,
  engagement_time_msec: 1,
}
```

**Bug two** was worse: the README's own documented integration pattern was broken. The package
served its service worker script via a framework Route Handler, and the recommended way to locate
that script on disk was `createRequire(import.meta.url).resolve(...)`. Every unit test for that
handler passed a stubbed loader function — `() => "// sw script"` — so the *real* resolution logic
had never once executed. The first time a real browser hit that route (via a genuine end-to-end
test, not a mock), it 500'd. Every single time. In both dev and production.

The framework's bundler was intercepting `require.resolve()` inside the route module and handing
back a bundler-internal module identifier instead of a real filesystem path. `readFile()` on that
identifier throws. My mocked test proved the *handler factory* worked. It said nothing about
whether the *documented usage pattern* worked, because the documented pattern was never actually
run.

The fix took two more rounds of the same lesson. First attempt: give the handler a sensible
built-in default that reads its own bundled file. That *built*, but a real production build of
the consuming app started warning that a Node-only module was leaking into an Edge-runtime bundle
— because my bundler concatenates a whole module's reachable code into one output file, and I was
trusting tree-shaking to strip the unused fs-touching code out of a completely separate part of
the app that never even imported it. It didn't, reliably. Second attempt: physically separate the
file-reading code into its own build output, its own import path, so there's no shared file for
tree-shaking to get wrong in the first place. *Then* a leftover `new URL(...)` call threw a
bizarre `TypeError` — a different-realm `instanceof URL` mismatch specific to how the framework's
bundler wraps external packages — fixed by dropping the URL class entirely in favor of plain
string manipulation on the file path.

Three real bugs, chained, none of them visible from inside a mock.

## What I learned

- A mock at the boundary you're actually building proves your code handles *the mock's opinion*
  of the outside world, not the outside world's opinion of your code. If the whole point of a
  component is "talk correctly to system X," at least one test needs to talk to real system X.
- "It built successfully" and "it's actually correct" are different claims when a bundler is
  involved. A warning that doesn't fail the build is still real information — chase it down, don't
  dismiss it because the exit code was zero.
- Don't trust tree-shaking as a safety boundary between code that must run in two different
  runtimes (here: a full Node.js server vs. a restricted Edge runtime). If two code paths must
  never share a bundle, put them in physically separate build outputs and verify that with a real
  build of a real consumer — not by reasoning about what an optimizer *should* be able to prove.
- When a README shows a specific integration snippet, that snippet is a claim about behavior in a
  real target environment. If nothing in the test suite ever actually executes that exact snippet
  end-to-end, the README can be wrong for months without a single red test.

## Takeaways

- Keep at least one real, unmocked integration point per external boundary that matters — even
  a small one, run occasionally, is worth more than a hundred more assertions against a mock.
- Treat build warnings as findings, not noise, especially anything about runtime-incompatible
  code showing up somewhere it shouldn't.
- If your package's documentation includes a code snippet, that snippet needs its own test —
  copy it verbatim into an integration test rather than re-describing its intent in a mock.
- The bug that survives 165 green tests is usually hiding exactly where you stopped mocking and
  started assuming.

---

<!-- Suggested tags: testing, integration-testing, nextjs, bundlers, analytics · Est. reading time: 6 min · Cross-post targets: dev.to, personal blog -->
