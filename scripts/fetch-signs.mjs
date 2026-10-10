#!/usr/bin/env node
// Erzeugt signs/<id>.svg, data/signs.json und data/signs.js aus der de.wikipedia-Bildtafel
// "Bildtafel der Verkehrszeichen in der Bundesrepublik Deutschland seit 2017" (SVGs von Wikimedia Commons).
// Node 18+, keine Dependencies.  Aufruf:  node scripts/fetch-signs.mjs [--dry] [--force]
//   --dry    nur parsen + Liste ausgeben, nichts herunterladen
//   --force  SVGs neu laden, auch wenn sie schon existieren

import { mkdir, writeFile, readFile, access, stat, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = 'Bildtafel der Verkehrszeichen in der Bundesrepublik Deutschland seit 2017';
const SOURCE_URL = 'https://de.wikipedia.org/wiki/' + encodeURIComponent(PAGE.replace(/ /g, '_'));
const UA = 'SchilderwaldLernapp/1.0 (private non-commercial learning project)';
const PARALLEL = 1;   // upload.wikimedia.org drosselt Original-Downloads stark (429) -> seriell + Retry-After
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

// ---------------------------------------------------------------- HTTP
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Globale Drosselung: Mindestabstand zwischen Request-Starts + gemeinsame Pause aller Worker nach 429
// (upload.wikimedia.org antwortet bei zu vielen Original-Downloads sehr schnell mit 429).
let MIN_GAP_MS = 1500;
let nextSlot = 0, pauseUntil = 0;
async function gate() {
  for (;;) {
    const now = Date.now();
    if (now < pauseUntil) { await sleep(pauseUntil - now); continue; }
    if (now < nextSlot) { await sleep(nextSlot - now); continue; }
    nextSlot = now + MIN_GAP_MS;
    return;
  }
}
async function get(url, as = 'text', maxAttempts = 8) {
  let wait = 5000;
  for (let attempt = 1; ; attempt++) {
    await gate();
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, redirect: 'follow' });
    } catch (e) {
      if (attempt >= maxAttempts) throw e;
      await sleep(wait); wait = Math.min(wait * 2, 60000); continue;
    }
    if (res.ok) return as === 'json' ? res.json() : res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      await res.arrayBuffer().catch(() => {});
      const ra = Number(res.headers.get('retry-after'));
      // Retry-After wird beachtet (max. 10 min), sonst exponentielles Backoff
      const ms = Math.min(ra > 0 ? ra * 1000 : wait, 600000);
      if (res.status === 429) {
        pauseUntil = Math.max(pauseUntil, Date.now() + ms);
        MIN_GAP_MS = Math.min(Math.round(MIN_GAP_MS * 1.5), 6000);   // adaptiv langsamer werden
        console.log(`  429 – pausiere ${Math.round(ms / 1000)} s, Abstand jetzt ${MIN_GAP_MS} ms`);
      }
      await sleep(ms); wait = Math.min(wait * 2, 60000); continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// ---------------------------------------------------------------- Kategorien / Filter
// H2-Abschnitte der Bildtafel, die übernommen werden (alles andere: Sinnbilder, gestrichene Zeichen, Fotos ... wird ignoriert)
const H2 = [
  [/^Gefahrzeichen/, 'gefahr'],
  [/^Vorschriftzeichen/, 'vorschrift'],
  [/^Richtzeichen/, 'richt'],
  [/^Verkehrseinrichtungen/, 'einrichtung'],
  [/^Sonstige Zeichen/, 'einrichtung'],       // 720 Grünpfeil (VzKat Teil 6)
  [/^Zusatzzeichen/, 'zusatz'],
  [/^Nachträgliche Änderungen/, 'late'],      // neuere Zeichen (244.3, 277.1, 342, 350.1 ...) – nur ergänzend
];
const MARKIERUNG = new Set(['293', '294', '295', '296', '297', '297.1', '298', '299', '340', '341', '342']);

