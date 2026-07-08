// Reads alerts.json (written by poll.mjs) and fans new watched-firm hits out to
// Discord + ntfy (iOS push). Writes email-{subject,body}.txt for the workflow's
// email step (only when there's something to send). Breakage alerts included.
// Secrets come from env: DISCORD_WEBHOOK, NTFY_TOPIC. All channels are optional —
// a missing secret just skips that channel.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

if (!existsSync('alerts.json')) process.exit(0);
const { newWatched = [], broken = [] } = JSON.parse(readFileSync('alerts.json', 'utf8'));
const { DISCORD_WEBHOOK, NTFY_TOPIC } = process.env;

const line = (p) => `${p.hot ? '🔥 ' : ''}${p.firmName} — ${p.title}${p.locations?.length ? ` · ${p.locations[0]}` : ''}  ·  ${p.sources.join('+')}${p.sourceCount > 1 ? ' ✓' : ''}\n${p.url || '(no link)'}`;

async function post(url, opts) { try { const r = await fetch(url, opts); if (!r.ok) console.error(`alert http ${r.status}`); } catch (e) { console.error('alert err', e.message); } }

async function discord(content) {
  if (!DISCORD_WEBHOOK) return;
  await post(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1900) }) });
}
async function ntfy(title, body, url, tags) {
  if (!NTFY_TOPIC) return;
  const h = { Title: title, Tags: tags };
  if (url) h.Click = url;
  await post(`https://ntfy.sh/${NTFY_TOPIC}`, { method: 'POST', headers: h, body });
}

if (newWatched.length) {
  const header = `📌 ${newWatched.length} new watched-firm posting${newWatched.length > 1 ? 's' : ''}`;
  await discord(`**${header}**\n\n` + newWatched.map(line).join('\n\n'));
  // one ntfy push per posting (so each is tappable to its apply link)
  for (const p of newWatched) {
    await ntfy(`${p.hot ? '🔥 ' : ''}${p.firmName} posted`, `${p.title}${p.locations?.length ? ` · ${p.locations[0]}` : ''}`, p.url, p.hot ? 'fire,briefcase' : 'briefcase');
  }
  writeFileSync('email-subject.txt', `[Internships] ${header}`);
  writeFileSync('email-body.txt', newWatched.map(line).join('\n\n'));
  console.error(`sent ${newWatched.length} alerts`);
}

if (broken.length) {
  const msg = `⚠️ Internship tracker: source(s) failed to parse — ${broken.join(', ')}. Check scripts/poll.mjs parsers.`;
  await discord(msg);
  await ntfy('⚠️ Tracker source broken', broken.join(', '), null, 'warning');
  console.error('breakage alert sent:', broken.join(','));
}
