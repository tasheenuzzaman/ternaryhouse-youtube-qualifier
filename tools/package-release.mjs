/**
 * Package a release ZIP from a COMMIT (never from the working folder).
 *
 *   node tools/package-release.mjs [--commit <ref>] [--out <dir>]
 *
 * - The archive holds the loadable extension only — the runtime paths below
 *   plus README.md, as tracked at that commit, under one top-level folder,
 *   via `git archive` (same commit -> same contents). No tests, internal
 *   documents, tooling or history.
 * - The name comes from that commit's manifest: `version_name` if present
 *   (e.g. v1.2.0-candidate.3), otherwise `v<version>-stable`. A "-stable"
 *   archive is therefore only possible from a commit whose manifest has no
 *   candidate label.
 * - Prints the archive's SHA-256 (and writes <zip>.sha256) plus the git object
 *   IDs of every runtime path, so two builds can be shown to ship identical
 *   code (equal IDs <=> byte-identical contents).
 *
 * Development tooling only: nothing here is loaded by the extension.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

const commit = git('rev-parse', '--verify', `${opt('commit', 'HEAD')}^{commit}`);
const outDir = resolve(opt('out', 'dist'));
const manifest = JSON.parse(git('show', `${commit}:manifest.json`));
const label = manifest.version_name ? `v${manifest.version_name}` : `v${manifest.version}-stable`;
const folder = 'ternaryhouse-youtube-qualifier';
const zipName = `${folder}-${label}.zip`;
const zipPath = join(outDir, zipName);

const RUNTIME = ['manifest.json', 'background', 'content', 'lib', 'options', 'icons'];
const PACKAGED = [...RUNTIME, 'README.md'];

mkdirSync(outDir, { recursive: true });
execFileSync('git', ['archive', '--format=zip', `--prefix=${folder}/`, '-o', zipPath, commit, '--', ...PACKAGED]);

const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
writeFileSync(`${zipPath}.sha256`, `${sha256}  ${zipName}\n`);

const files = git('ls-tree', '-r', '--name-only', commit, '--', ...PACKAGED).split('\n');

console.log(`commit        ${commit}`);
console.log(`manifest      version ${manifest.version}${manifest.version_name ? `, version_name ${manifest.version_name}` : ''}`);
console.log(`permissions   ${JSON.stringify(manifest.permissions)} host ${JSON.stringify(manifest.host_permissions)}`);
console.log(`archive       ${zipPath}`);
console.log(`sha256        ${sha256}`);
console.log(`files         ${files.length}`);
console.log('runtime object IDs (equal ID = identical contents):');
for (const path of RUNTIME) console.log(`  ${git('rev-parse', `${commit}:${path}`)}  ${path}`);
