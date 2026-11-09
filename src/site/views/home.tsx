// The home, built to design/comp-home.html section by section from a stored search: the stage with
// the form, the first screen with the wordmark, the ranked list, how a search runs, the score sheet,
// every company, the figures, the plain ask and the footer.
import type { Stage } from "../../core/stages";
import { matcherFor, nameHits, prepareSentence } from "../../core/names";
import type { CompanyView, SearchView } from "../../search/read";
import { POINTS } from "../../search/score";
import { monthYear } from "../../search/spec";
import { FirstSheet, Names, Others, Quote, StageForm } from "../components";
import { host, shortDate } from "../format";
import { Footer, Layout, Nav } from "../layout";

export type HomeForm = { line: string; stage: Stage; country: string; error: string | null };

export type HomeProps = {
  featured: SearchView | null;
  /** How long the featured search took, in minutes, and what the time counts. */
  minutes: { n: number; what: "list" | "find" } | null;
  saved: number;
  form: HomeForm;
};

const NEXT = 5;

function List(props: { view: SearchView }) {
  const { view } = props;
  const [first, ...rest] = view.investors;
  const total = view.investors.length;
  const href = `/searches/${view.search.id}`;
  if (first === undefined) return null;
  const more = total - 1 - Math.min(NEXT, rest.length);
  return (
    <section class="block" id="the-list">
      <p class="said">Companies like this were backed by</p>
      <FirstSheet inv={first} total={total} view={view} href={`${href}/investors/${first.slug}`} />
      <Others investors={rest.slice(0, NEXT)} hrefFor={(inv) => `${href}/investors/${inv.slug}`} withWay={false} />
      <div class="cells">
        <a href={`${href}#list`}>
          All {total} investors <span>{more > 0 ? `${more} more` : "with every company"}</span>
        </a>
        <a href={`${href}.csv`}>
          Download as CSV <span>or JSON</span>
        </a>
      </div>
    </section>
  );
}

function Steps(props: { since: string | null }) {
  return (
    <section class="block steps" id="how">
      <h2>How a search runs</h2>
      <ol>
        <li>
          <h3>First it finds companies like yours.</h3>
          <p>
            TinyFish TinySet searches the live web for early rounds{props.since !== null ? ` since ${monthYear(props.since)}` : " from the last 18 months"} and returns
            each company with its investors and a link.
          </p>
        </li>
        <li>
          <h3>Then it checks every link.</h3>
          <p>TinyFish Fetch opens each announcement and looks for the names. A company whose page does not name its investors is set apart, with the reason.</p>
        </li>
        <li>
          <h3>Last it adds up the backers.</h3>
          <p>Every point is shown beside the sentence that earned it, so you can argue with the order.</p>
        </li>
      </ol>
      <p class="more">
        <a href="/about">One match followed through, and the TinyFish calls counted</a>
      </p>
    </section>
  );
}

/** The score as a printed sheet. On the home, `more` adds the way to the page that explains the order. */
export function ScoreSheet(props: { more?: boolean }) {
  return (
    <section class="sheet-band" id="score">
      <div class="claim">
        <h2>No points for fame.</h2>
        <p>Only for backing companies like yours, with the sentence that proves it.</p>
        {props.more ? (
          <p class="more">
            <a href="/score">How the order is set</a>
          </p>
        ) : null}
      </div>
      <div class="sheet" data-ui>
        <h2>The score</h2>
        <p class="note">Counted once for every company like yours that an investor backed.</p>
        <h3>For the company</h3>
        <dl>
          <div>
            <dt>Backed it</dt>
            <dd class="pts">{POINTS.backed}</dd>
            <dd class="more">Named as an investor in the announcement</dd>
          </div>
          <div>
            <dt>Led the round</dt>
            <dd class="pts">{POINTS.led}</dd>
            <dd class="more">Named as the lead, not only a participant</dd>
          </div>
        </dl>
        <h3>For how close it is to you</h3>
        <dl>
          <div>
            <dt>Your stage</dt>
            <dd class="pts">{POINTS.same_stage}</dd>
            <dd class="more">A seed round, if you are raising a seed</dd>
          </div>
          <div>
            <dt>The stage next to yours</dt>
            <dd class="pts">{POINTS.next_stage}</dd>
            <dd class="more">Pre-seed or Series A, for a seed founder</dd>
          </div>
          <div>
            <dt>Your country</dt>
            <dd class="pts">{POINTS.same_country}</dd>
            <dd class="more">The company is based where you are</dd>
          </div>
          <div>
            <dt>In the last six months</dt>
            <dd class="pts">{POINTS.recent}</dd>
            <dd class="more">They are writing these cheques now</dd>
          </div>
        </dl>
        <p class="end">
          A company only counts when its announcement,
          <br />
          read when the search ran, names the investor.
        </p>
      </div>
    </section>
  );
}

