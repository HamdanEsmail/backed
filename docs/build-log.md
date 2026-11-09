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

### After the demo searches (Task 6)

Reading the two paid searches (below) showed faults in their top tens. I fixed them before the site went on,
with no paid call: both searches were checked again against their stored rows with free Fetch reads and
ranked again in place.

- **People named by what they are, and their employers, are not investors.** "Entrepreneurs", "operators",
  "founders", "executives" and the like are dropped, and so is "angel investors from A, B, C" with the names
  after it up to the next semicolon: those are the angels' employers.
- **An investor's site needs its name in the domain.** Search had given one investor a data vendor's site and
  another a startup directory. A skip list of such sites was not enough (the next answers were a news site and
  an agency's partner page), so a site now counts when its domain holds the name, or a short form of it that
  keeps the first word whole, or when the page's title starts with the name on a domain that starts with the
  first word. Otherwise the page says no site was found. This also corrected two investors in the restaurant
  search (a domain that held only part of the first word, and a fundraising platform's page).
- **A name's words may run together** ("DayOne Capital" for Day One Capital), and an investor's quotation is the
  funding sentence that also names the company before one that only has a funding word. A firm's own
  description ("…focused on backing founders…") was standing as proof.
- **A run's cost is settled from a second wallet read**, ten minutes after it is booked, when no later run has
  started. The demo runs were booked at the moment they ended, before all of each run was billed.
- **Name patterns are built without Unicode classes.** Compiling one `\p{L}` pattern per investor cost a new
  isolate up to 400 ms of CPU on the home; the letters either side of a match are now checked with one shared
  pattern. The home's median fell from 169 ms to 31 ms.
- **A prize is not a round.** When every sentence that names a company's investors is about a prize, a
  competition, an award, a pitch win or a grant, the company is set apart: "a prize, an award or a grant, not an
  investment round". "An award-winning startup raised…" still counts.
- **When no proved company is in the founder's country, the search page says so** above the list: "None of these
  companies is in the United Arab Emirates. This list shows who funds companies like this elsewhere."
- **A partner belongs to the lead named beside them.** With two leads, the partner is shown on the lead its
  sentence names, and on none when no sentence gives the partner to one (`companies.partner_leads_json`).
- **"A & B" in a lead cell is two firms** when the page names each on its own and never the pair as one name.
  Each part must be two words or more, so "Wexley & Co" stays whole.

### Watching a saved search (Task 7)

**The free look.** The plan asked whether TinySearch for each demo line ("<key words> raises seed funding")
returns funding announcements. Five free searches on 9 November, ten results each:

| Line | Query | What came back |
|---|---|---|
| Restaurant | restaurant food waste software raises seed funding | 8 of 10 are funding announcements (Phood, ClearCOGS twice, Orbisk, Flowaste, Afresh twice, Freshflow), but nearly all from 2018 to 2022; only ClearCOGS (April 2025) is near the window |
| Kenya | cold storage smallholder farmers raises seed funding | 2 of 10, both SokoFresh money from UNCDF; the rest are USDA grant pages, agency articles and research papers. The pre-seed form of the query with "Kenya" was worse |
| UAE | Arabic AI tutor raises seed funding | 7 of 10 are announcements, several recent (Aristotle, September 2026; Astral, the same day; Nanovate, October 2025; Edumentors; Medly). A second form without "Arabic" gave the same names |

Two of three lines pass, so the watch was built. Read through the watch's own reader and the proof check (free
Fetch reads), the real pages give: restaurant, nothing in the window; Kenya, nothing proved (SokoFresh has no
round stage); UAE, two companies proved, Astral (MapleVC) and Aristotle (True Ventures, Wicklow Capital).

**How it was built.**

- **A page is read as a row's facts, then checked like a row.** A Monitor result is an address and a headline,
  while the proof check needs the facts a TinySet row gives. `src/watch/announcement.ts` reads them from the page
  without a model: the company is the headline's subject before "raises", "secures" and the like (words that
  describe it, "Cairo AI startup", are dropped), and it must be named in a funding sentence of the body;
  investors come only from "led by …" and "participation from …" in funding sentences that name the company or
  follow one about "the round"; the round, the dollar sum and the date are read where they are written plainly.
  Anything unclear is left out, and the proof check then refuses the page. A headline that leads with the
  investor ("X leads $8m round in Y") names no company and adds nothing.
- **Only a proved company is written.** A page that is not an announcement, or that the check refuses (a grant,
  no date, no investor named), leaves no company, only its line in `watch_hits` with the reason.
- **"Angel investors from A, B" in a page drops the employers**, as in a TinySet cell. The first read of the real
  Aristotle page made OpenAI, Sierra, Ramp and Cognition investors; fixed and tested before anything shipped.
