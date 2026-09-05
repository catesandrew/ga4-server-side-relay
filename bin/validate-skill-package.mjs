#!/usr/bin/env node
// validate-skill-package — runs `pnpm pack --dry-run --json`, not `npm pack`.
// Under a pnpm workspace, @changesets/cli's getPublishTool() detects pnpm and
// spawns `pnpm publish` (not `npm publish`) from the package directory — so this
// validator previews the packer that will actually run. npm and pnpm disagree on
// nested-.gitignore/.npmignore handling, so this isn't cosmetic.
//
// Usage:
//   node bin/validate-skill-package.mjs --all
//   node bin/validate-skill-package.mjs <skill-name> [<skill-name> ...]
//
// Run this AFTER sync-skill-content.mjs. For each skill:
//   - runs `pnpm pack --dry-run --json` with cwd = packages/skill-<name>;
//   - parses the tarball file list (pnpm's JSON output is a single object with a
//     `files` array — NOT npm's array-of-objects shape);
//   - asserts every entry in the synced metadata.json.references resolves to a
//     real file (not a directory) in that list;
//   - asserts the synced metadata.json.version equals package.json.version (the
//     assertion that catches a stale mirror before anything ships).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const SKILLS_DIR = join(ROOT, 'skills')
const PACKAGES_DIR = join(ROOT, 'packages')

function fail(msg) {
  console.error(`\n  error: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { all: false, names: [] }
  for (const a of argv) {
    if (a === '--all') args.all = true
    else if (a.startsWith('-')) fail(`unrecognized argument: ${a}`)
    else args.names.push(a)
  }
  if (!args.all && args.names.length === 0) {
    fail('pass --all or one or more <skill-name> arguments')
  }
  return args
}

function listSkillNames() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(SKILLS_DIR, name, 'SKILL.md')))
    .sort()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function packedFiles(pkgDir) {
  const raw = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
    cwd: pkgDir,
    encoding: 'utf8',
  })
  // pnpm pack --json: a single object with a `files` array of { path, ... }.
  const parsed = JSON.parse(raw)
  return new Set((parsed.files ?? []).map((f) => f.path))
}

function validateOne(name) {
  const pkgDir = join(PACKAGES_DIR, `skill-${name}`)
  const problems = []

  if (!existsSync(pkgDir)) {
    return [`packages/skill-${name} does not exist — run sync-skill-content.mjs first`]
  }

  const files = packedFiles(pkgDir)
  const metadataPath = join(pkgDir, 'metadata.json')
  const pkgJsonPath = join(pkgDir, 'package.json')

  if (!existsSync(metadataPath)) return [`${name}: no synced metadata.json`]
  const metadata = readJson(metadataPath)
  const pkg = readJson(pkgJsonPath)

  for (const ref of metadata.references ?? []) {
    if (!files.has(ref)) {
      problems.push(`${name}: metadata.json references "${ref}" but it is not in the tarball`)
      continue
    }
    const full = join(pkgDir, ref)
    if (existsSync(full) && statSync(full).isDirectory()) {
      problems.push(`${name}: metadata.json reference "${ref}" is a directory, not a file`)
    }
  }

  if (metadata.version !== pkg.version) {
    problems.push(
      `${name}: metadata.json.version (${metadata.version}) !== package.json.version (${pkg.version})`,
    )
  }

  return problems
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const names = args.all ? listSkillNames() : args.names
  const allProblems = names.flatMap(validateOne)

  if (allProblems.length) {
    console.error('validate-skill-package failed:')
    for (const p of allProblems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log(`validate-skill-package passed (${names.length} package(s)).`)
}

main()
