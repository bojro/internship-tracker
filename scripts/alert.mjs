// Reads alerts.json (written by poll.mjs) and fans new watched-firm hits out to
// Discord (which pushes to the Discord mobile app). Writes email-{subject,body}.txt
// for the workflow's Gmail step. Breakage alerts included. Secrets: DISCORD_WEBHOOK.
// A missing secret just skips that channel.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

if (!existsSync('alerts.json')) process.exit(0);
const { newWatched = [], broken = [] } = JSON.parse(readFileSync('alerts.json', 'utf8'));
const { DISCORD_WEBHOOK } = process.env;

const line = (p) => `${p.hot ? '🔥 ' : ''}${p.firmName} — ${p.title}${p.locations?.length ? ` · ${p.locations[0]}` : ''}  ·  ${p.sources.join('+')}${p.sourceCount > 1 ? ' ✓' : ''}\n${p.url || '(no link)'}`;

async function post(url, opts) { try { const r = await fetch(url, opts); if (!r.ok) console.error(`alert http ${r.status}`); } catch (e) { console.error('alert err', e.message); } }

async function discord(content) {
  if (!DISCORD_WEBHOOK) return;
  await post(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1990), allowed_mentions: { parse: ['everyone'] } }) });
}

if (newWatched.length) {
  const header = `📌 ${newWatched.length} new watched-firm posting${newWatched.length > 1 ? 's' : ''}`;
  await discord(`@everyone\n**${header}**\n\n` + newWatched.map(line).join('\n\n'));
  writeFileSync('email-subject.txt', `[Internships] ${header}`);
  writeFileSync('email-body.txt', newWatched.map(line).join('\n\n'));
  console.error(`sent ${newWatched.length} alerts`);
}

if (broken.length) {
  const msg = `⚠️ Internship tracker: source(s) failed to parse — ${broken.join(', ')}. Check scripts/poll.mjs parsers.`;
  await discord(msg);
  console.error('breakage alert sent:', broken.join(','));
}