- **A watched search is ranked again in place.** Its page stays ready throughout (no running view on a demo
  page); the way in for an investor new to the top ten is looked up then, or by the next minute's cron.
- **Each Monitor run is booked once at $0.005**, a run delivered twice changes nothing, and a result is read once
  per search. The cron deletes a watch's Monitor after its last day, and every watch's Monitor once the spend stop
  is reached. Backed deletes only the Monitor ids it stored; it never lists, pauses or edits any other.
- **Migration `0007`**: `watches`, `watch_runs`, `watch_hits`. The search's page says "New since <date>" with the
  companies the watch added, and marks each one "Found by the watch" in the list of companies.
- **Live on 9 November** (version `c88bbb30`), with Hamdan's yes: migration `0007` applied first, then the deploy,
  then the three Monitors, watching the demo searches until 17 November at 06:00 and 18:00 UTC. Each Monitor
  reads "active" with no error. Their creation runs sent no webhook (nothing new within the day), and the wallet
  had not moved from $37.052 three minutes later, so the $0.005 rate is still to be confirmed against it.

## What the two paid demo searches got wrong

Neither is thin. These are the faults I found reading them, most visible first, and what became of each. Each
search was checked again twice from its stored rows; the figures moved a little between reads, because a page
that timed out once may answer the next time, and the other way round.

**Cold storage, Kenya, pre-seed.** First run: 27 found, 22 proved, 5 set apart, 68 investors. Now: 22 proved
(one set apart as a prize, one announcement read that could not be read before), 71 investors.

1. *Fixed.* The second investor, Mercy Corps Ventures, was given Preqin's site, so its "open form" was Preqin's
   contact page. It now says no site of its own was found.
2. *Fixed.* The third, Corton Investments, was there for a $25,000 prize offered to a competition winner, read as
   a led seed round. That company is now set apart as a prize, and Corton is off the list.
3. *Fixed.* One partner was given to both co-leads of Solgram's round; it is now shown on DSG Consumer Partners
   only, the firm its sentence names.
4. *Left.* Only three companies are in Kenya, and fewer than half store or cool produce. TinySet also returned
   frost spray, vertical farming, grocery ordering and two food-waste marketplaces. The country adds one point and
   is not a filter, by design, but the list reads wider than the line.
5. *Left.* "Caret Capital & Indigram Labs" is still one name: its page never names the two firms apart.
6. *Left.* World Fund is now second, through Barocal (refrigerant-free cooling, Cambridge), whose announcement
   could not be read the first time.

**Arabic AI tutor, United Arab Emirates, seed.** First run: 29 found, 22 proved, 7 set apart, 79 investors. Now:
24 proved, 5 set apart, 79 investors (the seven wrong names gone, three eu-startups.com pages read this time).

1. *Said on the page.* No company teaches in Arabic and none is in the UAE; the nearest are in Egypt. The page now
   says that none is in the United Arab Emirates and that the list shows who funds companies like this elsewhere.
   It stays the third demo, as it is.
2. *Fixed.* The fourth, Day One Capital, was proved by the firm's own description, not by a sentence about the
   round, because the page writes "DayOne Capital". It is now quoted from the sentence about imagi's round.
3. *Fixed.* The seventh, MRG Economic Group, was given a startup directory as its site. It now says no site of
   its own was found.
4. *Fixed.* "Angel investors from Anthropic, OpenAI, Sierra, Ramp, Cognition" gave four companies a place as
   investors, and "entrepreneurs" and "operators" passed as names. All seven are gone.
5. *Left, by design.* The first, Owl Ventures, is first through two Series A rounds (the stage next to seed earns a
   point), and its site could not be read.
6. *Left.* "Swiss family offices" came in with one of the newly read pages and passes as a name: the generic filter
   knows "family offices" but not a nationality before it. It is outside the top ten.
7. *Left.* Four rows are set apart for having no announcement date, and Sinai.ai's page (Egypt), read the first
   time, could not be read on the second.

## Five faults in how money and failures are handled, 10 November

I read the search's state machine and the watch again with one question: what happens when TinySet, D1 or a
visitor does the unexpected thing. Five answers were wrong. None had happened on the live site; each now has a
test that failed before the fix.

1. **The watches would have ended on the second visitor's search.** The cron ended every watch as soon as one
   more $3 search no longer fitted under the stop, which is from about $6 committed. With $2.92 spent, one
   visitor's finished search and a second one running would have deleted all three Monitors for good, at $6.90.
   The watches now end only when spending itself reaches $9. New searches still close earlier, when one more
   would not fit.
