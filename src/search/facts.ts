// A TinySet row read as the facts of one company. Cells can be missing, null, or of the wrong type
// while a run is in progress; each is read tolerantly.

export type CompanyFacts = {
  name: string;
  website: string | null;
  country: string | null;
  description: string | null;
  roundType: string | null;
  amountUsd: number | null;
  /** YYYY-MM-DD, or null when the cell is not a date. */
  announcedOn: string | null;
  leadInvestor: string | null;
  leadInvestorWebsite: string | null;
  otherInvestors: string | null;
  leadPartner: string | null;
  founders: string | null;
  announcementUrl: string | null;
};

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t === "" || /^(null|none|n\/a|unknown)$/i.test(t) ? null : t;
};

const httpUrl = (v: unknown): string | null => {
  const t = text(v);
  if (t === null) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t) ? `https://${t}` : null;
  if (withScheme === null) return null;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
};

const amount = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v) > 0 ? Number(v) : null;
  return null;
};

const date = (v: unknown): string | null => {
  const t = text(v);
  const m = t === null ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m === null) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}` ? null : `${m[1]}-${m[2]}-${m[3]}`;
};

/** The facts of a row, or null when the row has no company name yet. */
export function factsOf(data: Record<string, unknown>): CompanyFacts | null {
  const name = text(data.company);
  if (name === null) return null;
  return {
    name,
    website: httpUrl(data.website),
    country: text(data.country),
    description: text(data.description),
    roundType: text(data.round_type),
    amountUsd: amount(data.amount_raised),
    announcedOn: date(data.announcement_date),
    leadInvestor: text(data.lead_investor),
    leadInvestorWebsite: httpUrl(data.lead_investor_website),
    otherInvestors: text(data.other_investors),
    leadPartner: text(data.lead_partner),
    founders: text(data.founders),
    announcementUrl: httpUrl(data.announcement_url),
  };
}

/** The fields the proof check depends on, joined. When this changes, the company is checked again. */
export function checkKeyOf(f: CompanyFacts): string {
  return JSON.stringify([f.name, f.announcementUrl, f.announcedOn, f.roundType, f.leadInvestor, f.otherInvestors, f.leadPartner, f.founders]);
}
