// A search as the API and the pages read it: the search, its figures, the ranked investors with
// every deal, quotation and part, and every company. Reads only what is stored.
import { THIN_BELOW, WAY_IN_TOP } from "../core/limits";
import { STAGE_LABELS, stageOfRound, type Stage } from "../core/stages";
import type { Part } from "./score";
import { getSearch, type CompanyInvestorRow, type CompanyRow, type SearchRow } from "./store";
import { doorSentence, firstLine, NO_CHEQUE, warmRoute, type InvestorLookupRow, type WarmPerson } from "./wayin";
import { failedSentence, NO_PARTNER, noCompaniesSentence, setApartSentence, thinSentence } from "./words";

type RankingRow = {
  investor_key: string;
  position: number;
  name: string;
  slug: string;
  score: number;
  companies: number;
  led: number;
  stages_json: string;
  min_round_usd: number | null;
  max_round_usd: number | null;
  site_hint: string | null;
};

export type DealView = {
  company: string;
  company_id: string;
  led: boolean;
  round_type: string | null;
  amount_usd: number | null;
  announced_on: string | null;
  country: string | null;
  quote: string | null;
  source_url: string | null;
  read_at: string | null;
  partner: string | null;
  /** "The announcement names no partner." when the investor led and the page named none. */
  partner_note: string | null;
  founders: string[];
  points: number;
  parts: Part[];
};

export type WayInView = {
  site_url: string | null;
  /** "row" (the announcement row gave it), "search" (found by a search, so marked) or "none". */
  site_source: string | null;
  door: { kind: string | null; url: string | null; email: string | null; text: string };
  cheque: { quote: string; url: string | null } | null;
  cheque_text: string;
  read_at: string | null;
};

export type InvestorView = {
  position: number;
  name: string;
  slug: string;
  score: number;
  companies: number;
  led: number;
  rounds: { stages: string[]; min_usd: number | null; max_usd: number | null };
  site_hint: string | null;
  deals: DealView[];
  /** For the top investors, once looked up; null until then and below the top. */
  way_in: WayInView | null;
  warm_route: WarmPerson[];
  first_line: string | null;
};

export type CompanyView = {
  id: string;
  name: string;
  website: string | null;
  country: string | null;
  description: string | null;
  round_type: string | null;
  amount_usd: number | null;
  announced_on: string | null;
  announcement_url: string | null;
  lead_investor: string | null;
  other_investors: string | null;
  state: CompanyRow["state"];
  set_apart_reason: string | null;
  set_apart_text: string | null;
  page_url: string | null;
  read_at: string | null;
  partner: string | null;
  founders: string[];
  named_investors: { name: string; role: string; quote: string | null }[];
};

export type SearchView = {
  search: {
    id: string;
    line: string;
    stage: Stage;
    stage_label: string;
    country: string;
    state: SearchRow["state"];
    demo: number | null;
    window_start: string;
    created_at: string;
    finished_at: string | null;
    expires_at: string | null;
    dataset_id: string | null;
    cost_usd: number | null;
    cost_basis: string | null;
    failed_reason: string | null;
    /** The sentence the page shows for the search's state, when it has one. */
    notice: string | null;
  };
  figures: { found: number; proved: number; set_apart: number; checking: number; investors: number };
  investors: InvestorView[];
  companies: CompanyView[];
  /** The spec TinySet was sent ("What TinySet was asked"). */
  asked: unknown;
};

const founders = (json: string | null): string[] => (json === null ? [] : (JSON.parse(json) as string[]));

