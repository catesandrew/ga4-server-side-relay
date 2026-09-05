#!/usr/bin/env node
// sync-skill-content — mirror one or every skills/<name>/'s tracked content into
// its gitignored packages/skill-<name>/ directory, so the npm package always
// packs exactly what's committed under skills/<name>/, nothing more.
//
// Usage:
//   node bin/sync-skill-content.mjs --all
//   node bin/sync-skill-content.mjs <skill-name>
//
// For each target skill:
//   1. Prunes everything under packages/skill-<name>/ except package.json and
//      CHANGELOG.md (closes the stale-orphan gap on a gitignored, un-diffable
//      destination — a file removed from skills/<name>/ must not survive here).
//   2. Copies SKILL.md, metadata.json, references/**, README.md, agents/** (if
//      present), and the root LICENSE (if it exists) — sourced from
//      `git ls-files skills/<name>` (tracked files only, so untracked trees are
//      excluded for free) and filtered through an explicit content whitelist, so
//      a stray tracked file that isn't one of those categories never leaks in.
//   3. Scans the copied tree for any .gitignore/.npmignore file. npm's packer
//      applies these as package-wide exclusion rules (silently dropping matching
//      content); pnpm's packer does not, but the rename is kept as defense-in-depth
//      for non-pnpm rollout targets and npm-fallback publishing. Renames each to
//      gitignore-block.txt / npmignore-block.txt in the SYNCED copy only (the
//      source file under skills/<name>/ is never touched), and rewrites any
//      metadata.json `references` entry pointing at the old name to the new one,
//      in the same operation. Fails loudly if the rename target already exists.
//   4. Asserts the synced SKILL.md's frontmatter `name:` matches the directory name.
//
// Running this twice must produce byte-identical output (prune-then-copy makes
// it idempotent) — that's the acceptance check, not just a nice property.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  readdirSync,
  renameSync,
} from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const SKILLS_DIR = join(ROOT, 'skills')
const PACKAGES_DIR = join(ROOT, 'packages')

function fail(msg) {
  console.error(`\n  error: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { all: false, skill: null }
  for (const a of argv) {
    if (a === '--all') args.all = true
    else if (!a.startsWith('-')) args.skill = a
    else fail(`unrecognized argument: ${a}`)
  }
  if (!args.all && !args.skill) fail('pass --all or a single <skill-name>')
  if (args.all && args.skill) fail('pass either --all or a single skill name, not both')
  return args
}

function listSkillNames() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(SKILLS_DIR, name, 'SKILL.md')))
    .sort()
}

function pruneDestination(pkgDir) {
  if (!existsSync(pkgDir)) {
    mkdirSync(pkgDir, { recursive: true })
    return
  }
  const keep = new Set(['package.json', 'CHANGELOG.md'])
  for (const entry of readdirSync(pkgDir)) {
    if (keep.has(entry)) continue
    rmSync(join(pkgDir, entry), { recursive: true, force: true })
  }
}

function gitTrackedFiles(skillName) {
  const out = execFileSync('git', ['ls-files', `skills/${skillName}`], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return out.split('\n').filter(Boolean)
}

// Whitelist, not a denylist: only these categories ship in the package, matching
// generate-skill-package-json.mjs's `files` field.
function isPackageContent(inSkillPath) {
  return (
    inSkillPath === 'SKILL.md' ||
    inSkillPath === 'metadata.json' ||
    inSkillPath === 'README.md' ||
    inSkillPath.startsWith('references/') ||
    inSkillPath.startsWith('agents/')
  )
}

function copyTrackedFiles(skillName, pkgDir) {
  for (const relPath of gitTrackedFiles(skillName)) {
    // relPath looks like "skills/<name>/SKILL.md" — strip the "skills/<name>/" prefix.
    const inSkillPath = relPath.slice(`skills/${skillName}/`.length)
    if (!isPackageContent(inSkillPath)) continue
    const src = join(ROOT, relPath)
    const dest = join(pkgDir, inSkillPath)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, readFileSync(src))
  }
  const rootLicense = join(ROOT, 'LICENSE')
  if (existsSync(rootLicense)) {
    writeFileSync(join(pkgDir, 'LICENSE'), readFileSync(rootLicense))
  }
}

function walk(dir) {
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) results.push(...walk(full))
    else results.push(full)
  }
  return results
}

const RENAME_MAP = {
  '.gitignore': 'gitignore-block.txt',
  '.npmignore': 'npmignore-block.txt',
}

function scanAndRenameNestedIgnoreFiles(pkgDir) {
  const metadataPath = join(pkgDir, 'metadata.json')
  let metadata = existsSync(metadataPath)
    ? JSON.parse(readFileSync(metadataPath, 'utf8'))
    : null
  let metadataChanged = false

  for (const file of walk(pkgDir)) {
    const base = file.split('/').pop()
    const newBase = RENAME_MAP[base]
    if (!newBase) continue

    const dir = dirname(file)
    const target = join(dir, newBase)
    if (existsSync(target)) {
      fail(
        `rename target already exists: ${relative(pkgDir, target)} (renaming ${relative(pkgDir, file)})`,
      )
    }
    renameSync(file, target)

    if (metadata?.references) {
      const oldRef = relative(pkgDir, file)
      const newRef = relative(pkgDir, target)
      metadata.references = metadata.references.map((ref) =>
        ref === oldRef ? newRef : ref,
      )
      metadataChanged = true
    }
  }

  if (metadataChanged) {
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
  }
}

function assertNameMatchesDirectory(skillName, pkgDir) {
  const skillMdPath = join(pkgDir, 'SKILL.md')
  if (!existsSync(skillMdPath)) fail(`${skillName}: synced SKILL.md is missing`)
  const content = readFileSync(skillMdPath, 'utf8')
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) fail(`${skillName}: SKILL.md has no frontmatter block`)
  const nameLine = match[1].split('\n').find((l) => l.startsWith('name:'))
  if (!nameLine) fail(`${skillName}: SKILL.md frontmatter has no name: field`)
  const frontmatterName = nameLine.slice('name:'.length).trim()
  if (frontmatterName !== skillName) {
    fail(
      `${skillName}: SKILL.md frontmatter name "${frontmatterName}" does not match directory name "${skillName}"`,
    )
  }
}

function syncOne(skillName) {
  const pkgDir = join(PACKAGES_DIR, `skill-${skillName}`)
  pruneDestination(pkgDir)
  copyTrackedFiles(skillName, pkgDir)
  scanAndRenameNestedIgnoreFiles(pkgDir)
  assertNameMatchesDirectory(skillName, pkgDir)
  console.log(`synced: packages/skill-${skillName}`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.all && !existsSync(join(SKILLS_DIR, args.skill, 'SKILL.md'))) {
    fail(`skills/${args.skill}/SKILL.md does not exist`)
  }
  const names = args.all ? listSkillNames() : [args.skill]
  for (const name of names) syncOne(name)
}

main()
