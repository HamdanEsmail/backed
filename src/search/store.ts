// The rows a search keeps in D1, and the statements that change them. Every step that does work
// claims it first in one statement, so two `advance` calls at once never do the same work twice.
import { CHECK_CLAIM_STALE_MINUTES } from "../core/limits";
import type { Stage } from "../core/stages";
import type { DatasetRow } from "../tinyfish/datasets";
import { checkKeyOf, factsOf, type CompanyFacts } from "./facts";
import type { ProofResult } from "./proof";

export type SearchState = "queued" | "finding" | "checking" | "ranking" | "ready" | "failed";

export type SearchRow = {
  id: string;
  line: string;
  stage: Stage;
  country: string;
  reuse_key: string;
  origin: "public" | "admin" | "import";
  demo: number | null;
  state: SearchState;
  failed_reason: string | null;
  window_start: string;
  stages_json: string;
  spec_json: string;
  dataset_id: string | null;
  run_id: string | null;
  dataset_status: string | null;
  row_count: number | null;
  synced_at: string | null;
  wallet_before_usd: number | null;
  wallet_after_usd: number | null;
  cost_usd: number | null;
  cost_basis: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
  ranked_at: string | null;
};

export type CompanyRow = {
  id: string;
  search_id: string;
  row_id: string;
  source: string;
  removed: number;
  name: string;
  website: string | null;
  country: string | null;
  description: string | null;
  round_type: string | null;
  amount_usd: number | null;
  announced_on: string | null;
  lead_investor: string | null;
  lead_investor_website: string | null;
  other_investors: string | null;
  lead_partner: string | null;
  founders: string | null;
  announcement_url: string | null;
  check_key: string;
  state: "unchecked" | "checking" | "proved" | "set_apart";
  claimed_at: string | null;
  set_apart_reason: string | null;
  page_url: string | null;
  read_at: string | null;
  partner_named: string | null;
  founders_named_json: string | null;
  found_at: string;
  updated_at: string;
};

export type CompanyInvestorRow = {
  company_id: string;
  search_id: string;
  investor_key: string;
  name: string;
  role: "lead" | "other";
  named: number;
  quote: string | null;
  points: number | null;
  parts_json: string | null;
};

export function getSearch(db: D1Database, id: string): Promise<SearchRow | null> {
  return db.prepare("SELECT * FROM searches WHERE id = ?").bind(id).first<SearchRow>();
}

export const stagesOf = (s: SearchRow): Stage[] => JSON.parse(s.stages_json) as Stage[];

/** The company's facts as stored. */
export function factsOfRow(c: CompanyRow): CompanyFacts {
  return {
    name: c.name,
    website: c.website,
    country: c.country,
    description: c.description,
    roundType: c.round_type,
    amountUsd: c.amount_usd,
    announcedOn: c.announced_on,
    leadInvestor: c.lead_investor,
    leadInvestorWebsite: c.lead_investor_website,
    otherInvestors: c.other_investors,
    leadPartner: c.lead_partner,
    founders: c.founders,
    announcementUrl: c.announcement_url,
  };
}

/**
 * Stores the rows read from a dataset, by their `_id`. A new row is a new unchecked company. A row
 * whose checked fields changed (a new announcement link, other investors) is unchecked again; a
 * check of the old version still in flight will find its claim gone and write nothing. When the
 * list is complete, rows no longer in it (merged or removed) are marked removed.
 */
export async function storeRows(db: D1Database, searchId: string, rows: DatasetRow[], complete: boolean, now: Date): Promise<number> {
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  const kept: string[] = [];
  for (const row of rows) {
    if (row.data.in_scope === false) continue;
    const f = factsOf(row.data);
    if (f === null) continue;
    kept.push(row.id);
    statements.push(
      db
        .prepare(
          `INSERT INTO companies (id, search_id, row_id, source, removed, name, website, country, description, round_type,
             amount_usd, announced_on, lead_investor, lead_investor_website, other_investors, lead_partner, founders,
             announcement_url, check_key, state, found_at, updated_at)
           VALUES (?1, ?2, ?3, 'tinyset', 0, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'unchecked', ?18, ?18)
           ON CONFLICT (search_id, row_id) DO UPDATE SET
             removed = 0,
             name = excluded.name, website = excluded.website, country = excluded.country,
             description = excluded.description, round_type = excluded.round_type, amount_usd = excluded.amount_usd,
             announced_on = excluded.announced_on, lead_investor = excluded.lead_investor,
             lead_investor_website = excluded.lead_investor_website, other_investors = excluded.other_investors,
             lead_partner = excluded.lead_partner, founders = excluded.founders,
             announcement_url = excluded.announcement_url,
             state = CASE WHEN companies.check_key = excluded.check_key THEN companies.state ELSE 'unchecked' END,
             claimed_at = CASE WHEN companies.check_key = excluded.check_key THEN companies.claimed_at ELSE NULL END,
             set_apart_reason = CASE WHEN companies.check_key = excluded.check_key THEN companies.set_apart_reason ELSE NULL END,
             check_key = excluded.check_key,
             updated_at = CASE WHEN companies.check_key = excluded.check_key THEN companies.updated_at ELSE excluded.updated_at END`,
        )
        .bind(
          crypto.randomUUID(),
          searchId,
          row.id,
          f.name,
          f.website,
          f.country,
          f.description,
          f.roundType,
          f.amountUsd,
          f.announcedOn,
          f.leadInvestor,
          f.leadInvestorWebsite,
          f.otherInvestors,
          f.leadPartner,
          f.founders,
          f.announcementUrl,
          checkKeyOf(f),
          at,
        ),
    );
  }
  if (complete) {
    statements.push(
      db
        .prepare("UPDATE companies SET removed = 1 WHERE search_id = ? AND source = 'tinyset' AND row_id NOT IN (SELECT value FROM json_each(?))")
        .bind(searchId, JSON.stringify(kept)),
    );
  }
  if (statements.length > 0) await db.batch(statements);
  return kept.length;
}

