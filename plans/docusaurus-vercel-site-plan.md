# Docusaurus site under `website/`, deployed via Vercel

Status: **pending approval**

## Requirements Summary

Scaffold a standalone Docusaurus (classic, TypeScript) site under `website/`
at repo root, isolated from the root pnpm workspace via its own
`pnpm-workspace.yaml`, configured for Vercel git-integration deployment
(no `vercel.json`, no CI workflow — Vercel builds on push). Migrate existing
public-facing content (root `README.md` install/wiring guide, `docs/spikes/*`
verification write-ups) into the site instead of leaving Docusaurus's default
placeholder docs/blog. Confirm the dev server runs locally before calling
this done.

Decisions locked in by the user before this plan was written:
- **Domain**: no custom domain yet — use the default `*.vercel.app` URL as a
  placeholder in `docusaurus.config.ts`, noted as TBD until the first `vercel
  link`/deploy assigns the real subdomain.
- **Content mapping**: root `README.md` → docs pages; `docs/spikes/*.md`
  (5 files, all dated 2026-08-24 per `git log`) → blog posts, since they're
  chronological retrospective write-ups (M0.1–M0.4 + the Playwright e2e
  spike) that match the blog's dated-post format better than the docs
  sidebar. `docs/sessions/*` (internal session dossiers) stay internal —
  not migrated.

Facts gathered from the repo (not to be re-asked):
- GitHub remote: `catesandrew/ga4-server-side-relay` (`git remote -v`) →
  `organizationName: "catesandrew"`, `projectName: "ga4-server-side-relay"`.
- Root `pnpm-workspace.yaml` currently: `packages: ["packages/*", "apps/*"]`
  — `website/` must NOT be added to this list (isolation requirement).
