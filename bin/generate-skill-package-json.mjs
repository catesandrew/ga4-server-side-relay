#!/usr/bin/env node
// generate-skill-package-json — enumerate real skill directories (skills/<name>/
// counts only if it contains a SKILL.md) and keep packages/skill-<name>/package.json
// in sync with them. Private-by-default, allowlist-aware: never publishes anything
// itself — that's exclusively `changeset publish`, gated by the `private` flag this
// script manages plus docs/published-skills.json.
//
// Usage:
//   node bin/generate-skill-package-json.mjs [--scope @acme] [--check] [--publish <skill-name>]
//
//   --scope <@scope>   npm scope for new packages, e.g. "@acme" -> "@acme/skill-<name>".
//                       Required the first time a package.json is created; reused
//                       automatically from the existing package.json name on refresh.
//   --check             CI mode: asserts skills/* and packages/skill-* are the same
//                        set, and that every package's `private` flag matches its
//                        docs/published-skills.json membership. Exits non-zero and
//                        prints every mismatch; writes nothing.
//   --publish <name>     human-only, interactive: flips that package's `private` to
//                        false and appends it to docs/published-skills.json. Never
//                        invoked by CI, and this script never runs `npm publish` /
//                        `changeset publish` itself.
//
// With no flags: refreshes/creates every packages/skill-<name>/package.json from its
// skills/<name>/metadata.json. Never touches `name` on an existing package.json, and
// never writes `version` once a package has been enabled (private: false) — from
// that point, Changesets owns version exclusively.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const SKILLS_DIR = join(ROOT, 'skills')
const PACKAGES_DIR = join(ROOT, 'packages')
const ALLOWLIST_PATH = join(ROOT, 'docs', 'published-skills.json')

function fail(msg) {
  console.error(`\n  error: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { scope: null, check: false, publish: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--scope') args.scope = argv[++i]
    else if (a === '--check') args.check = true
    else if (a === '--publish') args.publish = argv[++i]
    else fail(`unrecognized argument: ${a}`)
  }
  if (args.check && args.publish) fail('--check and --publish are mutually exclusive')
  return args
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, obj) {
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`)
}

function listSkillNames() {
  if (!existsSync(SKILLS_DIR)) return []
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(SKILLS_DIR, name, 'SKILL.md')))
    .sort()
}

function listPackageSkillNames() {
  if (!existsSync(PACKAGES_DIR)) return []
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('skill-'))
    .map((d) => d.name.slice('skill-'.length))
    .filter((name) => existsSync(join(PACKAGES_DIR, `skill-${name}`, 'package.json')))
    .sort()
}

function readAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return []
  return readJson(ALLOWLIST_PATH)
}

function writeAllowlist(list) {
  mkdirSync(join(ROOT, 'docs'), { recursive: true })
  writeJson(ALLOWLIST_PATH, [...new Set(list)].sort())
}

