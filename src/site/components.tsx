// The pieces the home and a search's page share: the stage, the first investor's sheet, a deal with
// its quotation and its sum, the way in, the other investors, and every company as plain names.
import type { Child } from "hono/jsx";
import { COUNTRIES } from "../core/countries";
import { WAY_IN_TOP } from "../core/limits";
import { matcherFor, nameHits, prepareSentence } from "../core/names";
import { STAGE_LABELS, STAGES, type Stage } from "../core/stages";
import type { CompanyView, DealView, InvestorView, SearchView } from "../search/read";
import { monthYear } from "../search/spec";
import { possessive, type WarmPerson } from "../search/wayin";
import { SET_APART } from "../search/words";
import { count, host, money, partLabel, place, plural, roundStage, shortDate, stageWord } from "./format";

/** A quotation with the investor's name marked, where the sentence really contains it. */
export function Quote(props: { text: string | null; name: string }) {
  if (props.text === null) return null;
  const m = matcherFor(props.name);
  const hit = m === null ? undefined : nameHits(prepareSentence(props.text), m)[0];
  return (
    <blockquote>
      “
      {hit === undefined ? (
        props.text
      ) : (
        <>
          {props.text.slice(0, hit.start)}
          <mark>{props.text.slice(hit.start, hit.end)}</mark>
          {props.text.slice(hit.end)}
        </>
      )}
      ”
    </blockquote>
  );
}

/** "backed it 3 + a seed round, your stage 2 + … = 7" */
export function Sum(props: { deal: DealView; country: string }) {
  const stage = roundStage(props.deal.round_type);
  return (
    <p class="sum">
      {props.deal.parts.map((p, i) => (
        <>
          {i > 0 ? " + " : ""}
          {partLabel(p, stage, props.country)} <b>{p.points}</b>
        </>
      ))}{" "}
      = <b>{props.deal.points}</b>
    </p>
  );
}

function dealFacts(d: DealView): string {
  return [stageWord(roundStage(d.round_type)), money(d.amount_usd) ?? "amount not stated", shortDate(d.announced_on)].join(" · ");
}

export function Deal(props: { deal: DealView; investor: string; country: string }) {
  const d = props.deal;
  return (
    <div class="deal">
      <p class="deal-head">
        <b>{d.company}</b> · {dealFacts(d)}
      </p>
      <Quote text={d.quote} name={props.investor} />
      <p class="source">
        {d.source_url !== null ? <a href={d.source_url}>{host(d.source_url)}</a> : "no link"}
        {d.read_at !== null ? `, read ${shortDate(d.read_at)}` : ""}
        {d.led ? (d.partner !== null ? `. Partner on the deal: ${d.partner}.` : `. ${d.partner_note ?? ""}`) : ""}
      </p>
      <Sum deal={d} country={props.country} />
    </div>
  );
}

/** "First of 91, with 13 points: it backed 2 companies like this one, both at seed and both in the
 *  United States. Each point is counted below." */
export function whyFirst(inv: InvestorView, total: number, founder: { stage: Stage; country: string }): string {
  const k = inv.deals.length;
  const all = (n: number) => (n === 1 ? "" : n === 2 ? "both " : "all ");
  let led = "";
  if (inv.led > 0) led = inv.led === k ? (k === 1 ? " and led its round" : k === 2 ? " and led both" : ` and led all ${k}`) : ` and led ${count(inv.led)} of them`;
  const extra: string[] = [];
  if (k > 0 && inv.deals.every((d) => roundStage(d.round_type) === founder.stage)) extra.push(`${all(k)}at ${stageWord(founder.stage)}`);
  if (k > 0 && inv.deals.every((d) => d.parts.some((p) => p.part === "same_country"))) extra.push(`${all(k)}in ${place(founder.country)}`);
  const what = `it backed ${count(k)} ${k === 1 ? "company" : "companies"} like this one${led}`;
  return `${rankWord(inv.position)} of ${total}, with ${plural(inv.score, "point")}: ${what}${extra.length > 0 ? `, ${extra.join(" and ")}` : ""}. Each point is counted below.`;
}

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];

/** "First", "Second" … "Tenth", then "Number 14". */
export function rankWord(position: number): string {
  return ORDINALS[position - 1] ?? `Number ${position}`;
}

/** The people, grouped: "ask Tobias Quell, the partner who led Larder Loop's round; or Mira Odhiambo,
 *  who founded Larder Loop". */
