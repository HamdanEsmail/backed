// Small ways of writing things on the pages: money, dates, stages, places, the score's parts.
import { stageInText, stageOfRound, type Stage } from "../core/stages";
import type { Part } from "../search/score";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "$3.8M", "$12M", "$500K"; null for no amount. */
export function money(usd: number | null): string | null {
  if (usd === null || !Number.isFinite(usd) || usd <= 0) return null;
  const one = (n: number) => n.toFixed(1).replace(/\.0$/, "");
  if (usd >= 1e9) return `$${one(usd / 1e9)}B`;
  if (usd >= 1e6) return `$${one(usd / 1e6)}M`;
  if (usd >= 1e3) return `$${Math.round(usd / 1e3)}K`;
  return `$${Math.round(usd)}`;
}

/** "29 Sep 2026" for "2026-09-29" or a full time. */
export function shortDate(iso: string | null): string {
  if (iso === null) return "date not stated";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** A stage in running text: "pre-seed", "seed", "Series A". */
export function stageWord(stage: Stage | null): string {
  return stage === null ? "round" : stageInText(stage);
}

export function roundStage(roundType: string | null): Stage | null {
  return stageOfRound(roundType);
}

/** Countries that read with "the" in a sentence. */
const WITH_THE = /^(United |Netherlands$|Philippines$|Czech Republic$|Bahamas$|Gambia$|Maldives$|Marshall Islands$|Solomon Islands$|Comoros$|Central African Republic$|Dominican Republic$|Democratic Republic|Republic of)/;

/** "the United States", "Kenya". */
export function place(country: string): string {
  return WITH_THE.test(country) ? `the ${country}` : country;
}

/** A part of the score as the sum says it: "backed it", "a seed round, your stage". */
export function partLabel(p: Part, dealStage: Stage | null, country: string): string {
  switch (p.part) {
    case "backed":
      return "backed it";
    case "led":
      return "led the round";
    case "same_stage":
      return `a ${stageWord(dealStage)} round, your stage`;
    case "next_stage":
      return `a ${stageWord(dealStage)} round, next to your stage`;
    case "same_country":
      return `in ${place(country)}, your country`;
    case "recent":
      return "in the last six months";
  }
}

/** The host of an address without "www.": "geekwire.com". */
export function host(url: string | null): string {
  if (url === null) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "two", "three" for small counts, figures beyond. */
export function count(n: number): string {
  return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}