function catFor(id, h2cat) {
  const major = parseFloat(id);
  const base = baseOf(id);
  if (MARKIERUNG.has(base)) return 'markierung';
  if (h2cat !== 'late') return h2cat;
  if (major >= 1000) return 'zusatz';
  if (major >= 600) return 'einrichtung';
  if (major >= 300) return 'richt';
  if (major >= 200) return 'vorschrift';
  return 'gefahr';
}
function baseOf(id) { return parseFloat(id) >= 1000 ? id : id.split('-')[0]; }

// Variantenbegrenzung: erlaubte Varianten je Grundnummer (alles andere dieser Grundnummer fällt weg)
const SPEEDS = [10, 20, 30, 40, 50, 60, 70, 80, 100, 120];
const ALLOW = {
  '108': ['108-10'], '110': ['110-12'],
  '274': SPEEDS.map((s) => `274-${s}`),
  '278': [30, 50, 60, 80, 100].map((s) => `278-${s}`),
  '275': ['275-30', '275-50'], '279': ['279-30', '279-50'],
  '315': ['315-55', '315-65', '315-75', '315-85'],
  '223.1': ['223.1-50'], '223.2': ['223.2-50'], '223.3': ['223.3-50'],
};
const CAP_BASE = { '442': 2, '455.1': 1, '460': 2, '386.1': 2, '386.2': 2, '386.3': 1 };
// Abschnitte mit sehr vielen Beispielvarianten: max. N Einträge je Grundnummer
const CAP_BY_H3 = [
  [/^Wegweisung/, 1],
  [/^Überleitungstafeln/, 1],
  [/^Einrichtungen zur Kennzeichnung von Arbeits/, 3],
  [/^Einrichtungen zur Kennzeichnung von dauerhaften/, 3],
];
// Zusatzzeichen: max. N je Gruppe (H3-Abschnitt), um bei "gängigen" zu bleiben
const ZUSATZ_CAP = 7;

// ---------------------------------------------------------------- Wikitext-Bereinigung
function clean(s) {
  return s
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<ref[^>]*>.*$/g, '')                       // abgeschnittene ref
    .replace(/\{\{Anker\|[^}]*\}\}/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s([^\]]*)\]/g, '$1')
    .replace(/&shy;|­/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function prettyName(raw, id, base) {
  if (!/Aufstellung links/.test(raw)) raw = raw.replace(/\s*[,;–-]?\s*\(?Aufstellung rechts\)?/g, '');
  raw = raw.replace(/\s*\(Zeichen [^)]*\)/g, '');            // "(Zeichen 1010-51)" o. ä. entfernen
  raw = raw.replace(/\s*\(diese Nummer[^)]*\)/g, '');        // Wiki-Anmerkung bei 310/311
  let n = raw.replace(/(?<!Nr)[;:,.\s]+$/, '').replace(/^[;:,.\s]+/, '');
  // "Kurve – links" -> "Kurve (links)";  "A – B – C" -> "A (B, C)"
  const parts = n.split(/\s+[–—]\s+/);
  if (parts.length > 1) n = `${parts[0]} (${parts.slice(1).join(', ')})`;
  n = n.replace(/\s+([,;)])/g, '$1').replace(/\(\s+/g, '(').trim();
  if (n.length > 60 && /\.\s+\p{Lu}/u.test(n)) n = n.split(/\.\s+(?=\p{Lu})/u)[0];   // Erläuterungssätze abschneiden
  if (n) n = n[0].toUpperCase() + n.slice(1);
  const v = id.split('-')[1];
  if (['274', '278', '275', '279', '274.1', '274.2'].includes(base) && v && !/\d/.test(n)) n += ` (${v} km/h)`;
  const UNIT = { '262': 't', '263': 't', '264': 'm', '265': 'm', '266': 'm' };
  if (UNIT[base] && v && !/\d/.test(n)) n += ` (${v} ${UNIT[base]})`;
  if (/^(108|110)$/.test(base)) n = n.replace(/^(Gefälle|Steigung)\s+(\d+)\s*%/, '$1 ($2 %)');
  return n;
}

