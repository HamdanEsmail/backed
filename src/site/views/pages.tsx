// The plain pages: saved searches, the score, the API and about. Orange field, the navigation at the
// top, one heading at the head size, the text at the body and lead sizes, the footer.
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
import { POINTS } from "../../search/score";
import { plural, shortDate } from "../format";
import { Footer, Layout, Nav } from "../layout";
import { ScoreSheet } from "./home";

type Stats = Awaited<ReturnType<typeof readStats>>;

function Plain(props: { title: string; description: string; heading: string; lede: string; saved: number; children?: Child; after?: Child; aside?: Child }) {
  return (
    <Layout title={props.title} description={props.description}>
      <Nav home={false} className="top" />
      <section class={props.aside ? "plain with-aside" : "plain"}>
        {props.aside ?? null}
        <div class="body">
          <h1>{props.heading}</h1>
          <p class="lede">{props.lede}</p>
          {props.children ?? null}
        </div>
      </section>
      {props.after ?? null}
      <Footer saved={props.saved} />
    </Layout>
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

export function SavedPage(props: { rows: SavedRow[] }) {
  return (
    <Plain
      title="Backed: saved searches"
      description="Searches already run, free to open, each with every investor, every company and the proof."
      heading="Saved searches"
      lede="Opening a saved search is free. Each one has every investor, every company and the sentence that proves each match."
      saved={props.rows.length}
    >
      {props.rows.length === 0 ? (
        <p class="text">No search has finished yet.</p>
      ) : (
        <ol class="saved">
          {props.rows.map((r) => (
            <li>
              <p class="line">
                <a href={`/searches/${r.id}`}>{r.line}</a>
              </p>
              <p class="meta">
                {STAGE_LABELS[r.stage]} · {r.country} · {plural(r.proved, "company", "companies")} proved · {plural(r.investors, "investor")}
                {r.first_investor !== null ? ` · first: ${r.first_investor}` : ""}
                {r.finished_at !== null ? ` · ${shortDate(r.finished_at)}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Plain>
  );
}

// --- The score -----------------------------------------------------------------------------------

export function ScorePage(props: { saved: number }) {
  return (
    <Plain
      title="Backed: the score"
      description="How Backed ranks investors: simple sums over the companies like yours they backed, every point shown."
      heading="The score is a sum you can check."
      lede="Every point comes from one company like yours whose own announcement names the investor. Nothing else counts."
      saved={props.saved}
      after={<ScoreSheet />}
    >
      <div class="text">
        <h2>How the order is set</h2>
        <p>
          An investor's score is the sum over its companies. The order is the score, then the number of companies, then the name. A company counts once
          for each investor its announcement names: {POINTS.backed} for backing it, {POINTS.led} more for leading the round, {POINTS.same_stage} for a
          round at your stage or {POINTS.next_stage} for the stage next to it, {POINTS.same_country} for your country and {POINTS.recent} for a round
          in the last six months.
        </p>
        <h2>What does not count</h2>
        <p>The size of a fund, its fame, its logo, or how often it is in the news. An investor the announcement does not name gets nothing, whatever the row says.</p>
        <h2>Rounds they joined, and cheque sizes</h2>
        <p>
          Beside each investor, the stages and sizes of the rounds found in your search: "seed rounds of $3.5M to $7M". That is the size of a round, not
          of a cheque. A cheque size is shown only when the investor's own site states one in figures, quoted with its link.
        </p>
        <h2>The way in</h2>
        <p>
          For the first {WAY_IN_TOP}, Backed reads the investor's own site for an open form or a published email address. It always names the founders
          of the companies they backed and the partner who led, where the announcement names them, and writes a first line for your email from the
          proved facts.
        </p>
      </div>
    </Plain>
  );
}

// --- The API -------------------------------------------------------------------------------------

function Endpoint(props: { method: string; path: string; children: Child }) {
  return (
    <div class="endpoint">
      <h2>
        {props.method} <code>{props.path}</code>
      </h2>
      {props.children}
    </div>
  );
}

export function ApiPage(props: { base: string; sampleId: string | null; saved: number }) {
  const id = props.sampleId ?? "<id>";
  return (
    <Plain
      title="Backed: API"
      description="Start a search and read the ranked, proved list as JSON or CSV."
      heading="The same list, as data."
      lede="Every page has an address that answers JSON. No key is needed to read; new searches are held to the same limits as the form."
      saved={props.saved}
    >
      <div class="text">
        <Endpoint method="POST" path="/api/searches">
          <p>
            Starts a search, or opens the stored one when the same line, stage and country were asked in the last {REUSE_DAYS} days. Answers{" "}
            <code>202</code> with <code>{"{ id, state, cached }"}</code>. Stages: {Object.keys(STAGE_LABELS).join(", ")}.
          </p>
          <pre>
            <code>{`curl -X POST ${props.base}/api/searches \\
  -H 'content-type: application/json' \\
  -d '{"line": "Cold storage for smallholder farmers", "stage": "pre-seed", "country": "Kenya"}'`}</code>
          </pre>
          <p>
            Refused with <code>400</code> for a line that breaks the rules, <code>429</code> past the day's limits, <code>503</code> once the spend stop
            is reached.
          </p>
        </Endpoint>
        <Endpoint method="GET" path="/api/searches/:id">
          <p>
            The search, its figures, every investor with each deal, its quotation, its source, its points and their parts, the way in, and every
            company with its state and, when set apart, the reason. While it runs, reading it moves it on.
          </p>
          <pre>
            <code>{`curl ${props.base}/api/searches/${id}`}</code>
          </pre>
        </Endpoint>
        <Endpoint method="GET" path="/api/searches/:id.csv">
          <p>One row per investor and company: rank, score, the company, the round, the quotation, the proof link, when it was read, and the points.</p>
        </Endpoint>
        <Endpoint method="GET" path="/api/searches">
          <p>The saved searches: every finished search still kept.</p>
        </Endpoint>
        <Endpoint method="GET" path="/api/stats">
          <p>Searches, companies, investors, and every TinyFish call and its cost, by service.</p>
        </Endpoint>
        <p>
          A search's page also downloads as <code>/searches/:id.json</code> and <code>/searches/:id.csv</code>. Admin routes (a token) start searches
          outside the public limits and adopt a dataset TinySet already filled.
        </p>
      </div>
    </Plain>
  );
}

// --- About ---------------------------------------------------------------------------------------

const usd = (n: number) => `$${n.toFixed(2)}`;

export function AboutPage(props: { stats: Stats; saved: number }) {
  const t = props.stats.tinyfish;
  const rows: [string, string, string][] = [
    ["TinySet", `Finds ${TARGET_ROWS} companies like yours that raised in the last ${WINDOW_MONTHS} months, with round, investors, partner, founders and link.`, `${plural(t.tinyset.calls, "call")}, ${plural(t.tinyset.runs, "run")}, ${usd(t.tinyset.usd)}`],
    ["Fetch", "Reads every announcement for the proof, and an investor's own site for the way in.", `${plural(t.fetch.calls, "read")}, ${usd(t.fetch.usd)}`],
    ["Search", "Finds an investor's own site when the row gives none.", `${plural(t.search.calls, "search", "searches")}, ${usd(t.search.usd)}`],
  ];
  return (
    <Plain
      title="Backed: about"
      description="What Backed is, how it uses TinyFish, what it costs, and what it keeps."
      heading="One line in, the investors who backed companies like it out."
      lede="Backed is a starting list for a founder: who funded companies like yours in the last eighteen months, each match proved by the sentence its own announcement printed."
      saved={props.saved}
      aside={
        <div class="figures">
          <div>
            <b class="num">{t.tinyset.calls}</b>
            <span>TinySet calls, {plural(t.tinyset.runs, "run")}</span>
          </div>
          <div>
            <b class="num">{t.fetch.calls}</b>
            <span>pages read with Fetch</span>
          </div>
          <div>
            <b class="num">{t.search.calls}</b>
            <span>Search calls</span>
          </div>
          <div>
            <b class="num">{usd(props.stats.spend_usd)}</b>
            <span>spent in all, from the ledger</span>
          </div>
        </div>
      }
    >
      <div class="text">
        <h2>How it uses TinyFish</h2>
        <dl class="services">
          {rows.map(([name, job, use]) => (
            <div>
              <dt>{name}</dt>
              <dd>{job}</dd>
              <dd class="num">{use}</dd>
            </div>
          ))}
        </dl>
        <p>
          In all: {usd(props.stats.spend_usd)} spent, from the ledger where every call is one row. A new search is budgeted at {usd(SEARCH_BUDGET_USD)};
          all paid work stops at {usd(SPEND_STOP_USD)}.
        </p>
        <h2>The limits</h2>
        <p>
          {PUBLIC_SEARCHES_PER_DAY} new searches a day in all, {PUBLIC_SEARCHES_PER_VISITOR_PER_DAY} per visitor, one running at a time. Opening a stored
          search is free and not limited. An announcement is waited for {READ_TIMEOUT_MS / 1000} seconds and read up to {READ_ATTEMPTS} times; a page that
          cannot be read is reported as such. Only public pages are read; nothing behind a login.
        </p>
        <h2>What it keeps</h2>
        <p>
          A public search is kept {PUBLIC_SEARCH_TTL_DAYS} days, then deleted with its companies; the saved demo searches stay. An investor's site is read
          again after {INVESTOR_REUSE_DAYS} days. A visitor is known only by a salted hash of their address. People named here are named in a public
          funding announcement, as founders or as the partner on a deal, and only what the announcement says about them is shown, with its link.
        </p>
        <h2>Who made it</h2>
        <p>Built by Hamdan Esmail for the TinyFish Funding Radar bounty. It is a starting list, not investment advice.</p>
      </div>
    </Plain>
  );
}
