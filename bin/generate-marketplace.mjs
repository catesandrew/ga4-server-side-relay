#!/usr/bin/env node
// generate-marketplace — scans skills/*/metadata.json + SKILL.md frontmatter and
// writes .claude-plugin/marketplace.json: a single plugin covering every skill in
// this repo (inline `skills` array, no separate plugin.json manifest). Carries no
// per-skill version field on purpose — the manifest lists skills by name/path
// only, so it never goes stale relative to a Version PR's bumps and needs no
// reconciliation with them.
//
// Usage:
//   node bin/generate-marketplace.mjs --prefix <prefix>
//
//   --prefix <p>   the plugin command prefix (e.g. "ns" -> /ns:<skill-name>),
//                  chosen once per repo and passed on every invocation.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const SKILLS_DIR = join(ROOT, 'skills')
const OUT_PATH = join(ROOT, '.claude-plugin', 'marketplace.json')

function fail(msg) {
  console.error(`\n  error: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { prefix: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--prefix') args.prefix = argv[++i]
    else fail(`unrecognized argument: ${a}`)
  }
  if (!args.prefix) fail('pass --prefix <command-prefix>')
  return args
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function frontmatterName(skillMdContent, dirName) {
  const match = skillMdContent.match(/^---\n([\s\S]*?)\n---/)
  if (!match) fail(`skills/${dirName}/SKILL.md has no frontmatter block`)
  const nameLine = match[1].split('\n').find((l) => l.startsWith('name:'))
  if (!nameLine) fail(`skills/${dirName}/SKILL.md frontmatter has no name: field`)
  return nameLine.slice('name:'.length).trim()
}

function listSkills() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(SKILLS_DIR, name, 'SKILL.md')))
    .sort()
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const names = listSkills()
  if (!names.length) fail('no skills/<name>/SKILL.md found')

  const rootPkg = existsSync(join(ROOT, 'package.json'))
    ? readJson(join(ROOT, 'package.json'))
    : { name: 'skills' }

  let organization = null

  for (const name of names) {
    const skillMd = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8')
    const fmName = frontmatterName(skillMd, name)
    // A skill's SKILL.md frontmatter `name` must match its directory name — the
    // same invariant sync-skill-content.mjs enforces on the packed copy. Surface
    // it here too rather than silently omitting the skill from the manifest.
    if (fmName !== name) {
      fail(
        `skills/${name}/SKILL.md frontmatter name "${fmName}" does not match directory name "${name}"`,
      )
    }

    const metadataPath = join(SKILLS_DIR, name, 'metadata.json')
    if (!existsSync(metadataPath)) fail(`missing ${metadataPath}`)
    const metadata = readJson(metadataPath)
    if (!metadata.organization) fail(`${metadataPath} has no "organization" field`)
    if (organization === null) {
      organization = metadata.organization
    } else if (organization !== metadata.organization) {
      // This generator assumes a single owner across every skill in the repo —
      // an inconsistency here means metadata.json drifted, not a real multi-org
      // repo, so surface it loudly rather than picking the first one seen.
      fail(
        `inconsistent metadata.json "organization" across skills: "${organization}" vs "${metadata.organization}" (${name})`,
      )
    }
  }

  const manifest = {
    name: rootPkg.name?.replace(/^@[^/]+\//, '') ?? 'skills',
    owner: { name: organization },
    plugins: [
      {
        name: args.prefix,
        description: `${names.length} skills, distributed via the ${args.prefix} plugin command prefix.`,
        source: './',
        strict: false,
        skills: names.map((n) => `./skills/${n}`),
      },
    ],
  }

  mkdirSync(join(ROOT, '.claude-plugin'), { recursive: true })
  writeFileSync(OUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`wrote .claude-plugin/marketplace.json (${names.length} skills).`)
}

main()
