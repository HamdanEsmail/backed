// The CSV export: one row per investor and company, with the quotation, the proof link, when it was
// read, and the points, part by part. The JSON export is the search's view as the API gives it.
import { stageInText, stageOfRound } from "../core/stages";
import type { SearchView } from "./read";
import type { Part } from "./score";

export const CSV_COLUMNS = [
  "rank",
  "investor",
  "score",
  "company",
  "role",
  "round",
  "amount_usd",
  "announced_on",
  "company_country",
  "quotation",
  "proof_url",
  "read_at",
  "points",
  "sum",
  "partner",
  "founders",
  "way_in",
  "first_line",
] as const;

const PART_WORDS: Record<Part["part"], string> = {
  backed: "backed it",
  led: "led the round",
  same_stage: "your stage",
  next_stage: "the stage next to yours",
  same_country: "your country",
  recent: "in the last six months",
};

/** One cell. Text that a spreadsheet would run as a formula (=, +, -, @ at its start) is kept as text
 *  by a leading apostrophe; a cell with a comma, a quote or a line break is quoted. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let s = typeof value === "number" ? String(value) : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function searchCsv(view: SearchView): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const inv of view.investors) {
    for (const d of inv.deals) {
      const stage = stageOfRound(d.round_type);
      const sum = `${d.parts.map((p) => `${PART_WORDS[p.part]} ${p.points}`).join(" + ")} = ${d.points}`;
      const row: (string | number | null)[] = [
        inv.position,
        inv.name,
        inv.score,
        d.company,
        d.led ? "led" : "joined",
        stage !== null ? stageInText(stage) : d.round_type,
        d.amount_usd,
        d.announced_on,
        d.country,
        d.quote,
        d.source_url,
        d.read_at,
        d.points,
        sum,
        d.led ? (d.partner ?? "The announcement names no partner.") : null,
        d.founders.join("; "),
        inv.way_in?.door.text ?? null,
        inv.first_line,
      ];
      lines.push(row.map(csvCell).join(","));
    }
  }
  return `${lines.join("\r\n")}\r\n`;
}
