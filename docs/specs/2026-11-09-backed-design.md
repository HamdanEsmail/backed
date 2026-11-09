# Backed: design

9 November 2026. My entry for the TinyFish Funding Radar bounty (closes 17 November 2026).

## 1. What it is

A founder types one line about their startup, with a stage and a country. Backed finds companies like it that
raised money in the last 18 months, checks every one against its own funding announcement, works out who backed
them, and returns a ranked list of investors. Every match carries its proof: the sentence from the announcement
that names the investor, read live, with the link. Every point in the ranking is shown. For each investor it says
the way in.

The bounty asks for: a short startup description as input; at least 10 similar companies that raised recently, from
live sources; a ranked list of investors, each with the similar companies they backed (with links), typical cheque
size and stage, the partner who led the deal, and how to reach them; the reason for each rank; a demo on at least
three different startups; and TinySet at the centre. Judges weigh match quality, proof, useful detail, ranking, and
whether it works across very different startups.

## 2. What I tested on 9 November 2026

- **TinySet** (`POST /v1/datasets`, a `spec` with my own columns, `target_rows` 30) returned 30 companies for
  "early-stage restaurant operations software since May 2025" in about five minutes, and 10 rows in about two
  minutes. Rows arrive while the run is in progress. A row is only `{ _id, data }`: there is no source per cell.
- TinySet does not enforce a date window or a stage by itself. A boolean column named `in_scope`, described in
  words and used as `keep_when`, keeps most rows in scope, but the product still checks date and stage itself.
- Fields that came back on most rows: company, website, country, description, round type, amount, announcement
  date, lead investor, other investors, founders, announcement URL. The lead partner came back on about half.
- **The proof check** with TinyFetch (free): of 30 rows, 21 were proved (the linked page names the company and at
  least one listed investor) and 9 were set apart (no link, a page that could not be read, a page that names none
  of the listed investors). The sentence that names an investor can be cut out of the page text and quoted.
- **Cost.** The wallet fell $0.40 for the 10-row run and $0.80 for the 30-row run, so a search costs about $1.
  The rate card says $0.10 a row, so a search is budgeted at $3 until more runs confirm the lower figure.
  `POST /v1/datasets/plan` is free. Fetch and Search are free on this account.
- Ranking by simple sums put the two investors who each backed two similar companies first, which is the result a
  founder wants.
- The home pages of the top three investors showed no open application link, so the warm route matters.

The scripts and the real responses are in `../spikes/funding-radar-9nov/` (`spec-2.json`, `rows-2.json`,
`verify.mjs`, `group.mjs`, `ranked-2.json`). They are reference only and are never copied into this repository.

## 3. How a search runs

A search is a row with a state. One function, `advance(searchId)`, moves it forward a little each time it is
called and is safe to call twice. It is called by the search's own page (every few seconds while someone watches)
and by a cron job every minute, so a search finishes even when nobody is watching.

1. **`finding`.** The Worker builds a TinySet spec from the founder's line (section 4) and creates the dataset
   with 30 rows. Each `advance` reads the dataset's status and rows and stores new or changed rows.
2. **`checking`.** Each `advance` takes a few unchecked companies (at most 5 per call) and runs the proof check
   on each (section 5). Checking starts while TinySet is still finding, so the page fills as it goes.
3. **`ranking`.** When the dataset is `ready` and every company is checked, the investors are grouped and scored
   (section 6) and the way in is looked up for the top 10 (section 7), a few per call.
4. **`ready`.** The search is finished and kept. **`failed`** when TinySet fails or returns nothing; the reason
   is shown, and nothing is ranked from a half result unless at least 5 companies were proved.

`advance` never sits in the way of a page. A page or an API read answers at once from what is stored, and asks
for an `advance` to run after the response has been sent (`waitUntil`); the cron calls it directly. A read of an
announcement waits at most 10 seconds.

Only one search runs at a time; a second waits in a queue (`queued`). The wallet is read before a run starts and
after it ends, and the difference is the search's real cost in the ledger. That holds while Backed is the only
user of this TinyFish account; if another project shares the key, cost is counted from the rows instead.

The same line, stage and country within 7 days opens the stored search instead of starting a new one.

## 4. From the founder's line to a TinySet spec

No model of my own reads the line. The line goes into the spec's description and into the `in_scope` column's
hint, and TinySet does the judging:

- `description`: "Startups similar to this one: \"<line>\". Companies that build a comparable product for
  comparable customers and that announced a <stages> funding round on or after <date>. One row per company, for
  its most recent such round."
