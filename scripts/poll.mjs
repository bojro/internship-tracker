// Internship posting poller + corroborator.
// Runs in GitHub Actions every 30 min. Fetches community trackers, normalizes,
// filters (SWE intern / 2027 / US / any season), corroborates across sources,
// diffs against the previous run, writes postings.json, and returns the list of
// NEW watched-firm hits so the workflow can fire alerts.
// No deps — Node 20+ built-in fetch. Fails soft per-source (breakage-flagged).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'postings.json';
const WATCH = JSON.parse(readFileSync('watchlist.json', 'utf8'));

// ---------- helpers ----------
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const US_STATES = /\b(A[LKZR]|C[AOT]|DE|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]|DC)\b/;
const NON_US = /(canada|ontario|toronto|vancouver|london|united kingdom|\buk\b|ireland|dublin|india|bangalore|hyderabad|singapore|australia|germany|munich|amsterdam|zurich|tokyo|remote in (canada|uk|europe|india))/i;

function isUS(locs) {
  const parts = (Array.isArray(locs) ? locs : [String(locs || '')])
    .flatMap((l) => String(l).split(/;|\||\/|\band\b/i)).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return true;                                  // no location -> keep
  if (parts.some((p) => US_STATES.test(p) || /\b(united states|usa|u\.s\.?|remote us|us remote)\b/i.test(p))) return true; // any US -> keep
  if (parts.every((p) => NON_US.test(p))) return false;                 // every location clearly foreign -> drop
  return true;                                                          // remote/unknown/mixed -> keep (can't-miss)
}
const isIntern = (t) => !/\b(new.?grad|full.?time|graduate (program|scheme)|\bsenior\b|\bstaff\b|principal|\bmanager\b|experienced hire)\b/i.test(t || '');
const isSWE = (t) => {
  const inc = /(software|swe\b|sde\b|developer|programm|engineer|machine learning|\bml\b|\bai\b|artificial intel|deep learning|\bllm\b|\bnlp\b|computer vision|data (scien|engineer)|research (scien|engineer)|robotics|perception|autonom|quant\w*|full.?stack|back.?end|front.?end|embedded|firmware|infrastructure|platform|systems|cloud|devops|\bsre\b|technical)/i.test(t || '');
  const exc = /\b(mechanical|electrical|chassis|civil|chemical|thermal|structural|manufactur|industrial engineer|materials|biomedical|\brf\b|analog|pcb|hardware design|drafter|hvac|petroleum|mining|environmental) (engineer|design|intern)/i.test(t || '') && !/software|firmware|embedded/i.test(t || '');
  return inc && !exc;
};
// term filter: keep current+future (Fall 2026 onwards, from now = July 2026). Drops PAST
// terms (Summer 2026, Spring 2026, etc). Winter = Dec. Date-unknown kept (can't-miss).
const SEASON_MONTH = { winter: 12, spring: 3, summer: 6, fall: 9, autumn: 9 };
const NOW_RANK = 2026 * 12 + 7;
const keepYear = (blob) => {
  const t = String(blob || '').toLowerCase();
  const terms = [...t.matchAll(/(winter|spring|summer|fall|autumn)[ -]?(20(?:2[5-9]|3[01]))/g)];
  if (terms.length) return terms.some((m) => Number(m[2]) * 12 + SEASON_MONTH[m[1]] >= NOW_RANK);
  const years = (t.match(/20(?:2[5-9]|3[01])/g) || []).map(Number);
  if (years.length) return Math.max(...years) >= 2026;
  return true;
};

// company -> watched entry (or null)
const ALIAS = new Map();
for (const w of [...WATCH.watched, ...WATCH.hotlist]) for (const a of w.aliases) ALIAS.set(a, w);
function matchWatch(company) {
  const n = norm(company);
  if (ALIAS.has(n)) return ALIAS.get(n);
  for (const [alias, w] of ALIAS) if (n === alias || n.startsWith(alias + ' ') || n.includes(' ' + alias)) return w;
  return null;
}

// stable key for corroboration/dedup
const keyOf = (p) => `${norm(p.company)}::${norm(p.title).replace(/summer|winter|spring|fall|20\d\d|intern(ship)?/g, '').trim()}`;

// ---------- sources ----------
async function fetchJson(url) { const r = await fetch(url, { headers: { 'User-Agent': 'internship-tracker' } }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
async function fetchText(url) { const r = await fetch(url, { headers: { 'User-Agent': 'internship-tracker' } }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }

async function srcVansh() {
  const d = await fetchJson('https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json');
  return d.filter((x) => x.is_visible !== false).map((x) => ({
    company: x.company_name, title: x.title, locations: x.locations || [],
    url: x.url || x.company_url || '', active: x.active !== false,
    posted: x.date_posted ? x.date_posted * 1000 : null, season: x.season || '', source: 'vansh',
  }));
}
async function srcSimplify() {
  const d = await fetchJson('https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json');
  return d.filter((x) => (x.terms || []).some((t) => /20\d\d/.test(t) && keepYear(t)) && x.is_visible !== false).map((x) => ({
    company: x.company_name, title: x.title, locations: x.locations || [],
    url: x.url || x.company_url || '', active: x.active !== false,
    posted: x.date_posted ? x.date_posted * 1000 : null,
    season: (x.terms || []).filter((t) => /20\d\d/.test(t) && keepYear(t)).join(', '), source: 'simplify',
  }));
}
async function srcSnd() {
  const md = await fetchText('https://raw.githubusercontent.com/sndsh404/summer-2027-internships/main/README.md');
  const rows = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|(.+?)\|(.+?)\|(.+?)\|(.+?)\|(.+?)\|/);
    if (!m) continue;
    const [company, role, loc, link, date] = [m[1], m[2], m[3], m[4], m[5]].map((x) => x.trim());
    if (!company || /company|---/i.test(company)) continue;
    const href = (link.match(/\((https?:\/\/[^)]+)\)/) || link.match(/href="([^"]+)"/) || [])[1] || '';
    const ts = Date.parse(date);
    rows.push({ company: company.replace(/\*\*|\[|\]|↳/g, '').trim(), title: role.replace(/<[^>]+>/g, '').trim(), locations: [loc.replace(/<\/?br\/?>/g, ' ; ')], url: href, active: true, posted: Number.isNaN(ts) ? null : ts, season: '', source: 'snd' });
  }
  return rows;
}

