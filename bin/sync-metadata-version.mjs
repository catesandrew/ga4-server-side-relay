#!/usr/bin/env node
// sync-metadata-version — reads each packages/skill-<name>/package.json's current
// `version` and writes it into skills/<name>/metadata.json.version.
//
// Invoked as part of the `version-packages` script (see
// package-json-scripts-patch.jsonc), so it runs INSIDE the Version PR's own
// commit, before anything is packed — the mirror must be established before
// validate-skill-package.mjs's version-equality assertion ever runs.
//
// Usage: node bin/sync-metadata-version.mjs

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const SKILLS_DIR = join(ROOT, 'skills')
const PACKAGES_DIR = join(ROOT, 'packages')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function listSkillNames() {
  if (!existsSync(SKILLS_DIR)) return []
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(SKILLS_DIR, name, 'SKILL.md')))
    .sort()
}

function main() {
  const names = listSkillNames()
  let updated = 0

  for (const name of names) {
    const pkgJsonPath = join(PACKAGES_DIR, `skill-${name}`, 'package.json')
    const metadataPath = join(SKILLS_DIR, name, 'metadata.json')
    if (!existsSync(pkgJsonPath) || !existsSync(metadataPath)) continue

    const pkg = readJson(pkgJsonPath)
    const metadata = readJson(metadataPath)
    if (metadata.version === pkg.version) continue

    metadata.version = pkg.version
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
    console.log(`skills/${name}/metadata.json version -> ${pkg.version}`)
    updated++
  }

  console.log(`sync-metadata-version: ${updated} updated, ${names.length - updated} unchanged.`)
}

main()
