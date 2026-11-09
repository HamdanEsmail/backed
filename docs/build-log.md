# Backed: build log

What changed from `docs/plans/2026-11-09-backed.md` while I built it, and why, then every paid TinyFish call
with its cost. Written on 9 November 2026, the day it went live.

## What changed from the plan

### The data

- **An eighth table, `ranking`.** The plan lists seven. The ranked order and each investor's slug (the address of
  `/searches/:id/investors/:slug`) are written once when a search is ranked, so pages read them instead of
  ranking again on every view. Each company's points and their parts sit on `company_investors`.
- **Three migrations past the first.** `0002` stores when a search was ranked and how many times an investor's
  lookup was tried; `0003` lets a timed-out announcement be read again; `0004` keeps TinySet's own run start and
  end, so the home can say how long a search took.

### Reading pages

- **Reads wait 15 seconds, not 10, and a passing failure is read again.** On the 30 real restaurant rows, 1 to 4
  announcements timed out at 10 seconds on each pass, and the proof rules would have proved them. A read that
  times out, or meets a 429 or a 5xx, goes back in the queue no sooner than 30 seconds later, up to 3 reads in
  all, before the company is set apart as unreadable. A page that refuses the reader is set apart at once.
- **One `advance` starts no new read after 12 seconds** (18 in the first draft) and checks at most 3
  companies, so a call that starts its last 15-second read still ends inside the time a Worker keeps running
  after its response.
- **Every Fetch call is one ledger row, whatever came of it**, so failed reads show in the figures too.
- **A failed TinySet call is not retried inside the request.** A 429 is thrown and the next minute's `advance`
  tries again; waiting 60 seconds inside a Worker request would hold it past its limit.

### The proof check

- **One-word company names have their own rule.** The plan's one-word rule (a capital letter, a funding sentence)
  set apart real companies whose only funding sentence did not name them, such as "Burnt". A one-word company
  now counts in the page's title or a heading, in a funding sentence, or named twice mid-sentence. Investors keep
  the strict rule.
- **More funding words, and not the bare words "seed" or "series".** Real headlines ("raises $1M pre-seed") were
  often the only sentence naming a company, so the raise and invest forms count. A bare "seed" would match
  sentences about planting seed in the Kenya demo, so only "pre-seed", "seed round", "seed funding" and their
  kin count.
- **A row that names no investor is set apart without reading its page**, so no Fetch is spent to find nothing.
- **The sentence splitter learned two things from real pages**: a hard-wrapped prose line is joined to the next
  (that is what named two investors on one real page), and the "M" in "$1.5M." is not an initial.
- **Each page's sentences are prepared once and each name's pattern compiled once.** Measured on the 22 saved
  real pages, a company's check went from a median of 1.7 ms (worst 7.1 ms) to 0.8 ms (worst 2.7 ms).

### Money

- **A run's cost is the wallet difference, capped at the $3 budget.** The first draft capped it at the usable
  rows times $0.10, which would under-book a failed run that left few rows. When the wallet shows no difference,
  the rows TinySet filled are booked at $0.10 each.
- **A run ends when the dataset or the run says it is done, failed or cancelled.** TinySet's `empty` alone
  ends nothing, in case it is reported before the first row lands.

### The way in

- **A door is a shallow page on their own site** (at most two path parts, one of them apply, pitch, submit or
  contact) or a link to a form service. A blog article with "pitch" in its address was counted as a form before
  this rule.
- **TinyFetch's markdown drops link addresses**, so the door is found from `links: true`, a separate list.

### The site

- **No script at all.** The plan allowed a few lines to smooth the running page; it reloads itself every 5
  seconds with a `meta refresh` instead, and the content-security policy allows no inline code.
- **Copy changed from the comp**: the score sheet's "read today" is "read when the search ran" (a stored search
  was not read today); the footer counts the saved searches from the database instead of naming three that did
  not exist yet; a led deal names its partner or says the announcement names none.
- **A second search from the same visitor is refused**, so the running page's link is the plain "Search for
  another startup", and the refusal shows on the home's form.
- **The CSV is also at `/api/searches/:id.csv`**, the same file as the page's export.
- **No preview uploads at Tasks 4 and 5.** I looked at the site locally against a copy of the real restaurant
  search instead (headless Chrome at 1440 and 390) and kept every Cloudflare upload for the deploy that Hamdan
  approved.

## What the two paid demo searches got wrong

Neither is thin: each proved 22 companies. These are the faults I found reading them, most visible first. None
is fixed yet.

**Cold storage, Kenya, pre-seed** (27 found, 22 proved, 5 set apart, 68 investors):

1. The second investor, Mercy Corps Ventures, was given Preqin's site: Search found a data vendor's page, so its
   "open form" is Preqin's contact page. The site picker skips databases and the press, but not Preqin.
2. The third, Corton Investments, is there for a $25,000 prize offered to a competition winner, read as a led
   seed round.
3. Only three companies are in Kenya, and fewer than half store or cool produce. TinySet also returned frost spray,
   vertical farming, grocery ordering and two food-waste marketplaces. The country adds one point and is not a
   filter, by design, but the list reads wider than the line.
4. One partner is given to both co-leads of the same round (the row has one partner field for the company).
5. "Caret Capital & Indigram Labs" is one name: an ampersand does not split a cell, because firm names use it too.

**Arabic AI tutor, United Arab Emirates, seed** (29 found, 22 proved, 7 set apart, 79 investors):

1. No company teaches in Arabic and none is in the UAE; the nearest are two in Egypt. The list is a good list for
   "an AI tutor for school students" and says nothing about the Arabic half of the line.
2. The fourth, Day One Capital, is proved by the firm's own description ("…focused on backing…"), not by a sentence
   about the round. The page spells it "DayOne Capital" in its funding sentences, so the whole-name match missed
   them.
3. The seventh, MRG Economic Group, was given a startup directory as its site, the same fault as Preqin above.
4. "Angel investors from Anthropic, OpenAI, Sierra, Ramp, Cognition" gave four companies a place as investors, and
   "entrepreneurs" and "operators" passed as names. The generic filter misses bare plural nouns and "angel
   investors from …".
5. The first, Owl Ventures, is first through two Series A rounds (the stage next to seed earns a point, by design),
   and its site could not be read.
6. Four rows were set apart for having no announcement date, and three eu-startups.com pages could not be read.

## Paid calls

TinySet runs are the only paid calls. Each is booked once, when the run ends, from the wallet difference.
Fetch, Search and the wallet read are free and booked at $0 per call.

| When | What | Cost |
|---|---|---|
| Before the build | The spike's TinySet runs, including the restaurant dataset adopted as demo 1 | $1.20 |
| 9 Nov, Task 6 | Demo 1, restaurant software, United States, seed: the finished dataset adopted with the admin import | $0.00 |
| 9 Nov, Task 6 | Demo 2, cold storage for smallholder farmers, Kenya, pre-seed: one TinySet run (`8nv424ha5tmn`), 27 rows | $0.60 |
| 9 Nov, Task 6 | Demo 3, an Arabic AI tutor for school students, United Arab Emirates, seed: one TinySet run (`t8mcb97ubdl8`), 29 rows | $1.10 |
| | **In all** | **$2.90** |

The two demo runs cost $1.70 by the wallet ($38.752 before, $37.052 after). The ledger booked $0.50 for each,
$1.00 in all. The wallet is read the moment a run ends, and the likeliest reason is that part of each run was
billed after that read. The ledger is short by $0.70, so the spend stop sees less than was spent. The fix is to
read the wallet again a few minutes after a run ends and book the difference.
