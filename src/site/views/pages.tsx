// The other pages: how it works, the score, the API and the saved searches. Each opens as the home
// does: the stage holds the page's one line, and one word at the wordmark's size starts on the stage
// and ends on the orange page (proved, scored, served, stored). The column then answers the line
// with something real from a stored search: a match followed from TinySet's row to its points, an
// investor counted out, an answer as the API gives it. A full field closes the page.
import type { Child } from "hono/jsx";
import {
  INVESTOR_REUSE_DAYS,
  PUBLIC_SEARCH_TTL_DAYS,
  PUBLIC_SEARCHES_PER_DAY,
  PUBLIC_SEARCHES_PER_VISITOR_PER_DAY,
  READ_ATTEMPTS,
  READ_TIMEOUT_MS,
  REUSE_DAYS,
  SEARCH_BUDGET_USD,
  SPEND_STOP_USD,
  TARGET_ROWS,
  WAY_IN_TOP,
  WINDOW_MONTHS,
} from "../../core/limits";
import { STAGE_LABELS, type Stage } from "../../core/stages";
import type { readStats } from "../../handlers/stats";
import type { SearchView } from "../../search/read";
import { POINTS } from "../../search/score";
import { SET_APART } from "../../search/words";
import { FirstSheet, Quote, Sum } from "../components";
import { count, host, money, plural, roundStage, shortDate, stageWord } from "../format";
import { Author, Footer, Layout, Nav } from "../layout";
import { ScoreSheet } from "./home";