export async function readSearch(db: D1Database, id: string): Promise<SearchView | null> {
  const s = await getSearch(db, id);
  if (s === null) return null;
  const [companiesRes, investorsRes, rankingRes, lookupsRes] = await db.batch([
    db.prepare("SELECT * FROM companies WHERE search_id = ? AND removed = 0 ORDER BY announced_on DESC, name").bind(id),
    db.prepare("SELECT * FROM company_investors WHERE search_id = ?").bind(id),
    db.prepare("SELECT * FROM ranking WHERE search_id = ? ORDER BY position").bind(id),
    db
      .prepare(
        "SELECT i.* FROM investors i JOIN ranking r ON r.investor_key = i.investor_key WHERE r.search_id = ? AND r.position <= ? AND i.state = 'done'",
      )
      .bind(id, WAY_IN_TOP),
  ]);
  const lookups = new Map(((lookupsRes?.results ?? []) as InvestorLookupRow[]).map((l) => [l.investor_key, l]));
  const companies = (companiesRes?.results ?? []) as CompanyRow[];
  const links = (investorsRes?.results ?? []) as CompanyInvestorRow[];
  const ranking = (rankingRes?.results ?? []) as RankingRow[];
  const byId = new Map(companies.map((c) => [c.id, c]));

  const companyViews: CompanyView[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    website: c.website,
    country: c.country,
    description: c.description,
    round_type: c.round_type,
    amount_usd: c.amount_usd,
    announced_on: c.announced_on,
    announcement_url: c.announcement_url,
    lead_investor: c.lead_investor,
    other_investors: c.other_investors,
    state: c.state,
    set_apart_reason: c.state === "set_apart" ? c.set_apart_reason : null,
    set_apart_text: c.state === "set_apart" ? setApartSentence(c.set_apart_reason) : null,
    page_url: c.page_url,
    read_at: c.read_at,
    partner: c.partner_named,
    founders: founders(c.founders_named_json),
    named_investors:
      c.state === "proved"
        ? links.filter((l) => l.company_id === c.id && l.named === 1).map((l) => ({ name: l.name, role: l.role, quote: l.quote }))
        : [],
  }));

  const investors: InvestorView[] = ranking.map((r) => {
    const deals = links
      .filter((l) => l.investor_key === r.investor_key && l.named === 1 && l.points !== null && byId.get(l.company_id)?.state === "proved")
      .map((l): DealView => {
        const c = byId.get(l.company_id)!;
        return {
          company: c.name,
          company_id: c.id,
          led: l.role === "lead",
          round_type: c.round_type,
          amount_usd: c.amount_usd,
          announced_on: c.announced_on,
          country: c.country,
          quote: l.quote,
          source_url: c.page_url ?? c.announcement_url,
          read_at: c.read_at,
          partner: l.role === "lead" ? c.partner_named : null,
          partner_note: l.role === "lead" && c.partner_named === null ? NO_PARTNER : null,
          founders: founders(c.founders_named_json),
          points: l.points ?? 0,
          parts: l.parts_json === null ? [] : (JSON.parse(l.parts_json) as Part[]),
        };
      })
      .sort((a, b) => b.points - a.points || String(b.announced_on).localeCompare(String(a.announced_on)));
    const warm = deals.map((d) => ({
      company: d.company,
      led: d.led,
      stage: stageOfRound(d.round_type),
      announcedOn: d.announced_on,
      partner: d.partner,
      founders: d.founders,
    }));
    const lookup = r.position <= WAY_IN_TOP ? lookups.get(r.investor_key) : undefined;
    return {
      position: r.position,
      name: r.name,
      slug: r.slug,
      score: r.score,
      companies: r.companies,
      led: r.led,
      rounds: { stages: (JSON.parse(r.stages_json) as Stage[]).map((x) => STAGE_LABELS[x]), min_usd: r.min_round_usd, max_usd: r.max_round_usd },
      site_hint: r.site_hint,
      deals,
      way_in:
        lookup === undefined
          ? null
          : {
              site_url: lookup.site_url,
              site_source: lookup.site_source,
              door: { kind: lookup.door_kind, url: lookup.door_url, email: lookup.door_email, text: doorSentence(lookup) },
              cheque: lookup.cheque_quote !== null ? { quote: lookup.cheque_quote, url: lookup.cheque_url } : null,
              cheque_text: lookup.cheque_quote ?? NO_CHEQUE,
              read_at: lookup.read_at,
            },
      warm_route: warmRoute(warm),
      first_line: firstLine(warm, s.line, s.stage),
    };
  });

  const figures = {
    found: companies.length,
    proved: companies.filter((c) => c.state === "proved").length,
    set_apart: companies.filter((c) => c.state === "set_apart").length,
    checking: companies.filter((c) => c.state === "unchecked" || c.state === "checking").length,
    investors:
      ranking.length > 0
        ? ranking.length
        : new Set(links.filter((l) => l.named === 1 && byId.get(l.company_id)?.state === "proved").map((l) => l.investor_key)).size,
  };

  let notice: string | null = null;
  if (s.state === "failed") notice = s.failed_reason === "none_found" ? noCompaniesSentence(s.window_start) : failedSentence(s.failed_reason);
  else if (s.state === "ready" && figures.proved < THIN_BELOW) notice = thinSentence(figures.proved);

  return {
    search: {
      id: s.id,
      line: s.line,
      stage: s.stage,
      stage_label: STAGE_LABELS[s.stage],
      country: s.country,
      state: s.state,
      demo: s.demo,
      window_start: s.window_start,
      created_at: s.created_at,
      finished_at: s.finished_at,
      expires_at: s.expires_at,
      dataset_id: s.dataset_id,
      cost_usd: s.cost_usd,
      cost_basis: s.cost_basis,
      failed_reason: s.failed_reason,
      notice,
    },
    figures,
    investors,
    companies: companyViews,
    asked: JSON.parse(s.spec_json) as unknown,
  };
}

/** The saved searches: finished and ranked, the demo searches first, then the newest. */
export async function listSearches(db: D1Database, limit = 50) {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.line, s.stage, s.country, s.demo, s.created_at, s.finished_at,
              (SELECT COUNT(*) FROM companies c WHERE c.search_id = s.id AND c.removed = 0 AND c.state = 'proved') AS proved,
              (SELECT COUNT(*) FROM ranking r WHERE r.search_id = s.id) AS investors,
              (SELECT name FROM ranking r WHERE r.search_id = s.id AND r.position = 1) AS first_investor
       FROM searches s WHERE s.state = 'ready'
       ORDER BY s.demo IS NULL, s.demo, s.created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string; line: string; stage: Stage; country: string; demo: number | null; created_at: string; finished_at: string | null; proved: number; investors: number; first_investor: string | null }>();
  return results;
}
