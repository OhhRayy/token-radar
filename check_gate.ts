#!/usr/bin/env node
// Gate self-check for the token-radar-01 entry: replicates the seven gate rows in the kit's
// RULES.txt (dashboard_files, board_file, sorted_by_value, coverage, farm_steps, screenshots,
// dossier_matches) against a built output directory, plus a check that dashboard/data.js carries
// the same rows board.json does. Run: node check_gate.ts [outDir] [snapshotPath]
// Exit 0 when every row passes, 1 otherwise. It never writes anything.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const out = process.argv[2] ?? 'out';
const snapshotPath = process.argv[3] ?? '../token-radar-01-kit/token-radar-01-kit/input/snapshot.json';

let failures = 0;
function row(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures++;
}

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const protocolSlugs = new Set<string>(snapshot.protocols.map((p: any) => p.slug));
const watchlist: string[] = snapshot.watchlist;

// ---- dashboard_files -------------------------------------------------------
const dashDir = join(out, 'dashboard');
const dashFiles: string[] = [];
(function walk(dir: string, rel: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(p, r);
    else if (e.isFile()) dashFiles.push(r);
    else dashFiles.push(`${r} (not a regular file)`);
  }
})(dashDir, '');
const dashBytes = dashFiles.reduce((n, f) => n + statSync(join(dashDir, f)).size, 0);
const hasIndex = dashFiles.includes('index.html');
const hasCss = dashFiles.some((f) => extname(f) === '.css');
const hasJs = dashFiles.some((f) => extname(f) === '.js');
let networkRef: string | null = null;
for (const f of dashFiles) {
  const text = readFileSync(join(dashDir, f), 'utf8');
  const ext = extname(f);
  if (ext === '.html') {
    const m = text.match(/(?:href|src|action|poster|cite|data|formaction|background)\s*=\s*["']https?:\/\/[^"']*["']/i);
    if (m) { networkRef = `${f}: ${m[0].slice(0, 80)}`; break; }
  } else if (ext === '.css') {
    const m = text.match(/https?:\/\//);
    if (m) { networkRef = `${f}: contains ${m[0]}`; break; }
  } else if (ext === '.js') {
    const m = text.match(/(?:import\s*\(?\s*|from\s+|require\s*\()\s*["']https?:\/\//);
    if (m) { networkRef = `${f}: ${m[0].slice(0, 80)}`; break; }
  }
}
row('dashboard_files', hasIndex && hasCss && hasJs && dashFiles.length <= 400 && dashBytes <= 4_194_304 && networkRef === null,
  `${dashFiles.length} files, ${dashBytes} bytes, index.html=${hasIndex}, css=${hasCss}, js=${hasJs}, network ref=${networkRef ?? 'none'}`);

// ---- board_file + sorted_by_value + farm_steps + coverage -------------------
const boardRaw = readFileSync(join(out, 'board.json'));
const board = JSON.parse(boardRaw.toString('utf8'));
const rows: any[] = Array.isArray(board) ? board : board.rows;
const boardOkSize = boardRaw.length <= 8_388_608;
const seen = new Set<string>();
let boardBad: string | null = null;
let stepsBad: string | null = null;
for (const r of rows) {
  if (typeof r.slug !== 'string' || r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug) || !protocolSlugs.has(r.slug)) { boardBad = `bad slug ${JSON.stringify(r.slug)}`; break; }
  if (seen.has(r.slug)) { boardBad = `duplicate slug ${r.slug}`; break; }
  seen.add(r.slug);
  if (typeof r.name !== 'string' || r.name.length === 0) { boardBad = `empty name for ${r.slug}`; break; }
  if (!Number.isInteger(r.rank) || r.rank <= 0) { boardBad = `bad rank for ${r.slug}`; break; }
  if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) { boardBad = `bad implied for ${r.slug}`; break; }
  if (!Array.isArray(r.farm_steps)) { stepsBad = `no farm_steps for ${r.slug}`; break; }
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) { stepsBad = `${r.slug}: ${r.farm_steps.length} steps`; break; }
  for (const s of r.farm_steps) {
    const t = typeof s === 'string' ? s.trim() : '';
    if (t.length < 20 || t.length > 600) { stepsBad = `${r.slug}: step ${JSON.stringify(s.slice(0, 40))} is ${t.length} chars`; break; }
  }
  if (stepsBad) break;
}
const allEqual = rows.length >= 2 && rows.every((r) => r.implied_value_usd === rows[0].implied_value_usd);
row('board_file', boardOkSize && rows.length >= 100 && rows.length <= 4000 && boardBad === null && !allEqual,
  `${rows.length} rows, ${boardRaw.length} bytes, ${boardBad ?? 'all rows valid'}, all-equal=${allEqual}`);
const ranks = rows.map((r) => r.rank);
const ranksExact = ranks.slice().sort((a, b) => a - b).every((v, i) => v === i + 1);
const sorted = rows.every((r, i) => i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd);
row('sorted_by_value', ranksExact && sorted && !allEqual,
  `ranks 1..${rows.length} exact=${ranksExact}, non-increasing=${sorted}`);
const missing = watchlist.filter((s) => !seen.has(s));
row('coverage', missing.length === 0, `watchlist ${watchlist.length}/${watchlist.length} covered${missing.length ? `, missing: ${missing.slice(0, 5).join(', ')}` : ''}`);
row('farm_steps', stepsBad === null, stepsBad ?? `every row holds 3-12 steps of 20-600 chars`);

// ---- screenshots ------------------------------------------------------------
const shotDir = join(out, 'screenshots');
const shots = readdirSync(shotDir).filter((f) => !f.startsWith('.'));
function pngSize(buf: Buffer): [number, number] | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
let shotsBad: string | null = null;
for (const f of shots) {
  const buf = readFileSync(join(shotDir, f));
  if (buf.length > 524_288) { shotsBad = `${f}: ${buf.length} bytes over 512 KiB`; break; }
  const size = pngSize(buf);
  if (!size) { shotsBad = `${f}: not a whole PNG`; break; }
  const [w, h] = size;
  const long = Math.max(w, h), short = Math.min(w, h);
  if (long > 1440 || short < 800) { shotsBad = `${f}: ${w}x${h} outside 1440/800 limits`; break; }
}
row('screenshots', shots.length >= 3 && shots.length <= 4 && shotsBad === null,
  `${shots.length} images (${shots.join(', ')}), ${shotsBad ?? 'all within 512 KiB and 1440x800 limits'}`);

// ---- dossier_matches --------------------------------------------------------
const dossier = readFileSync(join(out, 'dossier.json'));
const rebuilt = Buffer.from(buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
row('dossier_matches', dossier.equals(rebuilt) && dossier.length <= 1_572_864,
  `${dossier.length} bytes, byte-for-byte buildDossier output=${dossier.equals(rebuilt)}`);

// ---- data.js agrees with board.json -----------------------------------------
const dataSrc = readFileSync(join(dashDir, 'data.js'), 'utf8');
const data = JSON.parse(dataSrc.replace(/^window\.RADAR=/, '').replace(/;\s*$/, ''));
let dataBad: string | null = null;
if (!Array.isArray(data.rows) || data.rows.length !== rows.length) dataBad = `data.js has ${data.rows?.length} rows, board has ${rows.length}`;
else for (let i = 0; i < rows.length; i++) {
  const d = data.rows[i];
  if (d[0] !== rows[i].rank || d[1] !== rows[i].slug || d[8] !== rows[i].implied_value_usd) { dataBad = `row ${i + 1} differs: data.js ${d[0]}/${d[1]}/${d[8]} vs board ${rows[i].rank}/${rows[i].slug}/${rows[i].implied_value_usd}`; break; }
}
row('data.js=board.json', dataBad === null, dataBad ?? `${data.rows.length} rows, ranks/slugs/implied identical, watchlist ${data.watchlist_size}/40, model ${data.model_version}`);

console.log(failures === 0 ? 'ALL GATE ROWS PASS' : `${failures} GATE ROW(S) FAIL`);
process.exit(failures === 0 ? 0 : 1);