type Stats = Awaited<ReturnType<typeof readStats>>;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The stage of a page that is not a search: its one line, one action, and figures at its foot. */
function PageStage(props: { line: string; go: { href: string; text: string }; tally: { n: string | number; what: string }[] }) {
  return (
    <div class="stage">
      <div>
        <h1 class="line">{props.line}</h1>
        <a class="go as-link" href={props.go.href}>
          {props.go.text}
        </a>
      </div>
      <div class="tally">
        {props.tally.map((t) => (
          <div>
            <b class="num">{t.n}</b>
            <span>{t.what}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A page that opens like the home: the stage, the supporting sentence, and one word across both. */
function Staged(props: { title: string; description: string; saved: number; stage: Child; say: string; word: string; children?: Child; after?: Child }) {
  return (
    <Layout title={props.title} description={props.description}>
      <div class="split">
        {props.stage}
        <div class="col">
          <header class="hero page">
            <Nav home={false} className="" />
            <p class="say">{props.say}</p>
            <p class="wordmark" aria-hidden="true">
              {props.word}
            </p>
            <div class="wordmark-over" aria-hidden="true">
              <span data-word={props.word}></span>
            </div>
          </header>
          {props.children ?? null}
        </div>
      </div>
      {props.after ?? null}
      <Footer saved={props.saved} />
    </Layout>
  );
}

/** Dollars as the ledger holds them: cents, or tenths of a cent when there are any ("$0.015"). */
const usd = (n: number) => `$${Number.isInteger(Math.round(n * 1000) / 10) ? n.toFixed(2) : n.toFixed(3)}`;

// --- How it works --------------------------------------------------------------------------------

/** One match from the stored search the home shows: the first investor's first deal, in three steps. */
function Followed(props: { view: SearchView }) {
  const { view } = props;
  const inv = view.investors[0];
  const deal = inv?.deals[0];
  if (inv === undefined || deal === undefined) return null;
  const row = view.companies.find((c) => c.id === deal.company_id);
  const link = row?.announcement_url ?? deal.source_url;
  return (
    <section class="block ranked-end" id="one-match">
      <p class="said">One match, followed from TinySet's row to its points</p>
      <article class="first">
        <div class="score">
          <h2>{inv.name}</h2>
          <p class="n num">{deal.points}</p>
        </div>
        <p class="why">
          From the saved search for “{view.search.line}” {deal.company} is one of its {plural(view.figures.proved, "proved company", "proved companies")}, and where{" "}
          {inv.name} earned {deal.points} of its {plural(inv.score, "point")}.
        </p>
        <div class="deal" data-ui>
          <p class="deal-head">
            <b>First, the row TinySet returned.</b>
          </p>
          <p class="row">
            {deal.company}: {stageWord(roundStage(deal.round_type))}, {money(deal.amount_usd) ?? "amount not stated"}, {shortDate(deal.announced_on)}. Lead investor:{" "}
            {row?.lead_investor ?? "none given"}. Other investors: {row?.other_investors ?? "none given"}.
            {link !== null ? (
              <>
                {" "}
                Link: <a href={link}>{host(link)}</a>.
              </>
            ) : null}
          </p>
        </div>
        <div class="deal" data-ui>
          <p class="deal-head">
            <b>Then the page itself.</b> Fetch read {host(deal.source_url)}
            {deal.read_at !== null ? ` on ${shortDate(deal.read_at)}` : ""} and found this sentence.
          </p>
          <Quote text={deal.quote} name={inv.name} />
          <p class="source">The name is marked where the sentence contains it. An investor the page does not name earns nothing, whatever the row says.</p>
        </div>
        <div class="deal" data-ui>
          <p class="deal-head">
            <b>Last, the points.</b>
          </p>
          <Sum deal={deal} country={view.search.country} />
        </div>
      </article>
    </section>
  );
}

/** The rows of that search the proof check refused, each with its reason. */
function SetApart(props: { view: SearchView }) {
  const apart = props.view.companies.filter((c) => c.state === "set_apart");
  if (apart.length === 0) return null;
  return (
    <section class="names" id="set-apart">
      <h2>
        {capital(count(apart.length))} of its {props.view.figures.found} rows were set apart
      </h2>
      <div class="cols" data-ui>
        <p class="kind">Set apart, not counted</p>
        {apart.map((c) => (
          <p>
            {c.name}
            <small>{capital(SET_APART[c.set_apart_reason ?? ""] ?? "set apart")}</small>
          </p>
        ))}
      </div>
    </section>
  );
}

export function AboutPage(props: { stats: Stats; saved: number; example: SearchView | null }) {
  const { stats, example } = props;
  const t = stats.tinyfish;
  const services: { name: string; n: number; job: string; use: string }[] = [
    {
      name: "TinySet",
      n: t.tinyset.calls,
      job: `Finds ${TARGET_ROWS} companies like yours that raised in the last ${WINDOW_MONTHS} months, each with its round, investors, partner, founders and a link.`,
      use: `${plural(t.tinyset.calls, "call")}, ${plural(t.tinyset.runs, "run")}, ${usd(t.tinyset.usd)}`,
    },
    {
      name: "Fetch",
      n: t.fetch.calls,
      job: "Reads every announcement for the proof, and an investor's own site for the way in.",
      use: `${plural(t.fetch.calls, "read")}, ${usd(t.fetch.usd)}`,
    },
    {
      name: "Search",
      n: t.search.calls,
      job: "Finds an investor's own site when the row gives none.",
      use: `${plural(t.search.calls, "search", "searches")}, ${usd(t.search.usd)}`,
    },
    {
      name: "Monitor",
      n: t.monitor.calls,
      job: "Watches the saved searches twice a day for new rounds. A new page is added only when the same proof check proves it.",
      use: `${plural(t.monitor.calls, "check")}, ${usd(t.monitor.usd)}`,
    },
  ];
  const refused = example !== null && example.companies.some((c) => c.state === "set_apart");
  return (
    <Staged
      title="Backed: how it works"
      description="What Backed is, how it uses TinyFish TinySet, Fetch, Search and Monitor, what it costs, and what it keeps."
      saved={props.saved}
      say="A starting list for a founder: who funded companies like yours, each match proved by the sentence its own announcement printed."
      word="proved"
      stage={
        <PageStage
          line="One line in. A proved list out."
          go={{ href: "/#line", text: "Try your startup" }}
          tally={[
            { n: stats.searches.ready, what: stats.searches.ready === 1 ? "search stored, free to open" : "searches stored, free to open" },
            { n: stats.companies.proved, what: "companies proved by their own announcement" },
            { n: stats.ranked_investors, what: "investors ranked, every point shown" },
          ]}
        />
      }
      after={
        <>
          {example !== null ? <SetApart view={example} /> : null}
          <section class={refused ? "asked read" : "asked alone read"} id="limits">
            <h2>The limits, and what it keeps</h2>
            <div class="body">
              <p>Backed spends real credit on every new search, so it says what it will and will not do.</p>
              <dl>
                <div>
                  <dt>New searches</dt>
                  <dd>
                    {PUBLIC_SEARCHES_PER_DAY} a day in all, {PUBLIC_SEARCHES_PER_VISITOR_PER_DAY} per visitor, one running at a time. Opening a stored search is free and
                    not limited.
                  </dd>
                </div>
                <div>
                  <dt>Money</dt>
                  <dd>
                    A new search is budgeted at {usd(SEARCH_BUDGET_USD)} and has cost about $1. All paid work stops at {usd(SPEND_STOP_USD)}.
                  </dd>
                </div>
                <div>
                  <dt>Reading a page</dt>
                  <dd>
                    An announcement is waited for {READ_TIMEOUT_MS / 1000} seconds and read up to {READ_ATTEMPTS} times. A page that cannot be read is reported as such.
                    Only public pages are read; nothing behind a login.
                  </dd>
                </div>
                <div>
                  <dt>What is kept</dt>
                  <dd>
                    A public search is kept {PUBLIC_SEARCH_TTL_DAYS} days, then deleted with its companies; the saved searches stay. An investor's site is read again
                    after {INVESTOR_REUSE_DAYS} days.
                  </dd>
                </div>
                <div>
                  <dt>Visitors</dt>
                  <dd>A visitor is known only by a salted hash of their address.</dd>
                </div>
                <div>
                  <dt>People named here</dt>
                  <dd>
                    They are named in a public funding announcement, as founders or as the partner on a deal. Only what the announcement says about them is shown, with
                    its link.
                  </dd>
                </div>
                <div>
                  <dt>Who made it</dt>
                  <dd>
                    Built by <Author /> for the TinyFish Funding Radar bounty. It is a starting list, not investment advice.
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        </>
      }
    >
      <section class="block" id="services">
        <p class="said">Four TinyFish services do the work</p>
        <p class="note">The figures are this site's own, read from its ledger as this page was made.</p>
        <ol class="others services">
          {services.map((s) => (
            <li>
              <h3>{s.name}</h3>
              <span class="n num">{s.n}</span>
              <p class="num">
                {s.job} So far: {s.use}.
              </p>
            </li>
          ))}
        </ol>
        <p class="sum-up">
          In all: {usd(stats.spend_usd)} spent, from the ledger where every call is one row. The same figures, as data, are at <a href="/api/stats">/api/stats</a>.
        </p>
      </section>
      {example !== null ? <Followed view={example} /> : null}
    </Staged>
  );
}

// --- The score -----------------------------------------------------------------------------------

/** The first investors with their deals added up: "Meadow AI 7 + Loman 6 = 13". */
function FirstFive(props: { view: SearchView }) {
  const { view } = props;
  const top = view.investors.slice(0, 5);
  if (top.length < 2) return null;
  return (
    <section class="block ranked-end" id="added-up">
      <p class="said">The first {count(top.length)} for that line, added up</p>
      <ol class="others sums">
        {top.map((inv) => (
          <li>
            <h3>
              <a href={`/searches/${view.search.id}/investors/${inv.slug}`}>{inv.name}</a>
            </h3>
            <span class="n num">{inv.score}</span>
            <p class="num">
              {inv.deals.map((d, i) => (
                <>
                  {i > 0 ? " + " : ""}
                  {d.company} <b>{d.points}</b>
                </>
              ))}{" "}
              = <b>{inv.score}</b>
            </p>
          </li>
        ))}
      </ol>
      <p class="sum-up">Equal scores are ordered by the number of companies, then by name.</p>
    </section>
  );
}

export function ScorePage(props: { saved: number; example: SearchView | null }) {
  const view = props.example;
  // The second investor where there is one: its deals are at different stages, so the sum shows more of the rules.
  const inv = view === null ? undefined : (view.investors[1] ?? view.investors[0]);
  return (
    <Staged
      title="Backed: the score"
      description="How Backed ranks investors: simple sums over the companies like yours they backed, every point shown."
      saved={props.saved}
      say="Every point comes from one company like yours whose own announcement names the investor. Nothing else counts."
      word="scored"
      stage={
        <PageStage
          line="A sum you can check."
          go={view !== null ? { href: `/searches/${view.search.id}#list`, text: "See it on a whole list" } : { href: "/#the-list", text: "See it on a whole list" }}
          tally={[
            { n: POINTS.backed, what: "for backing a company like yours" },
            { n: POINTS.led, what: "more for leading its round" },
            { n: POINTS.same_stage, what: "for a round at your stage" },
          ]}
        />
      }
      after={
        <>
          <ScoreSheet />
          <section class="asked alone read" id="order">
            <h2>How the order is set</h2>
            <div class="body">
              <p>An investor's score is the sum over its companies. The order is the score, then the number of companies, then the name.</p>
              <dl>
                <div>
                  <dt>What counts</dt>
                  <dd>
                    A company counts once for each investor its announcement names: {POINTS.backed} for backing it, {POINTS.led} more for leading the round,{" "}
                    {POINTS.same_stage} for a round at your stage or {POINTS.next_stage} for the stage next to it, {POINTS.same_country} for your country and{" "}
                    {POINTS.recent} for a round in the last six months.
                  </dd>
                </div>
                <div>
                  <dt>What does not count</dt>
                  <dd>The size of a fund, its fame, its logo, or how often it is in the news. An investor the announcement does not name gets nothing, whatever the row says.</dd>
                </div>
                <div>
                  <dt>Rounds they joined, and cheque sizes</dt>
                  <dd>
                    Beside each investor, the stages and sizes of the rounds found in your search: "seed rounds of $3.5M to $7M". That is the size of a round, not of a
                    cheque. A cheque size is shown only when the investor's own site states one in figures, quoted with its link.
                  </dd>
                </div>
                <div>
                  <dt>The way in</dt>
                  <dd>
                    For the first {WAY_IN_TOP}, Backed reads the investor's own site for an open form or a published email address. It always names the founders of the
                    companies they backed and the partner who led, where the announcement names them, and writes a first line for your email from the proved facts.
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        </>
      }
    >
      {view !== null && inv !== undefined ? (
        <>
          <section class="block" id="counted">
            <p class="said">One investor, counted out</p>
            <p class="note">From the saved search for “{view.search.line}”</p>
            <FirstSheet inv={inv} total={view.investors.length} view={view} href={`/searches/${view.search.id}/investors/${inv.slug}`} />
          </section>
          <FirstFive view={view} />
        </>
      ) : null}
    </Staged>
  );
}

// --- The API -------------------------------------------------------------------------------------

/** The first investor and its first deal, as `GET /api/searches/:id` gives them. */
function answerCut(view: SearchView): string | null {
  const inv = view.investors[0];
  const d = inv?.deals[0];
  if (inv === undefined || d === undefined) return null;
  const cut = {
    position: inv.position,
    name: inv.name,
    score: inv.score,
    companies: inv.companies,
    deals: [
      {
        company: d.company,
        led: d.led,
        round_type: d.round_type,
        amount_usd: d.amount_usd,
        announced_on: d.announced_on,
        quote: d.quote,
        source_url: d.source_url,
        read_at: d.read_at,
        points: d.points,
        parts: d.parts,
      },
    ],
  };
  // Printed with two spaces, each part of the score on one line.
  return JSON.stringify(cut, null, 2).replace(/\{\s+"part": ("[a-z_]+"),\s+"points": (\d+)\s+\}/g, '{ "part": $1, "points": $2 }');
}

export function ApiPage(props: { base: string; saved: number; example: SearchView | null }) {
  const id = props.example?.search.id ?? "<id>";
  const answer = props.example === null ? null : answerCut(props.example);
  return (
    <Staged
      title="Backed: API"
      description="Start a search and read the ranked, proved list as JSON or CSV."
      saved={props.saved}
      say="Every page has an address that answers JSON. No key is needed to read; new searches are held to the same limits as the form."
      word="served"
      stage={
        <PageStage
          line="The same list, as data."
          go={props.example !== null ? { href: `/api/searches/${id}`, text: "Open a real answer" } : { href: "/api/searches", text: "Open the saved searches" }}
          tally={[
            { n: 5, what: "addresses that answer JSON or CSV" },
            { n: 0, what: "keys needed to read" },
            { n: PUBLIC_SEARCHES_PER_DAY, what: "new searches a day, as on the form" },
          ]}
        />
      }
    >
      <section class={answer !== null ? "block" : "block ranked-end"} id="addresses">
        <p class="said">The addresses</p>
        <ol class="others endpoints">
          <li>
            <h3>POST /api/searches</h3>
            <p>
              Starts a search, or opens the stored one when the same line, stage and country were asked in the last {REUSE_DAYS} days. Answers <code>202</code> with{" "}
              <code>{"{ id, state, cached }"}</code>, or refuses with <code>400</code> for a line that breaks the rules, <code>429</code> past the day's limits and{" "}
              <code>503</code> once the spend stop is reached. Stages: {Object.keys(STAGE_LABELS).join(", ")}.
            </p>
            <pre>
              <code>{`curl -X POST ${props.base}/api/searches \\
  -H 'content-type: application/json' \\
  -d '{"line": "Cold storage for smallholder farmers", "stage": "pre-seed", "country": "Kenya"}'`}</code>
            </pre>
          </li>
          <li>
            <h3>GET /api/searches/:id</h3>
            <p>
              The search, its figures, every investor with each deal, its quotation, its source, its points and their parts, the way in, and every company with its
              state and, when set apart, the reason. While it runs, reading it moves it on.
            </p>
            <pre>
              <code>{`curl ${props.base}/api/searches/${id}`}</code>
            </pre>
          </li>
          <li>
            <h3>GET /api/searches/:id.csv</h3>
            <p>One row per investor and company: rank, score, the company, the round, the quotation, the proof link, when it was read, and the points.</p>
          </li>
          <li>
            <h3>GET /api/searches</h3>
            <p>The saved searches: every finished search still kept.</p>
          </li>
          <li>
            <h3>GET /api/stats</h3>
            <p>Searches, companies, investors, and every TinyFish call and its cost, by service.</p>
          </li>
        </ol>
        <p class="sum-up">
          A search's page also downloads as <code>/searches/:id.json</code> and <code>/searches/:id.csv</code>. Admin routes (a token) start searches outside the public
          limits, adopt a dataset TinySet already filled, and watch a saved search for new rounds with a TinyFish Monitor.
        </p>
      </section>
      {answer !== null ? (
        <section class="block ranked-end" id="answer">
          <p class="said">One investor, as the API answers</p>
          <article class="first" data-ui>
            <pre>
              <code>{answer}</code>
            </pre>
            <p class="why">
              Cut from <code>GET /api/searches/{id}</code>: the first investor and its first deal. The whole answer has every investor, every deal and every company.
            </p>
          </article>
        </section>
      ) : null}
    </Staged>
  );
}

// --- Saved searches ------------------------------------------------------------------------------

export type SavedRow = {
  id: string;
  line: string;
  stage: Stage;
  country: string;
  demo: number | null;
  finished_at: string | null;
  proved: number;
  investors: number;
  first_investor: string | null;
};

/** A founder's line longer than this is set at the lead size, so it stays within a few lines. */
const LONG_LINE_CHARS = 80;

/** One band to a search, the three fields in turn: its line large, its figures opposite. */
export function SavedPage(props: { rows: SavedRow[] }) {
  const n = props.rows.length;
  const sum = (pick: (r: SavedRow) => number) => props.rows.reduce((total, r) => total + pick(r), 0);
  return (
    <Staged
      title="Backed: saved searches"
      description="Searches already run, free to open, each with every investor, every company and the proof."
      saved={n}
      say="Opening a saved search is free. Each one has every investor, every company and the sentence that proves each match."
      word="stored"
      stage={
        <PageStage
          line={n === 0 ? "No search has finished yet." : `${capital(count(n))} ${n === 1 ? "list" : "lists"}, free to open.`}
          go={{ href: "/#line", text: "Try your startup" }}
          tally={
            n === 0
              ? []
              : [
                  { n: sum((r) => r.proved), what: "companies proved across them" },
                  { n: sum((r) => r.investors), what: "investors ranked across them" },
                  { n: "$0", what: "to open one" },
                ]
          }
        />
      }
      after={
        n > 0 ? (
          <ol class="bands">
            {props.rows.map((r) => (
              <li>
                <p class={r.line.length > LONG_LINE_CHARS ? "line long" : "line"}>
                  <a href={`/searches/${r.id}`}>{r.line}</a>
                </p>
                <div class="got">
                  <p class="n num">{r.investors}</p>
                  <div>
                    <p>
                      {r.investors === 1 ? "investor" : "investors"} ranked{r.first_investor !== null ? <>, first <b>{r.first_investor}</b></> : null}.{" "}
                      {plural(r.proved, "company", "companies")} proved by {r.proved === 1 ? "its" : "their"} own announcement.
                    </p>
                    <p class="meta">
                      {STAGE_LABELS[r.stage]}, {r.country}
                      {r.finished_at !== null ? `, searched ${shortDate(r.finished_at)}` : ""}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : null
      }
    />
  );
}
