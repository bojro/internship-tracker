// Reads alerts.json (written by poll.mjs) and fans new watched-firm hits out to
// Discord (which pushes to the Discord mobile app). Writes email-{subject,body}.txt
// for the workflow's Gmail step. Breakage alerts included. Secrets: DISCORD_WEBHOOK.
// A missing secret just skips that channel.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

if (!existsSync('alerts.json')) process.exit(0);
const { newWatched = [], newUnwatched = [], broken = [] } = JSON.parse(readFileSync('alerts.json', 'utf8'));
const { DISCORD_WEBHOOK } = process.env;

const line = (p) => `${p.hot ? '🔥 ' : ''}${p.firmName} — ${p.title}${p.locations?.length ? ` · ${p.locations[0]}` : ''}  ·  ${p.sources.join('+')}${p.sourceCount > 1 ? ' ✓' : ''}\n${p.url || '(no link)'}`;
const uline = (p) => `${p.company} — ${p.title}${p.locations?.length && p.locations[0] ? ` · ${p.locations[0]}` : ''}  ·  ${p.sources.join('+')}\n${p.url || '(no link)'}`;

async function post(url, opts) { try { const r = await fetch(url, opts); if (!r.ok) console.error(`alert http ${r.status}`); } catch (e) { console.error('alert err', e.message); } }

async function discord(content) {
  if (!DISCORD_WEBHOOK) return;
  await post(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1990), username: 'Internship Tracker', avatar_url: 'https://raw.githubusercontent.com/bojro/internship-tracker/main/bd.png', allowed_mentions: { parse: ['everyone'] } }) });
}

if (newWatched.length || newUnwatched.length) {
  const parts = [];
  const subjects = [];
  if (newWatched.length) {
    const header = `📌 ${newWatched.length} new watched-firm posting${newWatched.length > 1 ? 's' : ''}`;
    parts.push(`**${header}**\n\n` + newWatched.map(line).join('\n\n'));
    subjects.push(header);
  }
  if (newUnwatched.length) {
    // recall-first tier: unwatched companies, capped in the message, never dropped silently
    const shown = newUnwatched.slice(0, 8);
    const header = `🌱 ${newUnwatched.length} new unwatched posting${newUnwatched.length > 1 ? 's' : ''}`;
    parts.push(`**${header}** (judge these yourself - recall over precision)\n\n`
      + shown.map(uline).join('\n\n')
      + (newUnwatched.length > 8 ? `\n\n…+${newUnwatched.length - 8} more in postings.json` : ''));
    subjects.push(header);
  }
  // @everyone ping only for watched-firm hits; unwatched-only messages stay quiet
  await discord((newWatched.length ? '@everyone\n' : '') + parts.join('\n\n'));
  writeFileSync('email-subject.txt', `[Internships] ${subjects.join(' · ')}`);
  writeFileSync('email-body.txt', [...newWatched.map(line), ...newUnwatched.map(uline)].join('\n\n'));
  console.error(`sent ${newWatched.length} watched + ${newUnwatched.length} unwatched alerts`);
}

if (broken.length) {
  const msg = `⚠️ Internship tracker: source(s) failed to parse — ${broken.join(', ')}. Check scripts/poll.mjs parsers.`;
  await discord(msg);
  console.error('breakage alert sent:', broken.join(','));
}