2. **A start that never answered could be paid for twice.** A server error or a dropped connection on the create
   call sent the search back to the queue, and the next minute created a second dataset; the first run, if
   TinySet had made it, was never booked. Now only an answer that says the request was not taken (408, 409, 425,
   429) is tried again. After anything else the search stays `finding`, counted at its $3 budget, and asks
   TinySet for a dataset with its name made since the start. One found is taken up; none after five minutes
   means none was made, and only then is the search queued again. The wallet is stored before the create, so the
   cost is still the wallet's difference.
3. **A dataset that could not be read kept its search running for ever.** The 40-minute limit was checked only
   after a read that worked. A dataset that answered 404, or a TinySet outage longer than the run, left the
   search `finding`, holding the run slot's place in the cron and $3 under the stop. It is now given up on at
   the same 40 minutes: the run is cancelled if it can be, its cost is the wallet's difference or else the rows
   last read, and the page says the run took too long, not that nothing was found.
4. **A run could end without being booked.** The move to `checking` and the ledger row were two writes; a failure
   between them left the run unbooked for good. They are now one write, and the ledger row's id is the search's,
   so a run is booked exactly once.
5. **A Monitor could be left running with no watch.** If the watch could not be stored after its Monitor was
   made, the Monitor ran on, unbooked, with no route to delete it. It is now deleted again when the write fails.

159 tests, 8 of them new.

## The other pages, rebuilt on 10 November

The home and a search's page looked like one product. How it works, the score, the API and the saved searches
did not: each was a narrow column of small text on an empty orange field. Worse, no page linked to how it works
or to the score, so the page that says how TinyFish is used could only be reached by typing its address.

- **Every page now opens as the home does.** The stage holds the page's one line, and one word at the wordmark's
  size starts on the stage and ends on the page: proved, scored, served, stored.
- **Each page shows something real from a stored search.** How it works follows one match from TinySet's row to
  the sentence Fetch read to its points, then lists the rows the check set apart, with the reason. The score
  counts one investor out and adds up the first five. The API prints the first investor as the API answers it.
- **The four TinyFish services are set like the ranked list**: the name large, the calls so far opposite, what
  the service does under it, with the ledger's own figures.
- **A saved search is a full-width band** with its line large and its figures under it, the three fields in turn.
- **The menu reaches every page.** On the home, "How it works" and "The score" still go to the home's own
  sections, and each section now leads on to its page; everywhere else they go to the pages.
- **Small things**: the footer names Monitor with the other three services; a figure such as $0.015 is no longer
  rounded to $0.01; on a phone, the last step no longer touches the dark band under it; a link on a white field
  shows its focus ring in ink.

No script was added and nothing is read from TinyFish to draw these pages. 164 tests.

## Paid calls

TinySet runs and Monitor runs are the paid calls. A TinySet run is booked when it ends, from the wallet
difference, and settled from a second wallet read ten minutes later; a Monitor run is booked at its rate when it
is created or delivered. Fetch, Search and the wallet read are free and booked at $0 per
call. Checking and ranking the two searches again cost nothing.

| When | What | Cost |
|---|---|---|
| Before the build | The spike's TinySet runs, including the restaurant dataset adopted as demo 1 | $1.20 |
| 9 Nov, Task 6 | Demo 1, restaurant software, United States, seed: the finished dataset adopted with the admin import | $0.00 |
| 9 Nov, Task 6 | Demo 2, cold storage for smallholder farmers, Kenya, pre-seed: one TinySet run (`8nv424ha5tmn`), 27 rows | $0.60 |
| 9 Nov, Task 6 | Demo 3, an Arabic AI tutor for school students, United Arab Emirates, seed: one TinySet run (`t8mcb97ubdl8`), 29 rows | $1.10 |
| 9 Nov, Task 7 | Three Topic Monitors created, one for each demo search (creating one runs it once), at the rate known from the first account | $0.015 |
| | **In all** | **$2.915** |

The two demo runs cost $1.70 by the wallet ($38.752 before, $37.052 after). Each was first booked at $0.50, the
difference at the moment the run ended; the rest was billed after that read. The settling read corrected demo 3
to $1.10 by itself. Demo 2's late $0.10 had landed before demo 3 started, where the settling read leaves a run
alone, so I booked it by hand. The $1.20 spent before the build is one `correction` row in the ledger, with its
note as the reference. The ledger now reads $2.90, the build's spend by the wallet, and the spend stop counts it.

## CPU on the live site

Measured with `wrangler tail` on 9 November, ten requests each, after every fix above:

| Request | Median | Worst |
|---|---|---|
| The home | 20 ms | 69 ms |
| A search's page (restaurant) | 15 ms | 34 ms |
| An investor's page | 10 ms | 16 ms |
| A search's CSV | 9 ms | 14 ms |
| The minute's cron, nothing to do | 3 to 6 ms | |

Before the pattern fix the home's median was 169 ms and its worst 430 ms. The worst figures are most likely the
first request a new isolate serves. Every request answered.
