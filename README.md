# internship-tracker

Polls community internship trackers every 30 min via GitHub Actions, corroborates
across sources, and pushes new **watched-firm** SWE-intern postings to Discord + ntfy
(iOS) + email. Commits a static `postings.json` the prep dashboard reads.

- `scripts/poll.mjs` — fetch + normalize + corroborate + diff → `postings.json`
- `scripts/alert.mjs` — fan new watched hits to Discord / ntfy / email bodies
- `watchlist.json` — 50 watched firms + hot-list (edit to change what alerts)
- `.github/workflows/poll.yml` — the cron

## One-time setup (all free)

1. **Create a PUBLIC GitHub repo** named `internship-tracker`, push this folder.
   (Public = unlimited Actions minutes; private caps at 2000/mo which 30-min polling exceeds.)
2. **Repo → Settings → Secrets and variables → Actions**, add:
   - `DISCORD_WEBHOOK` — a channel webhook URL (Discord: Server Settings → Integrations → Webhooks → New).
   - `GMAIL_USER` — your gmail address.
   - `GMAIL_APP_PASSWORD` — Google Account → Security → 2-Step Verification → App passwords → generate one for "Mail". (Not your normal password.)
   - `ALERT_EMAIL` — where alerts land (can be the same gmail).
   Any secret you skip just disables that channel.
3. **Actions tab → enable workflows** → run `poll-internships` once manually (workflow_dispatch).
   First run seeds `postings.json` with zero alerts; subsequent runs alert only on new postings.

## Dashboard wiring
The prep dashboard fetches:
`https://raw.githubusercontent.com/<your-gh-username>/internship-tracker/main/postings.json`
Set `<your-gh-username>` in `prep-dashboard/src/data/postingsFeed.js`.