function warmWords(people: WarmPerson[]): string {
  const groups: string[] = [];
  for (const p of people.filter((x) => x.role === "partner")) groups.push(`${p.name}, the partner who led ${possessive(p.company)} round`);
  const byCompany = new Map<string, string[]>();
  for (const p of people.filter((x) => x.role === "founder")) byCompany.set(p.company, [...(byCompany.get(p.company) ?? []), p.name]);
  for (const [company, names] of byCompany) {
    const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
    groups.push(`${list}, who founded ${company}`);
  }
  return groups.length === 0 ? "" : `ask ${groups.join("; or ")}`;
}

function DoorLink(props: { url: string }) {
  return <a href={props.url}>{host(props.url) + new URL(props.url).pathname.replace(/\/$/, "")}</a>;
}

/** The way in, in full, as the first investor's sheet and an investor's page show it. */
export function WayIn(props: { inv: InvestorView }) {
  const w = props.inv.way_in;
  const warm = warmWords(props.inv.warm_route);
  const kind = w?.door.kind ?? null;
  let door: unknown;
  let joiner: string;
  if (w !== null && kind === "form" && w.door.url !== null) {
    door = (
      <>
        There is an open form on their site: <DoorLink url={w.door.url} />
      </>
    );
    joiner = ". Or go warm: ";
  } else if (w !== null && kind === "email" && w.door.email !== null) {
    door = (
      <>
        They publish an email address: <a href={`mailto:${w.door.email}`}>{w.door.email}</a>
      </>
    );
    joiner = ". Or go warm: ";
  } else {
    door =
      kind === "none"
        ? `No open form was found on their own site, read ${shortDate(w?.read_at ?? null)}`
        : kind === "unread"
          ? "Their site could not be read"
          : kind === "no_site"
            ? "No site of their own was found"
            : props.inv.position > WAY_IN_TOP
              ? "Their site is looked up for the first ten only"
              : "Their site has not been read yet";
    joiner = ", so the way in is warm: ";
  }
  return (
    <div class="way">
      <p>
        <b>The way in.</b> {door}
        {warm !== "" ? `${joiner}${warm}.` : ". No founder or partner was named in these announcements."}
      </p>
      {w !== null && w.cheque !== null ? (
        <p>
          Their site states a cheque size: “{w.cheque.quote}”{w.cheque.url !== null ? <> (<a href={w.cheque.url}>{host(w.cheque.url)}</a>)</> : null}
        </p>
      ) : w !== null ? (
        <p>{w.cheque_text}</p>
      ) : null}
      {props.inv.first_line !== null ? <p>A first line for your email: “{props.inv.first_line}”</p> : null}
    </div>
  );
}

/** The first investor, on a white sheet: why it is first, every deal with its quotation and sum, the way in. */
export function FirstSheet(props: { inv: InvestorView; total: number; view: SearchView; href: string | null; children?: Child }) {
  const { inv, view } = props;
  return (
    <article class="first" data-ui>
      <div class="score">
        <h2>{props.href !== null ? <a href={props.href}>{inv.name}</a> : inv.name}</h2>
        <p class="n num">{inv.score}</p>
      </div>
      <p class="why">{whyFirst(inv, props.total, view.search)}</p>
      {props.children ?? null}
      {inv.deals.map((d) => (
        <Deal deal={d} investor={inv.name} country={view.search.country} />
      ))}
      <WayIn inv={inv} />
    </article>
  );
}

/** "Led Larder Loop, seed, $4M, 12 Jun 2026, with Tobias Quell. Backed Shelfcount, …" */
function dealLine(inv: InvestorView) {
  return inv.deals.map((d, i) => (
    <>
      {i > 0 ? " " : ""}
      {d.led ? "Led " : "Backed "}
      {d.source_url !== null ? (
        <a href={d.source_url}>
          <b>{d.company}</b>
        </a>
      ) : (
        <b>{d.company}</b>
      )}
      , {stageWord(roundStage(d.round_type))}, {money(d.amount_usd) ?? "amount not stated"}, {shortDate(d.announced_on)}
      {d.led && d.partner !== null ? `, with ${d.partner}` : ""}.
    </>
  ));
}

