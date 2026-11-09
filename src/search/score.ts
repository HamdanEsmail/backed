// The score: simple sums over the proved companies an investor is named on. Every part is kept, so
// every screen and export can show the sum. No points for size or fame. Pure.
import { inCountry } from "../core/countries";
import { slugOf } from "../core/names";
import { stageDistance, STAGES, type Stage } from "../core/stages";

export const POINTS = {
  backed: 3,
  led: 2,
  same_stage: 2,
  next_stage: 1,
  same_country: 1,
  recent: 1,
} as const;

export type PartName = keyof typeof POINTS;
export type Part = { part: PartName; points: number };

/** Rounds announced on or after this many months before today earn the `recent` point. */
export const RECENT_MONTHS = 6;

export type RankCompany = {
  id: string;
  name: string;
  stage: Stage;
  country: string | null;
  amountUsd: number | null;
  announcedOn: string;
  leadInvestorWebsite: string | null;
  /** Every investor the row lists; only those the page names count. */
  investors: { key: string; name: string; role: "lead" | "other"; named: boolean }[];
};

export type Deal = {
  companyId: string;
  company: string;
  led: boolean;
  stage: Stage;
  amountUsd: number | null;
  announcedOn: string;
  points: number;
  parts: Part[];
};

export type RankedInvestor = {
  key: string;
  name: string;
  slug: string;
  position: number;
  score: number;
  companies: number;
  led: number;
  /** "Rounds they joined": the stages, in stage order, and the smallest and largest round. */
  stages: Stage[];
  minRoundUsd: number | null;
  maxRoundUsd: number | null;
  /** A website a row gives for this investor, when it was the round's only lead. */
  siteHint: string | null;
  deals: Deal[];
};

export type Founder = { stage: Stage; country: string };

/** YYYY-MM-DD `months` calendar months before `today` (UTC). */
export function monthsBefore(today: Date, months: number): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, today.getUTCDate()));
  // 31 August minus six months has no 31 February: Date rolls into March; take the month's last day.
  if (d.getUTCDate() !== today.getUTCDate()) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** The parts one company earns an investor. */
export function partsFor(company: RankCompany, led: boolean, founder: Founder, recentSince: string): Part[] {
  const parts: Part[] = [{ part: "backed", points: POINTS.backed }];
  if (led) parts.push({ part: "led", points: POINTS.led });
  const distance = stageDistance(company.stage, founder.stage);
  if (distance === 0) parts.push({ part: "same_stage", points: POINTS.same_stage });
  else if (distance === 1) parts.push({ part: "next_stage", points: POINTS.next_stage });
  if (inCountry(company.country, founder.country)) parts.push({ part: "same_country", points: POINTS.same_country });
  if (company.announcedOn >= recentSince) parts.push({ part: "recent", points: POINTS.recent });
  return parts;
}

const sum = (parts: Part[]) => parts.reduce((t, p) => t + p.points, 0);

/**
 * Ranks the investors named on proved companies. Order: score, then number of companies, then name.
 * An investor's name is spelled as on its most recent deal.
 */
export function rank(companies: RankCompany[], founder: Founder, today: Date): RankedInvestor[] {
  const recentSince = monthsBefore(today, RECENT_MONTHS);
  const ordered = [...companies].sort((a, b) => (a.announcedOn < b.announcedOn ? 1 : a.announcedOn > b.announcedOn ? -1 : a.name.localeCompare(b.name)));

  const byKey = new Map<string, { key: string; name: string; deals: Deal[]; siteHint: string | null }>();
  for (const c of ordered) {
    const leads = c.investors.filter((i) => i.role === "lead");
    for (const inv of c.investors) {
      if (!inv.named) continue;
      let entry = byKey.get(inv.key);
      if (entry === undefined) {
        entry = { key: inv.key, name: inv.name, deals: [], siteHint: null };
        byKey.set(inv.key, entry);
      }
      if (entry.deals.some((d) => d.companyId === c.id)) continue;
      const led = inv.role === "lead";
      if (led && leads.length === 1 && c.leadInvestorWebsite !== null) entry.siteHint ??= c.leadInvestorWebsite;
      const parts = partsFor(c, led, founder, recentSince);
      entry.deals.push({
        companyId: c.id,
        company: c.name,
        led,
        stage: c.stage,
        amountUsd: c.amountUsd,
        announcedOn: c.announcedOn,
        points: sum(parts),
        parts,
      });
    }
  }

  const ranked = [...byKey.values()].map((e) => {
    const deals = [...e.deals].sort((a, b) => b.points - a.points || (a.announcedOn < b.announcedOn ? 1 : a.announcedOn > b.announcedOn ? -1 : 0));
    const amounts = deals.map((d) => d.amountUsd).filter((x): x is number => x !== null);
    return {
      key: e.key,
      name: e.name,
      slug: "",
      position: 0,
      score: deals.reduce((t, d) => t + d.points, 0),
      companies: deals.length,
      led: deals.filter((d) => d.led).length,
      stages: STAGES.filter((s) => deals.some((d) => d.stage === s)),
      minRoundUsd: amounts.length > 0 ? Math.min(...amounts) : null,
      maxRoundUsd: amounts.length > 0 ? Math.max(...amounts) : null,
      siteHint: e.siteHint,
      deals,
    };
  });

  ranked.sort((a, b) => b.score - a.score || b.companies - a.companies || a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.key.localeCompare(b.key));

  const used = new Set<string>();
  ranked.forEach((r, i) => {
    r.position = i + 1;
    const base = slugOf(r.name);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    r.slug = slug;
  });
  return ranked;
}