/** The figures: one announcement with the names it proved, beside two tiles. */
function Mosaic(props: { view: SearchView; minutes: HomeProps["minutes"] }) {
  const { view } = props;
  // The quotation that names the most of its company's proved investors; beside it, only the
  // names that quotation contains, the lead first.
  let best: { page: CompanyView; quote: string; quoted: string; names: CompanyView["named_investors"] } | null = null;
  for (const c of view.companies) {
    if (c.state !== "proved") continue;
    for (const q of c.named_investors) {
      if (q.quote === null) continue;
      const sentence = prepareSentence(q.quote);
      const names = c.named_investors.filter((i) => {
        const m = matcherFor(i.name);
        return m !== null && nameHits(sentence, m).length > 0;
      });
      if (best === null || names.length > best.names.length) best = { page: c, quote: q.quote, quoted: q.name, names };
    }
  }
  if (best === null) return null;
  const page = best.page;
  const shown = [...best.names].sort((a, b) => Number(b.role === "lead") - Number(a.role === "lead")).slice(0, 3);
  return (
    <section class="mosaic">
      <div class="page" data-ui>
        <p class="where">
          {host(page.page_url ?? page.announcement_url)}, {shortDate(page.announced_on)}
          {page.read_at !== null ? `, read ${shortDate(page.read_at)}` : ""}
        </p>
        <Quote text={best.quote} name={best.quoted} />
        <ul>
          {shown.map((i) => (
            <li>
              <mark>{i.name}</mark>
              <span>{i.role === "lead" ? "led" : "joined"}</span>
            </li>
          ))}
        </ul>
      </div>
      <div class="tile dark">
        <b class="num">
          {view.figures.proved} of {view.figures.found}
        </b>
        <span>companies whose announcement named their investors when it was read</span>
      </div>
      <div class="tile light">
        {props.minutes !== null ? (
          <>
            <b class="num">{props.minutes.n} min</b>
            <span>
              {props.minutes.what === "list" ? "from one line to this ranked list" : "for TinySet to find them"}, on {shortDate(view.search.finished_at)}
            </span>
          </>
        ) : (
          <>
            <b class="num">{view.figures.investors}</b>
            <span>investors ranked, every point shown</span>
          </>
        )}
      </div>
    </section>
  );
}

export function Home(props: HomeProps) {
  const v = props.featured;
  return (
    <Layout title="Backed: who funded companies like yours" description="Type one line about your startup. Backed finds who funded companies like it, and quotes the proof.">
      <div class="split">
        <StageForm
          line={props.form.line}
          stage={props.form.stage}
          country={props.form.country}
          error={props.form.error}
          tally={v === null ? null : { found: v.figures.found, proved: v.figures.proved, investors: v.figures.investors, since: v.search.window_start }}
        />
        <div class="col">
          <header class="hero">
            <Nav home className="" />
            <p class="say">Type one line about your startup. Backed finds who funded companies like it, and quotes the proof.</p>
            <h1 class="wordmark">backed</h1>
            <div class="wordmark-over" aria-hidden="true">
              <span data-word="backed"></span>
            </div>
          </header>
          {v !== null ? <List view={v} /> : null}
          <Steps since={v?.search.window_start ?? null} />
        </div>
      </div>
      <ScoreSheet more />
      {v !== null ? <Names companies={v.companies} title="Every company it found for this line" /> : null}
      {v !== null ? <Mosaic view={v} minutes={props.minutes} /> : null}
      <section class="ask" id="try">
        <div>
          <p>Type your own line and see who backed companies like yours. A new search costs real credit, so a few run each day.</p>
          <a class="btn" href="#line">
            Try your startup
          </a>
        </div>
      </section>
      <Footer saved={props.saved} />
    </Layout>
  );
}