/** One line of the way in for an investor below the first. */
function WayLine(props: { inv: InvestorView }) {
  const w = props.inv.way_in;
  if (w === null) return null;
  const first = props.inv.warm_route[0];
  const warm = first === undefined ? "" : first.role === "partner" ? `; ask ${first.name}, who led ${possessive(first.company)} round` : `; ask ${first.name}, who founded ${first.company}`;
  const door =
    w.door.kind === "form" && w.door.url !== null ? (
      <a href={w.door.url}>an open form on {host(w.door.url)}</a>
    ) : w.door.kind === "email" && w.door.email !== null ? (
      <>
        email <a href={`mailto:${w.door.email}`}>{w.door.email}</a>
      </>
    ) : w.door.kind === "none" ? (
      "no open form on their site"
    ) : w.door.kind === "unread" ? (
      "their site could not be read"
    ) : (
      "no site of their own found"
    );
  return (
    <p class="way-line">
      The way in: {door}
      {warm}.
    </p>
  );
}

/** The investors after the first: name and score, one line of deals, and for the top ten the way in. */
export function Others(props: { investors: InvestorView[]; hrefFor: ((inv: InvestorView) => string) | null; withWay: boolean; rest?: boolean }) {
  if (props.investors.length === 0) return null;
  return (
    <ol class={props.rest ? "others rest" : "others"} start={props.investors[0]!.position}>
      {props.investors.map((inv) => (
        <li>
          <h3>{props.hrefFor !== null ? <a href={props.hrefFor(inv)}>{inv.name}</a> : inv.name}</h3>
          <span class="n">{inv.score}</span>
          <p>{dealLine(inv)}</p>
          {props.withWay ? <WayLine inv={inv} /> : null}
        </li>
      ))}
    </ol>
  );
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Every company as plain names in columns: proved, then set apart with the reason. */
export function Names(props: { companies: CompanyView[]; title: string; id?: string }) {
  const proved = props.companies.filter((c) => c.state === "proved");
  const apart = props.companies.filter((c) => c.state === "set_apart");
  const open = props.companies.filter((c) => c.state === "unchecked" || c.state === "checking");
  return (
    <section class="names" id={props.id ?? "companies"}>
      <h2>{props.title}</h2>
      <div class="cols">
        <p class="kind">Proved by its announcement</p>
        {proved.length === 0 ? <p class="empty">None yet.</p> : null}
        {proved.map((c) => (
          <p>
            {c.page_url !== null || c.announcement_url !== null ? <a href={(c.page_url ?? c.announcement_url)!}>{c.name}</a> : c.name}
            {c.found_by === "watch" ? <small>Found by the watch</small> : null}
          </p>
        ))}
        {apart.length > 0 ? <p class="kind second">Set apart, not counted</p> : null}
        {apart.map((c) => (
          <p>
            {c.name}
            <small>{sentenceCase(SET_APART[c.set_apart_reason ?? ""] ?? "set apart")}</small>
          </p>
        ))}
        {open.length > 0 ? <p class="kind">Being checked</p> : null}
        {open.map((c) => (
          <p>{c.name}</p>
        ))}
      </div>
    </section>
  );
}

/** The stage on the home: the real form, with a stored search's figures at its foot. */
export function StageForm(props: {
  line: string;
  stage: Stage;
  country: string;
  error: string | null;
  tally: { found: number; proved: number; investors: number; since: string } | null;
}) {
  return (
    <form class="stage" method="post" action="/search" data-ui>
      <div>
        <label for="line">Your startup, in one line</label>
        <textarea id="line" name="line" rows={3} minlength={20} maxlength={140} spellcheck={false} required placeholder="What you build, and for whom">
          {props.line}
        </textarea>
        <div class="pick">
          <label>
            <select name="stage" aria-label="Stage">
              {STAGES.map((s) => (
                <option value={s} selected={s === props.stage}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
            <i>stage</i>
          </label>
          <label>
            <select name="country" aria-label="Country">
              {COUNTRIES.map((c) => (
                <option value={c} selected={c === props.country}>
                  {c}
                </option>
              ))}
            </select>
            <i>country</i>
          </label>
        </div>
        <button class="go" type="submit">
          Find who backed companies like this
        </button>
        {props.error !== null ? (
          <p class="err" role="alert">
            {props.error}
          </p>
        ) : null}
      </div>
      {props.tally !== null ? (
        <div class="tally">
          <div>
            <b class="num">{props.tally.found}</b>
            <span>companies like it that raised since {monthYear(props.tally.since)}</span>
          </div>
          <div>
            <b class="num">{props.tally.proved}</b>
            <span>proved by their own announcement</span>
          </div>
          <div>
            <b class="num">{props.tally.investors}</b>
            <span>investors behind them, ranked</span>
          </div>
        </div>
      ) : null}
    </form>
  );
}
