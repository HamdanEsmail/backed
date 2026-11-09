// A search's page, in every state. The stage holds the search's own line, stage and country, read
// only, with its live figures. While it runs, the column lists the companies as they arrive, each
// proved with its lead investor or set apart with its reason, and the page refreshes itself (a meta
// refresh: nothing depends on script). When ready, the ranked list in full, then every company,
// then what TinySet was asked.
import { STAGE_LABELS } from "../../core/stages";
import type { CompanyView, SearchView } from "../../search/read";
import { monthYear } from "../../search/spec";
import { SET_APART } from "../../search/words";
import { FirstSheet, Names, Others } from "../components";
import { Footer, Layout, Nav } from "../layout";
import { place, shortDate } from "../format";

/** A running page reloads itself this often, in seconds. */
export const REFRESH_SECONDS = 5;
/** The investors after the first shown with their way in. */
const WAY_IN_ROWS = 10;

export function ReadStage(props: { view: SearchView }) {
  const { search, figures } = props.view;
  const running = search.state !== "ready" && search.state !== "failed";
  return (
    <div class="stage">
      <div>
        <p class="label">The line searched</p>
        <p class="line">{search.line}</p>
        <div class="pick read">
          <span>
            {STAGE_LABELS[search.stage]} <i>stage</i>
          </span>
          <span>
            {search.country} <i>country</i>
          </span>
        </div>
        <a class="go as-link" href="/#line">
          Search for another startup
        </a>
      </div>
      <div class="tally four">
        <div>
          <b class="num">{figures.found}</b>
          <span>companies like it {running ? "found so far" : `that raised since ${monthYear(search.window_start)}`}</span>
        </div>
        <div>
          <b class="num">{figures.proved}</b>
          <span>proved by their own announcement</span>
        </div>
        <div>
          <b class="num">{figures.set_apart}</b>
          <span>set apart, with the reason</span>
        </div>
        <div>
          <b class="num">{figures.investors}</b>
          <span>investors behind them{search.state === "ready" ? ", ranked" : ""}</span>
        </div>
      </div>
    </div>
  );
}

const STATE_WORDS: Record<string, { said: string; note: (v: SearchView) => string }> = {
  queued: {
    said: "Waiting its turn.",
    note: () => "One search runs at a time, so this one starts when the one before it ends. This page refreshes itself.",
  },
  finding: {
    said: "Finding companies like this.",
    note: (v) =>
      `TinySet is searching the live web for companies like this that raised since ${monthYear(v.search.window_start)}. Each one is checked against its own announcement as it arrives. This page refreshes itself.`,
  },
  checking: {
    said: "Checking every announcement.",
    note: (v) => `TinySet has finished. ${v.figures.checking} of ${v.figures.found} still to check. This page refreshes itself.`,
  },
  ranking: {
    said: "Adding up the backers.",
    note: () => "Every company is checked. The points are being counted and the way in looked up for the first ten. This page refreshes itself.",
  },
};

/** One company as it arrives: proved with its lead investor, set apart with its reason, or being checked. */
function Arrival(props: { c: CompanyView }) {
  const { c } = props;
  if (c.state === "proved") {
    const leads = c.named_investors.filter((i) => i.role === "lead").map((i) => i.name);
    const others = c.named_investors.filter((i) => i.role !== "lead").map((i) => i.name);
    const said = leads.length > 0 ? `Proved: led by ${leads.join(" and ")}` : `Proved: backed by ${others.slice(0, 3).join(", ")}`;
    return (
      <li>
        <p>{c.name}</p>
        <p>
          {said}
          {leads.length > 0 && others.length > 0 ? `, with ${others.length} more named` : ""}.
        </p>
      </li>
    );
  }
  if (c.state === "set_apart") {
    return (
      <li class="apart">
        <p>{c.name}</p>
        <p>Set apart: {SET_APART[c.set_apart_reason ?? ""] ?? "set apart"}.</p>
      </li>
    );
  }
  return (
    <li>
      <p>{c.name}</p>
      <p>Reading its announcement.</p>
    </li>
  );
}

/** Those being read first, then the checked ones, the most recently read first. */
function arrivalOrder(companies: CompanyView[]): CompanyView[] {
  const open = (c: CompanyView) => c.state === "unchecked" || c.state === "checking";
  return [...companies].sort((a, b) => Number(open(b)) - Number(open(a)) || String(b.read_at ?? "").localeCompare(String(a.read_at ?? "")));
}

function Running(props: { view: SearchView }) {
  const words = STATE_WORDS[props.view.search.state] ?? STATE_WORDS.finding!;
  return (
    <section class="block lead-in" id="the-list">
      <p class="said">{words.said}</p>
      <p class="note">{words.note(props.view)}</p>
      <ol class="arrivals">
        {arrivalOrder(props.view.companies).map((c) => (
          <Arrival c={c} />
        ))}
      </ol>
    </section>
  );
}