- `<stages>`: the founder's stage and the ones next to it, out of pre-seed, seed, Series A, Series B.
- `<date>`: 18 months before today, to the first of that month.
- Columns (fixed): `company` (key), `website` (unique), `country`, `description`, `round_type`, `amount_raised`
  (US dollars), `announcement_date`, `lead_investor`, `lead_investor_website`, `other_investors`, `lead_partner`,
  `founders`, `announcement_url`, `in_scope` (boolean, `keep_when`). Their hints are the ones in
  `../spikes/funding-radar-9nov/spec-2.json`, with the restaurant wording replaced by the founder's line.

The spec that was sent is stored with the search and shown on the search's page ("What TinySet was asked"), so
anyone can see that the list came from the line and not from a fixed set.

Input limits: the line is 20 to 140 characters; stage is one of four; country is a name from a fixed list of
countries. A line with a URL or an email address is refused.

## 5. The proof check

For one company row:

1. Refuse without reading: no announcement URL; no announcement date; a date before the window; a round that is
   not one of the stages asked for. Each has its own reason.
2. Read the announcement URL with TinyFetch (markdown, `ttl: 0`). No text: "the announcement could not be read".
3. The page must name the company. Then every listed investor (lead and others) is looked for by name.
   Names are compared after lowercasing, stripping accents and punctuation, and dropping words like Inc, LLC, Ltd.
   An investor counts for this company only when the page names it. Generic entries ("angel investors",
   "existing investors", "others") are never investors.
   A name that is one ordinary word (real examples: Headline, True, Neo, Turbo, Aperture) would be "found" on
   almost any page. Such an investor counts only when it appears with its capital letter, as a whole word, inside
   a sentence that also has a funding word: led, co-led, participation, participated, investors, investment,
   backed, joined, round, funding, financing, the forms of raise, and the stages in their funding forms only
   ("pre-seed", "seed round", "seed funding", "Series A" to "Series D"; never a bare "seed" or "series").
   A one-word company name is held to a looser rule, because an article about a company names it all through
   while its funding sentence often says "the company": it counts when it appears with its capital letter as a
   whole word in the title or a heading, in a funding sentence, or at least twice in the text where it is not
   the first word of its sentence.
4. For each named investor, the sentence that names it is cut from the page: back to the previous sentence end,
   forward to the next, trimmed to the clause around the name when it is long (about 170 characters), with "…"
   where it was cut. This is the quotation. The partner and the founders are kept only when the page names them.
5. A company with no named investor is set apart: "the linked page names none of the listed investors".

Stored per company: the facts, the page's URL, the time it was read, which investors were named, each quotation.
A company is **proved** or **set apart with a reason**. Nothing else.

## 6. The score

For every proved company an investor is named on:

| | Points |
|---|---|
| Backed it | 3 |
| Led the round | 2 |
| The round is at the founder's stage | 2 |
| The round is at the stage next to it | 1 |
| The company is in the founder's country | 1 |
| Announced in the last six months | 1 |

An investor's score is the sum over its companies. Order: score, then number of companies, then name. The parts
are stored, and every screen and export shows them. No points for size or fame.

