// From the founder's line to a TinySet spec, and the rules the line, the stage and the country must
// meet. No model of Backed's own reads the line: it goes into the spec's description and into the
// `in_scope` column's hint, and TinySet does the judging.
import { isCountry, type Country } from "../core/countries";
import { LINE_MAX_CHARS, LINE_MIN_CHARS, WINDOW_MONTHS } from "../core/limits";
import { isStage, STAGE_LABELS, stagesAround, type Stage } from "../core/stages";
import type { DatasetSpec, SpecColumn } from "../tinyfish/datasets";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The first day of the month WINDOW_MONTHS before `today`, as YYYY-MM-DD (UTC). */
export function windowStart(today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - WINDOW_MONTHS, 1));
  return d.toISOString().slice(0, 10);
}

/** "1 May 2025" for "2025-05-01". */
export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** "May 2025" for "2025-05-01". */
export function monthYear(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** "pre-seed, seed or Series A". */
export function stageList(stages: Stage[]): string {
  const words = stages.map((s) => (s === "pre-seed" || s === "seed" ? STAGE_LABELS[s].toLowerCase() : STAGE_LABELS[s]));
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

// --- Input rules ---------------------------------------------------------------------------------

export type SearchInput = { line: string; stage: Stage; country: Country };

export type InputResult = { ok: true; input: SearchInput } | { ok: false; field: "line" | "stage" | "country"; message: string };

const URL_LIKE = /https?:\/\/|\bwww\.|\b[\p{L}\p{N}-]+\.(?:com|net|org|io|ai|co|app|dev|xyz|me|so|ly|vc|tech|uk|de|fr|ae|in|ke|ng|za|br|es|it|nl)\b/iu;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** The line as stored and sent: control characters gone, whitespace collapsed, quotes made single
 *  so the line cannot close the quotation it is placed in. */
export function cleanLine(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/["“”«»]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function checkInput(body: { line?: unknown; stage?: unknown; country?: unknown }): InputResult {
  if (typeof body.line !== "string") return { ok: false, field: "line", message: "Describe your startup in one line." };
  const line = cleanLine(body.line);
  if ([...line].length < LINE_MIN_CHARS) {
    return { ok: false, field: "line", message: `Say a little more: at least ${LINE_MIN_CHARS} characters, what you build and for whom.` };
  }
  if ([...line].length > LINE_MAX_CHARS) {
    return { ok: false, field: "line", message: `Keep it to one line: at most ${LINE_MAX_CHARS} characters.` };
  }
  if (URL_LIKE.test(line) || EMAIL_LIKE.test(line)) {
    return { ok: false, field: "line", message: "Describe the startup in words, without a web address or an email address." };
  }
  if (!isStage(body.stage)) return { ok: false, field: "stage", message: "Pick a stage: pre-seed, seed, Series A or Series B." };
  if (!isCountry(body.country)) return { ok: false, field: "country", message: "Pick a country from the list." };
  return { ok: true, input: { line, stage: body.stage, country: body.country } };
}

/** The same line, stage and country give the same key, whatever the case, spacing or final full stop. */
export function reuseKey(input: SearchInput): string {
  const line = input.line.toLowerCase().replace(/\s+/g, " ").replace(/[.!\s]+$/, "").trim();
  return `${line}|${input.stage}|${input.country}`;
}

// --- The spec ------------------------------------------------------------------------------------

/**
 * The spec sent to TinySet for a search. The columns and their hints are fixed; only the
 * description, the date and the stages change with the founder's line and stage.
 */
export function buildSpec(line: string, stage: Stage, today: Date): { spec: DatasetSpec; windowStart: string; stages: Stage[] } {
  const start = windowStart(today);
  const stages = stagesAround(stage);
  const since = longDate(start);
  const stageWords = stageList(stages);
  const quoted = `"${cleanLine(line)}"`;

  const columns: SpecColumn[] = [
    { name: "company", label: "Company", type: "string", is_primary_key: true },
    {
      name: "website",
      label: "Website",
      type: "url",
      is_primary_key: false,
      is_unique: true,
      retrieval_hint: "The startup's own homepage, usually linked from its Crunchbase/Dealroom profile or the announcement article.",
    },
    {
      name: "country",
      label: "Country",
      type: "string",
      is_primary_key: false,
      retrieval_hint: "The startup's country of incorporation or headquarters, from its Crunchbase profile or the About page of its website.",
    },
    {
      name: "description",
      label: "Description",
      type: "string",
      is_primary_key: false,
      retrieval_hint: "A one-line summary of what the startup does, from the announcement article or its website tagline.",
    },
    {
      name: "round_type",
      label: "Round type",
      type: "string",
      is_primary_key: false,
      retrieval_hint: "The stage of the announced round as stated in the announcement article or funding database entry.",
      format: `One of: ${stages.map((s) => STAGE_LABELS[s]).join(", ")}`,
      examples: stages.slice(0, 3).map((s) => STAGE_LABELS[s]),
    },
    {
      name: "amount_raised",
      label: "Amount raised",
      type: "number",
      is_primary_key: false,
      retrieval_hint: "The total amount of the round as reported in the announcement article or funding database entry, converted to US dollars.",
    },
    {
      name: "announcement_date",
      label: "Announcement date",
      type: "date",
      is_primary_key: false,
      retrieval_hint: `The date the funding round was publicly announced, from the announcement's dateline. Must be on or after ${since}.`,
    },
    {
      name: "lead_investor",
      label: "Lead investor",
      type: "string",
      is_primary_key: false,
      retrieval_hint: "The firm or individual named as leading the round in the announcement article; leave empty if no lead was disclosed.",
    },
    {
      name: "lead_investor_website",
      label: "Lead investor website",
      type: "url",
      is_primary_key: false,
      retrieval_hint: "The homepage of the firm that led the round.",
    },
    {
      name: "other_investors",
      label: "Other investors",
      type: "string",
      is_primary_key: false,
      retrieval_hint: "The remaining investors in the round as listed in the announcement article, separated by semicolons; leave empty if none.",
    },
    {
      name: "lead_partner",
      label: "Lead partner",
      type: "string",
      is_primary_key: false,
      retrieval_hint:
        "The named person at the lead investor who led or sponsored the deal, usually quoted in the announcement or joining the board. Leave empty if the announcement names no such person.",
    },
    {
      name: "founders",
      label: "Founders",
      type: "string",
      is_primary_key: false,
      retrieval_hint: "The names of the company founders, as given in the funding announcement or on the company website. Comma separated.",
    },
    {
      name: "announcement_url",
      label: "Announcement URL",
      type: "url",
      is_primary_key: false,
      is_unique: true,
      retrieval_hint:
        "The exact URL of the company's own announcement or a news article that reports this round and names its investors. Not a database profile page.",
    },
    {
      name: "in_scope",
      label: "In scope",
      type: "boolean",
      is_primary_key: false,
      retrieval_hint: `True only when all three hold: the company builds a product comparable to ${quoted} for comparable customers; the round is a ${stageWords} round; and the round was announced on or after ${since}.`,
    },
  ];

  const spec: DatasetSpec = {
    name: `Funding rounds since ${monthYear(start)} of startups like ${quoted}`.slice(0, 200),
    description: `Startups similar to this one: ${quoted}. Companies that build a comparable product for comparable customers and that announced a ${stageWords} funding round on or after ${since}. One row per company, for its most recent such round.`,
    columns,
    keep_when: { column: "in_scope" },
  };
  return { spec, windowStart: start, stages };
}