function truncate(text, max = 200) {
  if (!text || text.length <= max) return text ?? ''
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`
}

function rootLicense() {
  const pkg = readJson(join(ROOT, 'package.json'))
  return pkg.license ?? 'UNLICENSED'
}

const FILES = [
  'SKILL.md',
  'metadata.json',
  'references/**',
  'README.md',
  'agents/**',
  'CHANGELOG.md',
  'LICENSE',
]

function packageDir(name) {
  return join(PACKAGES_DIR, `skill-${name}`)
}

function generateOne(name, { scope }) {
  const metadataPath = join(SKILLS_DIR, name, 'metadata.json')
  if (!existsSync(metadataPath)) {
    return { name, action: 'skipped', error: `skills/${name}/metadata.json does not exist` }
  }
  let metadata
  try {
    metadata = readJson(metadataPath)
  } catch (e) {
    return { name, action: 'skipped', error: `skills/${name}/metadata.json is invalid JSON: ${e.message}` }
  }

  const pkgDir = packageDir(name)
  const pkgJsonPath = join(pkgDir, 'package.json')

  if (!existsSync(pkgJsonPath)) {
    if (!scope) {
      fail(
        `packages/skill-${name}/package.json does not exist and no --scope was given. ` +
          `Pass --scope @yourscope to create it.`,
      )
    }
    mkdirSync(pkgDir, { recursive: true })
    const pkg = {
      name: `${scope}/skill-${name}`,
      version: metadata.version ?? '0.0.0',
      description: truncate(metadata.abstract),
      files: FILES,
      license: rootLicense(),
      publishConfig: { access: 'public' },
      private: true,
    }
    writeJson(pkgJsonPath, pkg)
    return { name, action: 'created' }
  }

  const pkg = readJson(pkgJsonPath)
  pkg.description = truncate(metadata.abstract)
  pkg.files = FILES
  // Once a package is enabled (private: false), Changesets owns `version`
  // exclusively from that point on — never overwrite it here again.
  if (pkg.private !== false) {
    pkg.version = metadata.version ?? pkg.version
  }
  writeJson(pkgJsonPath, pkg)
  return { name, action: 'refreshed' }
}

function runCheck() {
  const skillNames = new Set(listSkillNames())
  const packageNames = new Set(listPackageSkillNames())
  const problems = []

  for (const name of skillNames) {
    if (!packageNames.has(name)) {
      problems.push(`skills/${name} has no packages/skill-${name}/package.json`)
    }
  }
  for (const name of packageNames) {
    if (!skillNames.has(name)) {
      problems.push(`packages/skill-${name} has no corresponding skills/${name}/SKILL.md`)
    }
  }

  const allowlist = new Set(readAllowlist())
  for (const name of packageNames) {
    const pkg = readJson(join(packageDir(name), 'package.json'))
    const shouldBePublic = allowlist.has(pkg.name)
    const isPublic = pkg.private === false
    if (shouldBePublic && !isPublic) {
      problems.push(
        `${pkg.name} is listed in docs/published-skills.json but package.json has private !== false`,
      )
    }
    if (!shouldBePublic && isPublic) {
      problems.push(
        `${pkg.name} has private: false but is NOT listed in docs/published-skills.json`,
      )
    }
  }

  if (problems.length) {
    console.error('generate-skill-package-json --check failed:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log(`generate-skill-package-json --check passed (${skillNames.size} skills).`)
}

function runPublish(name) {
  // Human-only, interactive. A CI run must never flip a package public.
  if (process.env.CI) fail('--publish is human-only and must never run in CI')
  const pkgJsonPath = join(packageDir(name), 'package.json')
  if (!existsSync(pkgJsonPath)) {
    fail(`packages/skill-${name}/package.json does not exist — run generate first.`)
  }
  const pkg = readJson(pkgJsonPath)
  if (pkg.private === false) {
    console.log(`${pkg.name} is already enabled (private: false).`)
    return
  }
  pkg.private = false
  writeJson(pkgJsonPath, pkg)
  const allowlist = readAllowlist()
  writeAllowlist([...allowlist, pkg.name])
  console.log(`Enabled ${pkg.name}: private: false, added to docs/published-skills.json.`)
  console.log('This script never runs npm publish / changeset publish — add a changeset')
  console.log('and let the release workflow (or `pnpm run release` locally) do that.')
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.check) return runCheck()
  if (args.publish) return runPublish(args.publish)

  const names = listSkillNames()
  if (!names.length) fail('no skills/<name>/SKILL.md found')
  const results = names.map((name) => generateOne(name, { scope: args.scope }))
  const failures = results.filter((r) => r.action === 'skipped')
  for (const r of results) {
    if (r.action === 'skipped') console.error(`skipped: skills/${r.name} — ${r.error}`)
    else console.log(`${r.action}: packages/skill-${r.name}/package.json`)
  }
  if (failures.length) {
    console.error(`\n${failures.length} skill(s) skipped due to errors above — fix them and re-run.`)
    process.exitCode = 1
  }
}

main()