- Root `.gitignore` has no `.vercel` entry today.
- Root `package.json` has no top-level `packageManager` conflict for a
  nested workspace (`website/` gets its own `pnpm-workspace.yaml`, so pnpm
  treats it as a separate workspace root — confirmed this is pnpm's
  documented nested-workspace behavior: the closest `pnpm-workspace.yaml`
  going up from a package's directory wins).
- `docs/spikes/*.md` source files and their spike IDs:
  `mp-fidelity.md` (M0.1), `sw-beacon-capture.md` (M0.2),
  `first-party-mode.md` (M0.3), `safari-itp-observation.md` (M0.4),
  `playwright-browser-e2e.md` (AC14/AC16/AC27, unblocked).

## Acceptance Criteria

1. `website/` exists with a working Docusaurus classic+TypeScript scaffold
   (`website/docusaurus.config.ts`, `website/package.json`,
   `website/src/`, `website/docs/`, `website/blog/`).
2. `website/pnpm-workspace.yaml` exists (empty `packages:` list, or an
   explicit comment noting it's intentionally empty to isolate from root);
   root `pnpm-workspace.yaml` is unchanged (`git diff pnpm-workspace.yaml`
   shows no diff).
3. `website/docusaurus.config.ts` has: `title`/`tagline` describing this
   project (GA4 first-party server-side relay); `url` set to a placeholder
   `*.vercel.app` value with an inline comment marking it TBD; `baseUrl: '/'`;
   `organizationName: "catesandrew"`; `projectName: "ga4-server-side-relay"`;
   `onBrokenLinks: 'throw'`; `docs.editUrl` and `blog.editUrl` both
   `https://github.com/catesandrew/ga4-server-side-relay/tree/main/website/`;
   a navbar with docs-sidebar, blog, and GitHub links; a footer with
   getting-started, blog, and GitHub links.
4. No `website/vercel.json` and no `.vercel/project.json` exist in the repo
   (the latter is created only by a human running `vercel link`, never
   hand-written).
5. No new `.github/workflows/*.yml` is added for building/deploying the
   site.
6. `.vercel` is listed in both root `.gitignore` and `website/.gitignore`;
   `website/.gitignore` also covers `node_modules`, `build`, `.docusaurus`,
   and `.env.local`/`.env*.local` (create-docusaurus's defaults —
   confirmed once scaffolded, not assumed).
7. `website/docs/` contains pages derived from root `README.md`'s
   "Installing into your own Next.js app" + "Design notes worth knowing"
   sections (intro + a wiring guide), not the scaffold's default
   `tutorial-basics`/`tutorial-extras` placeholder pages.
8. `website/blog/` contains 5 posts, one per `docs/spikes/*.md` file, each
   with Docusaurus blog front matter (`slug`, `title`, `authors` or
   `author`, `tags`, `date: 2026-08-24`) and the original spike content
   preserved (status, what it blocks, verification approach).
9. `cd website && pnpm install && pnpm start` boots the dev server without
   error and serves the migrated docs/blog content (not placeholder
   content) at `http://localhost:3000`.
10. `cd website && pnpm build` (or `docusaurus build`) succeeds with
    `onBrokenLinks: 'throw'` active — i.e., the migrated content contains
    no broken internal links.

## Implementation Steps

1. **Scaffold.** From repo root:
   ```sh
   npx create-docusaurus@latest website classic --typescript
   ```
   Verify: `website/package.json`, `website/docusaurus.config.ts`,
   `website/tsconfig.json` exist; `website/docs/intro.md` and
   `website/blog/2019-05-28-first-blog-post.md`-style placeholders present
   (to be replaced in step 4).

2. **Isolate the workspace.** Create `website/pnpm-workspace.yaml`:
   ```yaml
   packages: []
   ```
   Do not add `website` or `website/*` to the root `pnpm-workspace.yaml`'s
   `packages` list. Verify: `git diff pnpm-workspace.yaml` (root) shows no
   changes; `pnpm -C website list --depth -1` resolves against
   `website/pnpm-workspace.yaml`, not the root one.

3. **Configure `website/docusaurus.config.ts`.** Set, at minimum:
   - `title`: `"GA4 Server-Side Relay"` (or similarly descriptive of the
     repo's actual purpose — first-party GA4 MP v2 relay for Next.js/Vercel)
   - `tagline`: one line matching root `README.md`'s opening description
   - `url`: a placeholder like `"https://ga4-server-side-relay.vercel.app"`
     with a `// TODO:` comment noting this must be updated to match
     whatever subdomain/custom domain Vercel actually assigns after first
     deploy (confirm via `vercel link` output or the Vercel dashboard)
   - `baseUrl: '/'`
   - `organizationName: "catesandrew"`, `projectName: "ga4-server-side-relay"`
   - `onBrokenLinks: 'throw'`
   - `presets[0][1].docs.editUrl` and `.blog.editUrl`:
     `"https://github.com/catesandrew/ga4-server-side-relay/tree/main/website/"`
   - `themeConfig.navbar.items`: a docs sidebar link (`type: 'docSidebar'`),
     a `{ to: '/blog', label: 'Blog' }` link, and a GitHub link
     (`href: 'https://github.com/catesandrew/ga4-server-side-relay'`)
   - `themeConfig.footer.links`: a "Docs" column linking to the
     getting-started/intro doc, a "Blog" column linking to `/blog`, and a
     GitHub link
   Verify: `pnpm -C website exec tsc --noEmit` (or the site's own build)
   type-checks `docusaurus.config.ts` cleanly.

4. **Migrate content, replacing scaffold placeholders.**
   - Docs: remove `website/docs/tutorial-basics/` and
     `website/docs/tutorial-extras/`; add `website/docs/intro.md` (adapted
     from root `README.md`'s "What this is" section) and
     `website/docs/installation.md` (adapted from "Installing into your
     own Next.js app" — the 5 numbered wiring steps: route handler,
     middleware, service worker, client, CMP contract) and
     `website/docs/design-notes.md` (adapted from "Design notes worth
     knowing before you deploy"). Update `website/sidebars.ts` accordingly.
   - Blog: remove the two scaffolded placeholder posts under
     `website/blog/`; add one post per `docs/spikes/*.md` file
     (`mp-fidelity`, `sw-beacon-capture`, `first-party-mode`,
     `safari-itp-observation`, `playwright-browser-e2e`), each with
     Docusaurus front matter (`date: 2026-08-24`, a `tags` array e.g.
     `[verification, spike]`) and the original content preserved.
   - Do not delete the source `docs/spikes/*.md` files at repo root during
     this pass — they stay as the internal engineering record; the
     website's blog posts are copies, not a move, unless you'd rather
     symlink (flagged as an open question below).
   Verify: `pnpm -C website start` renders the new docs sidebar and blog
   index with the migrated titles, not "Tutorial Basics"/placeholder blog
   titles.

5. **Gitignore.** Add `.vercel` to root `.gitignore`. Confirm
   `website/.gitignore` (written by `create-docusaurus`) already covers
   `.vercel`, `node_modules`, `build`, `.docusaurus`, `.env.local`; add any
   missing entries explicitly rather than assuming the scaffold covers
   everything.
   Verify: `git check-ignore -v website/.vercel/project.json` (simulated —
   file won't exist yet) and `.vercel` (root) both resolve to a gitignore
   rule.

6. **No `vercel.json`, no CI workflow.** Confirm neither is created in
   this pass. Tell the user to run `vercel link` from `website/` (or
   connect the repo via the Vercel dashboard, setting root directory =
   `website/`, framework preset = Docusaurus, build command / output dir =
   defaults) so `.vercel/project.json` is created by Vercel's own CLI —
   never hand-write it.
   Verify: `test ! -f website/vercel.json` and
   `test ! -f .github/workflows/*.yml` referencing `website`/docusaurus
   both hold true after this pass.

7. **Local verification.** From repo root:
   ```sh
   cd website && pnpm install && pnpm start
   ```
   (or `pnpm --filter` isn't applicable here since `website/` is
   intentionally its own pnpm workspace root, not a member of the root
   workspace — so `cd website && pnpm start` is the correct invocation,
   not `pnpm --filter website start` from root.) Confirm the dev server
   boots on `http://localhost:3000` and serves migrated content. Then run
   `pnpm build` to confirm `onBrokenLinks: 'throw'` passes with no broken
   links introduced by the migration.

## Risks and Mitigations

- **Risk**: `create-docusaurus@latest` scaffolds a slightly different file
  layout/config shape than assumed here (Docusaurus versions drift).
  **Mitigation**: step 1 is run for real before step 3 is written into
  actual files — the plan's config snippet is adapted to whatever the
  installed version actually generates, not pasted blind over it.
- **Risk**: nested `pnpm-workspace.yaml` isolation doesn't behave as
  expected (root tooling accidentally treats `website/` as a workspace
  member via `packages/*`/`apps/*` globs). **Mitigation**: root
  `pnpm-workspace.yaml` globs are `packages/*` and `apps/*` only —
  `website/` at repo root matches neither, so no glob collision; verified
  by inspecting the current root `pnpm-workspace.yaml` before this plan
  was written.
- **Risk**: placeholder `*.vercel.app` URL in `docusaurus.config.ts` is
  wrong once the real deploy happens, and nobody remembers to update it.
  **Mitigation**: the `// TODO:` comment plus explicit callout in this
  plan's acceptance criteria; flagged again in the final report when this
  plan executes.
- **Risk**: migrating `docs/spikes/*.md` as blog posts front-matters them
  with a specific date/tag scheme that doesn't match how the user actually
  wants the blog organized long-term. **Mitigation**: this is a reasonable
  default (dated, tagged retrospective posts) but is called out explicitly
  as a judgment call in this plan rather than silently assumed — open
  question below if the user wants a different scheme.
- **Risk**: `onBrokenLinks: 'throw'` breaks the build if migrated Markdown
  content has relative links that made sense in `docs/spikes/` or root
  `README.md` but don't resolve inside `website/docs/`or
  `website/blog/`. **Mitigation**: step 4's verify step explicitly runs
  `pnpm build` (not just `pnpm start`, which doesn't check broken links)
  before calling the migration done.

## Verification Steps

1. `cd website && pnpm install` — completes with no errors, using the
   nested `pnpm-workspace.yaml` (not root's).
2. `cd website && pnpm start` — dev server boots on port 3000; manually
   confirm (or via the `run` skill) that the docs sidebar shows
   Intro/Installation/Design Notes (not Tutorial Basics/Extras) and the
   blog index shows the 5 migrated spike posts (not the 2 placeholder
   posts).
3. `cd website && pnpm build` — succeeds with `onBrokenLinks: 'throw'`
   active; no broken-link errors.
4. `git status` — confirms root `pnpm-workspace.yaml` is unchanged, root
   `.gitignore` has a new `.vercel` line, no `website/vercel.json` or
   `.github/workflows/*docusaurus*`/`*website*` file exists.
5. Manual (human) step, not automatable here: run `vercel link` from
   `website/` (or connect via dashboard with root directory `website/`),
   confirm `.vercel/project.json` is created by Vercel's own tooling.

## Open Questions (flag, don't guess)

- Should `docs/spikes/*.md` be **copied** into `website/blog/` (leaving
  the originals in place as the internal record, current plan default) or
  **moved/symlinked** so there's a single source of truth? Symlinking blog
  posts is possible but non-standard for Docusaurus's front-matter
  requirements (the source files have no front matter today) — copying
  with added front matter is simpler and is what this plan assumes unless
  told otherwise.
- Exact wording for `title`/`tagline` in `docusaurus.config.ts` is drafted
  from root `README.md`'s opening line during execution; if you want
  different marketing copy, say so before/at execution time.

## Changelog

- Initial draft (direct mode, this session): incorporates user answers —
  domain placeholder = default `*.vercel.app`; content migration =
  README → docs, `docs/spikes/*` → blog posts, `docs/sessions/*` excluded.