/** Claims the next company to check: unchecked, or claimed so long ago its check must have died.
 *  One statement, so a company is claimed by one caller at a time. */
export async function claimCompany(db: D1Database, searchId: string, now: Date): Promise<CompanyRow | null> {
  const staleBefore = new Date(now.getTime() - CHECK_CLAIM_STALE_MINUTES * 60_000).toISOString();
  return db
    .prepare(
      `UPDATE companies SET state = 'checking', claimed_at = ?1
       WHERE id = (SELECT id FROM companies
                   WHERE search_id = ?2 AND removed = 0
                     AND (state = 'unchecked' OR (state = 'checking' AND claimed_at < ?3))
                   ORDER BY found_at, row_id LIMIT 1)
       RETURNING *`,
    )
    .bind(`${now.toISOString()}#${crypto.randomUUID()}`, searchId, staleBefore)
    .first<CompanyRow>();
}

/**
 * Writes a check's result, only while the claim it was made under still holds: the same claim and
 * the same checked fields. A row that changed meanwhile, or a claim taken over after it went stale,
 * makes every statement here a no-op. True when written.
 */
export async function saveCheck(
  db: D1Database,
  claimed: CompanyRow,
  result: ProofResult,
  read: { pageUrl: string | null; readAt: string | null },
  now: Date,
): Promise<boolean> {
  const guard = "EXISTS (SELECT 1 FROM companies WHERE id = ?1 AND claimed_at = ?2 AND check_key = ?3 AND state IN ('proved', 'set_apart'))";
  const proved = result.status === "proved";
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE companies SET state = ?4, set_apart_reason = ?5, page_url = ?6, read_at = ?7, partner_named = ?8,
           founders_named_json = ?9, updated_at = ?10
         WHERE id = ?1 AND claimed_at = ?2 AND check_key = ?3 AND state = 'checking'`,
      )
      .bind(
        claimed.id,
        claimed.claimed_at,
        claimed.check_key,
        result.status,
        proved ? null : result.reason,
        read.pageUrl,
        read.readAt,
        proved ? result.partner : null,
        proved ? JSON.stringify(result.founders) : null,
        now.toISOString(),
      ),
    db.prepare(`DELETE FROM company_investors WHERE company_id = ?1 AND ${guard}`).bind(claimed.id, claimed.claimed_at, claimed.check_key),
  ];
  for (const inv of result.investors) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO company_investors (company_id, search_id, investor_key, name, role, named, quote)
           SELECT ?1, ?4, ?5, ?6, ?7, ?8, ?9 WHERE ${guard}`,
        )
        .bind(claimed.id, claimed.claimed_at, claimed.check_key, claimed.search_id, inv.key, inv.name, inv.role, inv.named ? 1 : 0, inv.quote),
    );
  }
  const [update] = await db.batch(statements);
  return (update?.meta.changes ?? 0) === 1;
}

export type CompanyCounts = { found: number; pending: number; proved: number; setApart: number };

export async function companyCounts(db: D1Database, searchId: string): Promise<CompanyCounts> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS found,
              SUM(CASE WHEN state IN ('unchecked', 'checking') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN state = 'proved' THEN 1 ELSE 0 END) AS proved,
              SUM(CASE WHEN state = 'set_apart' THEN 1 ELSE 0 END) AS set_apart
       FROM companies WHERE search_id = ? AND removed = 0`,
    )
    .bind(searchId)
    .first<{ found: number; pending: number | null; proved: number | null; set_apart: number | null }>();
  return { found: row?.found ?? 0, pending: row?.pending ?? 0, proved: row?.proved ?? 0, setApart: row?.set_apart ?? 0 };
}