Shown beside each investor, from the rounds found: the stages it joined and the range of round sizes ("seed rounds
of $3.5M to $7M"). This is called "rounds they joined", never "cheque size". A cheque size is shown only when the
investor's own site states one (section 7), quoted with its link; otherwise "cheque size not stated on their site".

## 7. The way in

For the top 10 investors of a search, once:

1. **Their site.** The lead-investor website from the row when there is one; otherwise TinySearch for the
   investor's name with "venture capital", taking the first result whose title or domain contains the name. A site
   found by search is marked as such. No site found: say so.
2. **An open door.** Read the site's home page with TinyFetch and look for a link whose text or address says
   apply, pitch, submit, or contact, and for a published email address. If a link is found, read that page too and
   keep its address. Result: "Open form: <link>", or "Email published: <address>", or "No open form found on
   their site, read <date>".
3. **A cheque size**, only if the home page or that page states one in plain figures; quoted.
4. **The warm route**, always: the founders of the companies this investor backed in this search, by name, with
   the company; and the partner who led, where the announcement named one.
5. **A first line** for the founder's email, built only from proved facts by a fixed template, for example:
   "You led Arc's seed round in May 2026; we are building <line, lowercased> at the same stage."

Investor lookups are kept in their own table and reused across searches for 30 days.

## 8. Watching a saved search

A saved search can be watched. A TinyFish Topic Monitor runs a search query built from the line ("<key words>
raises seed funding") once a day. When it reports new results, each new page is read with TinyFetch; a page that
reads as a funding announcement for a company not yet in the search is added as a company "found by the watch",
put through the same proof check, and the ranking is recomputed. The search's page shows "New since <date>".
The three demo searches are watched for the length of the review. Public searches are not watched.
A Monitor run is the only thing that adds a company after a search is ready.

The watch is built last, after the product is live, and only ships if a Topic Monitor on the demo lines returns
funding announcements cleanly. Until then Backed runs on TinySet, Fetch and Search, and says so.

## 9. Where TinyFish is used

| Service | Job |
|---|---|
| TinySet | Finds the companies like the founder's that raised, with round, investors, partner, founders and link |
| Fetch | Reads every announcement for the proof check; reads investor sites for the way in |
| Search | Finds an investor's own site when the row has none |
| Monitor | Watches a saved search for new rounds |

Every call is one row in a spend ledger. The About page and `/api/stats` show calls and spend per service.

## 10. Limits and money

- A new search is budgeted at $3 and has cost about $1. All paid work stops when total spend reaches **$9**; stored
  searches stay readable and the form says why it is closed.
- Public visitors: **3 new searches a day in total**, 1 per visitor a day, and one search running at a time.
  Opening a stored search is free and not limited.
- A visitor is known only by a salted hash of their IP address.
- A public search is kept for 7 days, then deleted with its companies. The three demo searches are kept.
- Only public pages are read, one at a time. Nothing is read behind a login. A page that cannot be read is
  reported as such.
- People named on the site are named in a public funding announcement, as founders or as the partner on a deal.
  The site shows only what the announcement says about them, with its link.

## 11. Screens

The look is in `DESIGN.md` and `design/comp-home.html`.

- **Home `/`.** The stage with the form. In the column: the featured demo search exactly as in the comp (first
  investor's sheet, the next five, the two cells), how a search runs, the score sheet, every company, the figures,
  the plain ask, the footer. The three demo searches are linked.
- **A search `/searches/:id`.** The stage shows the line, stage and country, and the live figures (found, proved,
  set apart, investors). While running, the column shows companies as they arrive, each "proved" with its lead
  investor or "set apart" with its reason, and the page refreshes itself; when ready, it shows the ranked list in
  full (every investor, the first ten with their way in), then the companies, then "What TinySet was asked".
- **An investor in a search `/searches/:id/investors/:slug`.** The white sheet at full length: every deal with its
  quotation, source and sum, rounds they joined, the way in, the first line.
- **Saved searches `/searches`**, **The score `/score`**, **API `/api`**, **About `/about`**, not found.
- Exports: `/searches/:id.json` and `/searches/:id.csv` (one row per investor and company, with the quotation,
  the proof URL, the read time and the points).

Honest states, in these words:

| Situation | The page says |
|---|---|
| Fewer than 10 companies proved | "Only N companies like this were proved. The list is thin: read it as a start." |
| No companies found | "TinySet found no companies like this that raised since <date>. Try describing the product and its customer in other words." |
| A company set apart | Its reason, in the list of companies |
| Partner not named | "The announcement names no partner." |
| No way in found | "No open form found on their site, read <date>." |
| Search limit reached | "Today's 3 new searches are used. Stored searches still open." |
| Spend stop reached | "New searches are closed: this demo has spent its budget. Stored searches still open." |
| Search failed | "This search did not finish: <reason>. Nothing was ranked." |

## 12. API

- `POST /api/searches` `{ line, stage, country }` → `202 { id, state, cached }`
- `GET /api/searches/:id` → the search, its figures, investors (with deals, quotations, parts, way in), companies
- `GET /api/searches/:id.csv`
- `GET /api/searches` (the saved ones), `GET /api/stats`
- Admin (token): `POST /api/admin/searches` (not limited), `POST /api/admin/import` `{ dataset_id, line, stage,
  country }` (adopts a finished TinySet dataset without paying for it again), watch and unwatch.

## 13. Stack

One Cloudflare Worker: TypeScript, Hono with `hono/jsx`, D1, static assets, a cron every minute. Vitest in the
Workers pool. The same conventions as my Standing and Fineprint builds; `../standing/src/tinyfish/` already has a
tested TinyFish client, Fetch, Search and Monitor to copy and adapt. New here: the Datasets client.

Secrets: `TINYFISH_API_KEY` (the second account's key, from `../.tinyfish.env`), `ADMIN_TOKEN`, `WEBHOOK_SECRET`.

## 14. Not doing

Accounts. Email sending. Scraping investor databases. Anything behind a login. A model of my own to judge
similarity or write text. Contact details beyond what an investor publishes on its own site.