function Ready(props: { view: SearchView }) {
  const { view } = props;
  const [first, ...rest] = view.investors;
  const href = (slug: string) => `/searches/${view.search.id}/investors/${slug}`;
  return (
    <section class="block lead-in ranked-end" id="list">
      {view.search.notice !== null ? <p class="note">{view.search.notice}</p> : null}
      <WatchNote view={view} />
      {view.search.none_in_country ? (
        <p class="said elsewhere">
          None of these companies is in {place(view.search.country)}. This list shows who funds companies like this elsewhere.
        </p>
      ) : null}
      {first === undefined ? (
        <p class="said">No investor was proved for this line.</p>
      ) : (
        <>
          <p class="said">Companies like this were backed by</p>
          <FirstSheet inv={first} total={view.investors.length} view={view} href={href(first.slug)} />
          <Others investors={rest.slice(0, WAY_IN_ROWS - 1)} hrefFor={(inv) => href(inv.slug)} withWay />
          {rest.length > WAY_IN_ROWS - 1 ? <p class="others-note">The way in is looked up for the first ten.</p> : null}
          <Others investors={rest.slice(WAY_IN_ROWS - 1)} hrefFor={(inv) => href(inv.slug)} withWay={false} rest />
          <div class="cells">
            <a href={`/searches/${view.search.id}.csv`}>
              Download as CSV <span>one row per investor and company</span>
            </a>
            <a href={`/searches/${view.search.id}.json`}>
              Download as JSON <span>everything on this page</span>
            </a>
          </div>
        </>
      )}
    </section>
  );
}

/** "New since <date>": the companies a watch found and the proof check proved, or that it is still
 *  watching and nothing new is proved. Nothing for a search that was never watched. */
function WatchNote(props: { view: SearchView }) {
  const w = props.view.search.watch;
  if (w === null) return null;
  const found = props.view.companies.filter((c) => c.found_by === "watch" && c.state === "proved");
  if (found.length > 0) {
    return (
      <p class="note">
        New since {shortDate(w.since)}: {found.map((c) => c.name).join(", ")}, found by the watch and proved by{" "}
        {found.length === 1 ? "its announcement" : "their announcements"}.
      </p>
    );
  }
  return (
    <p class="note">
      {w.active
        ? `Watched for new rounds since ${shortDate(w.since)}, until ${shortDate(w.until)}. Nothing new is proved yet.`
        : `Watched for new rounds from ${shortDate(w.since)} to ${shortDate(w.until)}. Nothing new was proved.`}
    </p>
  );
}

function Failed(props: { view: SearchView }) {
  return (
    <section class="block lead-in ranked-end" id="the-list">
      <p class="said">{props.view.search.notice}</p>
      <p class="note">Stored searches still open, and you can search again with the line in other words.</p>
    </section>
  );
}

/** "What TinySet was asked": the spec's description and every column with its hint. */
function Asked(props: { asked: unknown }) {
  const spec = props.asked as { description?: unknown; columns?: { name?: unknown; label?: unknown; retrieval_hint?: unknown }[] } | null;
  if (spec === null || typeof spec !== "object") return null;
  const columns = Array.isArray(spec.columns) ? spec.columns : [];
  return (
    <section class="asked" id="asked">
      <h2>What TinySet was asked</h2>
      <div class="body">
        {typeof spec.description === "string" ? <p>{spec.description}</p> : null}
        <dl>
          {columns.map((col) => (
            <div>
              <dt>{typeof col.label === "string" ? col.label : String(col.name ?? "")}</dt>
              {typeof col.retrieval_hint === "string" ? <dd>{col.retrieval_hint}</dd> : null}
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export function SearchPage(props: { view: SearchView; saved: number }) {
  const { view } = props;
  const state = view.search.state;
  const running = state !== "ready" && state !== "failed";
  return (
    <Layout
      title={`Backed: ${view.search.line}`}
      description={`Who backed companies like this: ${view.search.line}`}
      refreshSeconds={running ? REFRESH_SECONDS : undefined}
      noindex={view.search.demo === null}
    >
      <div class="split">
        <ReadStage view={view} />
        <div class="col">
          <Nav home={false} className="top" />
          {state === "ready" ? <Ready view={view} /> : state === "failed" ? <Failed view={view} /> : <Running view={view} />}
        </div>
      </div>
      {!running && view.companies.length > 0 ? <Names companies={view.companies} title="Every company it found for this line" /> : null}
      <Asked asked={view.asked} />
      <Footer saved={props.saved} />
    </Layout>
  );
}

export function NotFoundPage() {
  return (
    <Layout title="Backed: not found" description="This page is not here." noindex>
      <section class="missing">
        <h1>Nothing is stored at this address.</h1>
        <p>A public search is kept for seven days. The saved searches stay.</p>
        <a class="btn" href="/searches">
          Saved searches
        </a>
      </section>
    </Layout>
  );
}