// ---------------------------------------------------------------- Parsen
function parse(wikitext) {
  const out = [];
  let h2 = '', h3 = '', h2cat = null;
  const perBase = {}, perH3 = {};
  for (const line of wikitext.split('\n')) {
    let m;
    if ((m = line.match(/^==\s*([^=].*?)\s*==\s*$/))) {
      h2 = clean(m[1]); h3 = ''; h2cat = null;
      for (const [re, c] of H2) if (re.test(h2)) h2cat = c;
      continue;
    }
    if ((m = line.match(/^===\s*(.*?)\s*===\s*$/))) { h3 = clean(m[1]); continue; }
    if (!h2cat) continue;
    m = line.match(/^\s*([^|<>{}\[\]]+?\.svg)\s*\|(.*)$/i);
    if (!m) continue;
    const file = m[1].trim();
    const cap = m[2];
    if (/Zuvor:/.test(cap)) continue;
    const nm = cap.match(/'''(?:Zusatzzeichen|Zeichen)\s*([0-9][0-9.]*(?:\s*[-–]\s*[0-9]+(?:,[0-9]+)?)*)\s*'''\s*(?:<br\s*\/?>)?(.*)$/);
    if (!nm) continue;
    const id = nm[1].replace(/\s*[–-]\s*/g, '-').replace(/\.$/, '');
    const rest = nm[2].replace(/<!--[\s\S]*?-->/g, '').replace(/-\s*<br\s*\/?>\s*(?=\p{Ll})/gu, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
      .replace(/\[\[[^\]]*\]\]/g, (l) => l.replace(/<br\s*\/?>/gi, ' '));
    const segs = rest.split(/<br\s*\/?>/i).map(clean).filter(Boolean);
    let rawName = segs[0] || '';
    // "Beginn einer<br />Tempo 30-Zone" -> zusammenfügen
    for (let k = 1; k < segs.length && /(\b(einer|eines|einem|des|der|den|dem|die|das|für|mit|in|im|und|oder|zur|zum|von)|-)$/.test(rawName); k++)
      rawName += (rawName.endsWith('-') ? '' : ' ') + segs[k];
    if (/^\(/.test(rawName) && segs.length > 1) rawName = segs[segs.length - 1];   // 610-40: "(30 cm) ... Leitkegel"
    if (!rawName) continue;
    // gespiegelte Varianten ("Aufstellung links") weglassen
    if (/Aufstellung links/.test(rawName) && !/rechts/.test(rawName)) continue;
    const base = baseOf(id);
    const cat = catFor(id, h2cat);
    const section = h2cat === 'late' ? clean(h3.replace(/\[\[#.*?\]\]/g, '')) : (h3 || h2);
    out.push({ id, base, rawName, cat, section, h2, h3, file, late: h2cat === 'late' });
  }
  return out;
}

function numKey(id) {
  // "274.1-20" -> [274, 1, 20]  ;  "1004-30-100" -> [1004, 0, 30, 100]
  const [head, ...vars] = id.split('-');
  const [a, b = '0'] = head.split('.');
  return [Number(a), Number(b), ...vars.map(Number)];
}
function cmpKey(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? -1) - (b[i] ?? -1); if (d) return d; }
  return 0;
}

function select(entries) {
  const seen = new Set(), names = new Map(), perBase = {}, perGroup = {};
  const main = [], late = [];
  for (const e of entries) {
    if (seen.has(e.id) || /…|\.\.\./.test(e.id)) continue;
    if (ALLOW[e.base] && !ALLOW[e.base].includes(e.id)) continue;
    const cap = CAP_BY_H3.find(([re]) => re.test(e.h3));
    const capN = CAP_BASE[e.base] ?? (cap && cap[1]);
    if (capN) { perBase[e.base] = (perBase[e.base] || 0) + 1; if (perBase[e.base] > capN) continue; }
    if (e.cat === 'zusatz' && !e.late) {
      const g = e.h3 || 'zusatz'; perGroup[g] = (perGroup[g] || 0) + 1; if (perGroup[g] > ZUSATZ_CAP) continue;
    }
    const name = prettyName(e.rawName, e.id, e.base);
    // gleiche Bezeichnung innerhalb derselben Grundnummer (z. B. nur andere Maße) -> nur erste Variante behalten
    const key = name.toLowerCase();
    if (names.has(key) && names.get(key).base === e.base && e.cat !== 'zusatz') continue;
    seen.add(e.id);
    const rec = { id: e.id, base: e.base, name, cat: e.cat, section: e.section, file: `signs/${e.id}.svg`, ratio: null, _src: e.file };
    if (!names.has(key)) names.set(key, rec);
    (e.late ? late : main).push(rec);
  }
  // gleicher Name in verschiedenen Kategorien -> Kategorie anhängen (z. B. Fußgängerüberweg)
  const LABEL = { gefahr: 'Gefahrzeichen', vorschrift: 'Vorschriftzeichen', richt: 'Richtzeichen', markierung: 'Markierung', einrichtung: 'Verkehrseinrichtung', zusatz: 'Zusatzzeichen' };
  const grp = {};
  for (const r of [...main, ...late]) (grp[r.name.toLowerCase()] ||= []).push(r);
  for (const g of Object.values(grp)) if (g.length > 1 && new Set(g.map((r) => r.cat)).size > 1) for (const r of g) r.name += ` (${LABEL[r.cat]})`;
  // spätere Ergänzungen numerisch passend einsortieren
  for (const r of late) {
    const k = numKey(r.id);
    let at = main.length;
    for (let i = main.length - 1; i >= 0; i--) { if (cmpKey(numKey(main[i].id), k) <= 0) { at = i + 1; break; } if (i === 0) at = 0; }
    main.splice(at, 0, r);
    if (at > 0) r.section = main[at - 1].section;   // Abschnitt des Vorgängers statt "Zeichen 350 – Radschnellweg (08.11.2021)"
  }
  return main;
}

// ---------------------------------------------------------------- SVG
function slimSvg(svg) {
  let s = svg.replace(/^﻿/, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<metadata[\s\S]*?<\/metadata>/gi, '').replace(/<metadata[^>]*\/>/gi, '');
  s = s.replace(/<sodipodi:namedview[\s\S]*?<\/sodipodi:namedview>/g, '').replace(/<sodipodi:namedview[^>]*\/>/g, '');
  s = s.replace(/<inkscape:[\w-]+[^>]*\/>/g, '');
  s = s.replace(/\s(?:sodipodi|inkscape):[\w-]+\s*=\s*("[^"]*"|'[^']*')/g, '');
  s = s.replace(/<!DOCTYPE[\s\S]*?\]>\s*/i, (d) => (/ENTITY/.test(d) ? d : ''));
  s = s.replace(/\n\s*\n+/g, '\n').trim() + '\n';
  return s;
}
function svgSize(svg) {
  const tag = (svg.match(/<svg\b[^>]*>/i) || [''])[0];
  const vb = tag.match(/viewBox\s*=\s*["']\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([\d.eE+]+)[\s,]+([\d.eE+]+)/);
  if (vb) return { w: +vb[3], h: +vb[4], hasVB: true, tag };
  const w = tag.match(/\swidth\s*=\s*["']\s*([\d.]+)\s*(px)?\s*["']/), h = tag.match(/\sheight\s*=\s*["']\s*([\d.]+)\s*(px)?\s*["']/);
  if (w && h) return { w: +w[1], h: +h[1], hasVB: false, tag, px: true };
  const w2 = tag.match(/\swidth\s*=\s*["']\s*([\d.]+)/), h2 = tag.match(/\sheight\s*=\s*["']\s*([\d.]+)/);
  if (w2 && h2) return { w: +w2[1], h: +h2[1], hasVB: false, tag };
  return null;
}

// ---------------------------------------------------------------- main
async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function main() {
  // Wikitext (mit lokalem Cache in scripts/.cache, max. 7 Tage alt; --force lädt neu)
  const cacheFile = path.join(ROOT, 'scripts', '.cache', 'bildtafel.wikitext');
  let wt = null;
  try { const st = await stat(cacheFile); if (!FORCE && Date.now() - st.mtimeMs < 7 * 864e5) wt = await readFile(cacheFile, 'utf8'); } catch {}
  if (!wt) {
    console.log('Lade Wikitext:', PAGE);
    const api = `https://de.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(PAGE)}&prop=wikitext&format=json&formatversion=2`;
    wt = (await get(api, 'json')).parse.wikitext;
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, wt);
  }
  const signs = select(parse(wt));
  console.log(`${signs.length} Zeichen ausgewählt`);
  if (DRY) { for (const s of signs) console.log([s.id, s.cat, s.name, s.section].join(' | ')); return; }

  // Original-URL direkt aus dem Commons-Hashpfad berechnen (spart die imageinfo-API, die ebenfalls 429 liefert):
  // https://upload.wikimedia.org/wikipedia/commons/<md5[0]>/<md5[0..1]>/<Dateiname>
  const urls = new Map();
  for (const t of new Set(signs.map((s) => s._src))) {
    let name = t.trim().replace(/ /g, '_');
    name = name[0].toUpperCase() + name.slice(1);
    const h = createHash('md5').update(name, 'utf8').digest('hex');
    urls.set(t, { url: `https://upload.wikimedia.org/wikipedia/commons/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(name)}` });
  }
  // Commons-imageinfo (50 Titel/Request): echte Breite/Höhe für ratio + kanonische URL (löst Datei-Weiterleitungen auf).
  // Optional – bei Fehlern/429 bleiben MD5-URL und ratio 1.
  try {
    const titles = [...urls.keys()];
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50);
      const q = `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=imageinfo&iiprop=url|size&titles=${encodeURIComponent(batch.map((t) => 'File:' + t).join('|'))}`;
      await gate();
      const res = await fetch(q, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const back = new Map(batch.map((t) => ['File:' + t, t]));
      for (const n of j.query.normalized || []) back.set(n.to, back.get(n.from));
      for (const r of j.query.redirects || []) back.set(r.to, back.get(r.from));
      for (const p of j.query.pages || []) {
        const src = back.get(p.title), ii = p.imageinfo && p.imageinfo[0];
        if (src && ii) urls.set(src, { url: ii.url.split('?')[0], width: ii.width, height: ii.height });
      }
    }
    console.log('imageinfo ok');
  } catch (e) { console.log('imageinfo übersprungen:', e.message); }

  await mkdir(path.join(ROOT, 'signs'), { recursive: true });
  await mkdir(path.join(ROOT, 'data'), { recursive: true });
  const setRatio = (s, svg) => {
    const ii = urls.get(s._src);
    const sz = svgSize(svg) || (ii && { w: ii.width, h: ii.height });
    s.ratio = sz && sz.h ? Math.round((sz.w / sz.h) * 100) / 100 : 1;
  };
  // Datendateien enthalten ALLE Zeichen. Solange ein SVG noch nicht lokal liegt (429-Drosselung von
  // upload.wikimedia.org), zeigt "file" auf die Original-URL (Browser dürfen dort direkt laden) und ratio ist 1.
  // Geschrieben wird sofort, während des Downloads (alle 20 Dateien) und am Ende -> dann mit lokalen Pfaden.
  let out;
  async function writeData() {
    const list = signs.map(({ _src, _local, _remote, ...r }) =>
      _local ? r : { ...r, file: _remote || urls.get(_src).url, ratio: r.ratio ?? 1 });
    out = { generated: new Date().toISOString(), source: SOURCE_URL, count: list.length, signs: list };
    const json = JSON.stringify(out, null, 1);
    // atomar schreiben (tmp + rename), damit die UI nie eine halbe Datei lädt
    for (const [f, body] of [['signs.json', json + '\n'], ['signs.js', `window.SIGNS = ${json};\n`]]) {
      const p = path.join(ROOT, 'data', f);
      await writeFile(p + '.tmp', body);
      await rename(p + '.tmp', p);
    }
  }
  const todo = [];
  for (const s of signs) {
    const dest = path.join(ROOT, s.file);
    if (!FORCE && (await exists(dest))) { setRatio(s, await readFile(dest, 'utf8')); s._local = true; }
    else {
      const ii = urls.get(s._src);
      if (ii && ii.width && ii.height) s.ratio = Math.round((ii.width / ii.height) * 100) / 100;
      todo.push(s);
    }
  }
  await writeData();
  console.log(`${signs.length - todo.length} SVGs vorhanden, ${todo.length} zu laden`);

  const failed = [];
  let done = 0;
  await pool(todo, PARALLEL, async (s) => {
    try {
      const info = urls.get(s._src);
      const url = info ? info.url : 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(s._src);
      let svg = slimSvg(await get(url));
      if (!/<svg[\s>]/i.test(svg)) throw new Error('kein SVG');
      const sz = svgSize(svg);
      if (sz && !sz.hasVB && sz.px) svg = svg.replace(sz.tag, sz.tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${sz.w} ${sz.h}"`));
      await writeFile(path.join(ROOT, s.file), svg);
      setRatio(s, svg);
      s._local = true;
    } catch (e) {
      // 404 = Dateiname ist auf Commons eine Weiterleitung -> Special:FilePath löst sie auf
      if (/HTTP 404/.test(String(e.message))) s._remote = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(s._src.replace(/ /g, '_'));
      failed.push({ id: s.id, file: s._src, error: String(e.message || e) });
    }
    if (++done % 20 === 0) { await writeData(); console.log(`  ${done}/${todo.length} geladen, signs.js: ${out.count}`); }
  });
  await writeData();

  // ------------------------------------------------------------ Validierung
  const problems = [];
  const ids = new Set();
  for (const s of out.signs) {
    if (ids.has(s.id)) problems.push('doppelte id ' + s.id);
    ids.add(s.id);
    for (const k of ['id', 'base', 'name', 'cat', 'section', 'file', 'ratio']) if (s[k] === undefined || s[k] === null || s[k] === '') problems.push(`${s.id}: Feld ${k} fehlt`);
    if (!['gefahr', 'vorschrift', 'richt', 'markierung', 'einrichtung', 'zusatz'].includes(s.cat)) problems.push(`${s.id}: cat ${s.cat}`);
    if (/^https?:/.test(s.file)) continue;   // noch nicht lokal (Remote-URL)
    try { if (!(await readFile(path.join(ROOT, s.file), 'utf8')).includes('<svg')) problems.push(`${s.id}: kein <svg`); }
    catch { problems.push(`${s.id}: Datei fehlt`); }
  }
  const byName = {};
  for (const s of out.signs) (byName[s.name] ||= []).push(s.id);
  const dupNames = Object.entries(byName).filter(([, v]) => v.length > 1);
  const byCat = {};
  for (const s of out.signs) byCat[s.cat] = (byCat[s.cat] || 0) + 1;
  console.log('Einträge:', out.count, byCat);
  console.log('Fehlgeschlagen:', failed.length, failed);
  console.log('Validierungsprobleme:', problems.length, problems.slice(0, 20));
  console.log('Doppelte Namen:', dupNames.length, dupNames.slice(0, 40));
}

main().catch((e) => { console.error(e); process.exit(1); });
