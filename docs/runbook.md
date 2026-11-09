# Backed: runbook

One Cloudflare Worker (`backed`) with one D1 database (`backed`), static assets from `public/`, and a cron every
minute. Remote `wrangler` commands need a Cloudflare API token in `CLOUDFLARE_API_TOKEN`; the token and the
secrets are never printed.

## Secrets

| Name | What it is |
|---|---|
| `TINYFISH_API_KEY` | The TinyFish key. A personal key: TinySet refuses an organisation's key. |
| `ADMIN_TOKEN` | Opens `/api/admin/*` (`Authorization: Bearer …`). |
| `WEBHOOK_SECRET` | Salts the visitor hash; later, the path secret of the Monitor webhook. |

Each is set from `.dev.vars` without showing it:

```bash
grep -m1 '^TINYFISH_API_KEY=' .dev.vars | cut -d= -f2- | tr -d '\r\n' | npx wrangler secret put TINYFISH_API_KEY
grep -m1 '^ADMIN_TOKEN=' .dev.vars | cut -d= -f2- | tr -d '\r\n' | npx wrangler secret put ADMIN_TOKEN
grep -m1 '^WEBHOOK_SECRET=' .dev.vars | cut -d= -f2- | tr -d '\r\n' | npx wrangler secret put WEBHOOK_SECRET
```

## First deploy

1. `npx wrangler d1 create backed`, then put the `database_id` it prints into `wrangler.jsonc`.
2. `npm run migrate:remote` (applies `migrations/0001` to `0005`).
3. `npm run check`, then `npx wrangler deploy` with `SITE_ENABLED` `"0"` in `wrangler.jsonc`: the API answers, every
   page path answers the JSON 404.
4. Set the three secrets (above).
5. `GET /api/stats` answers zeros; `POST /api/admin/ping` with the token answers `{ "ok": true }`.

## The three demo searches

Demo searches are kept for good (no expiry) and are listed first. Admin calls are not held to the public limits;
paid ones are still held to the spend stop.

1. **Restaurant software, United States, seed**: adopts the finished TinySet dataset, at no cost.

   ```bash
   curl -X POST "$BASE/api/admin/import" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
     -d '{"dataset_id":"8ebe9d99-112f-4ed1-9471-64ca6ae4d030","line":"Software that helps restaurants waste less food.","stage":"seed","country":"United States","demo":1}'
   ```

2. **Cold storage for smallholder farmers, Kenya, pre-seed** (one paid TinySet run, about $1):

   ```bash
   curl -X POST "$BASE/api/admin/searches" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
     -d '{"line":"Cold storage for smallholder farmers so they lose less of their harvest.","stage":"pre-seed","country":"Kenya","demo":2}'
   ```

3. **Arabic AI tutor, United Arab Emirates, seed** (one paid TinySet run, about $1), started only after search 2
   is `ready` (one run at a time):

   ```bash
   curl -X POST "$BASE/api/admin/searches" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
     -d '{"line":"An AI tutor that teaches school students in Arabic.","stage":"seed","country":"United Arab Emirates","demo":3}'
   ```

Each search moves on by itself (the cron runs `advance` every minute); `GET /api/searches/:id` shows its state.
A run takes 5 to 20 minutes, then the checks and the way in a few minutes more. Its cost is booked from the
wallet when the run ends (`GET /api/stats`, `tinyfish.tinyset.usd`).

## Switching the site on

Only after the three demo searches are in and every route and both exports answer on the live address: set
`SITE_ENABLED` to `"1"` in `wrangler.jsonc`, `npm run check`, `npx wrangler deploy`.

## Watching it

- `npx wrangler tail backed --format pretty` shows each request with its CPU time and any error.
- `GET /api/stats`: searches by state, companies, and every TinyFish call and its cost by service.
- A run's cost is booked when it ends and settled from a second wallet read 10 minutes later
  (`searches.cost_settled_at`); `spend_usd` in `/api/stats` should then match the wallet's fall.
- A search stuck in a state: its row in `searches` (`state`, `dataset_status`, `synced_at`, `failed_reason`), and
  the run slot (`SELECT * FROM run_slot`). A run slot held for more than 45 minutes no longer blocks the queue.

## The limits

All in `src/core/limits.ts`: 3 public searches a day in all and 1 per visitor; one TinySet run at a time; a
search budgeted at $3 until its run is booked; every paid call stops when the ledger plus open budgets would pass
$9. Public searches are deleted after 7 days; demo searches stay.

## Rolling back

`npx wrangler rollback` returns the Worker to the previous version. The site can be switched off alone by
deploying with `SITE_ENABLED` `"0"`; stored searches and the ledger are not touched by either.