const agoToTs = (v) => { const m = String(v || '').match(/(\d+)\s*(h|d|w|mo|y)/i); if (!m) return null; const ms = { h: 3600e3, d: 864e5, w: 6048e5, mo: 2592e6, y: 31536e6 }[m[2].toLowerCase()] || 864e5; return Date.now() - Number(m[1]) * ms; };
async function srcSpeedy() {
  const md = await fetchText('https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md');
  const rows = [];
  for (const line of md.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cols = line.split('|').map((x) => x.trim());   // [0]='' [1]=Company [2]=Position [3]=Location [4]=Salary [5]=Posting [6]=Age
    if (cols.length < 6) continue;
    if (!cols[1] || /company|---|:--/i.test(cols[1])) continue;
    const company = (cols[1].match(/>([^<]+)</) || [null, cols[1]])[1].replace(/\*\*|\[|\]|↳|<[^>]+>/g, '').trim();
    if (!company) continue;
    const href = ((cols[5] || '').match(/href="([^"]+)"/) || [])[1] || '';
    rows.push({ company, title: (cols[2] || '').replace(/<[^>]+>/g, '').trim(), locations: [(cols[3] || '').replace(/<[^>]+>/g, '').replace(/\+\d+/, '').trim()], url: href, active: true, posted: agoToTs(cols[6] || ''), season: '', source: 'speedy' });
  }
  return rows;
}

// ---------- run ----------
const sources = [['vansh', srcVansh], ['simplify', srcSimplify], ['snd', srcSnd], ['speedy', srcSpeedy]];
const broken = [];
let raw = [];
for (const [name, fn] of sources) {
  try { const r = await fn(); raw.push(...r); console.error(`ok ${name}: ${r.length}`); }
  catch (e) { broken.push(name); console.error(`FAIL ${name}: ${e.message}`); }
}

// filter -> SWE, 2027-ish (vansh repo is all-2027; simplify pre-filtered; snd is 2027 repo), US
const filtered = raw.filter((p) => isSWE(p.title) && isIntern(p.title) && isUS(p.locations) && p.company && keepYear(`${p.title} ${p.url} ${p.season}`));

// corroborate: merge by key, count distinct sources, keep freshest url/posted, OR active
const merged = new Map();
for (const p of filtered) {
  const k = keyOf(p);
  const cur = merged.get(k);
  if (!cur) {
    const w = matchWatch(p.company);
    merged.set(k, { ...p, key: k, sources: [p.source], watched: !!w, firmId: w?.id || null, firmName: w?.name || null, hot: w && WATCH.hotlist.some((h) => h.id === w.id) });
  } else {
    if (!cur.sources.includes(p.source)) cur.sources.push(p.source);
    cur.active = cur.active || p.active;
    if (p.url && !cur.url) cur.url = p.url;
    if (p.posted && (!cur.posted || p.posted < cur.posted)) cur.posted = p.posted; // earliest sighting
  }
}
const now = Date.now();
const all = [...merged.values()].map((p) => ({ ...p, sourceCount: p.sources.length }))
  .sort((a, b) => (b.posted || 0) - (a.posted || 0));

// diff vs previous run for NEW watched hits
const firstRun = !existsSync(OUT);
const prev = firstRun ? { postings: [] } : JSON.parse(readFileSync(OUT, 'utf8'));
const prevKeys = new Set((prev.postings || []).map((p) => p.key));

// 30-day retention: keep active OR recently-posted (open watched roles never age out)
const DAY = 86400000;
const feed = all.filter((p) => p.active || !p.posted || now - p.posted < 30 * DAY);

// NEW watched hits = watched + active + in feed + unseen. Empty on first run (seed only).
const newWatched = firstRun ? [] : feed.filter((p) => p.watched && p.active && !prevKeys.has(p.key));

writeFileSync(OUT, JSON.stringify({ generatedAt: now, count: feed.length, broken, postings: feed }, null, 1));
// emit alert payload for the workflow step
writeFileSync('alerts.json', JSON.stringify({ newWatched, broken }, null, 1));
console.error(`\nfeed=${feed.length} newWatched=${newWatched.length} broken=[${broken}]`);
for (const p of newWatched) console.error(`  ALERT ${p.firmName}: ${p.title} (${p.sources.join('+')})`);
