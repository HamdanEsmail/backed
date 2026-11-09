// The sentences a search's honest states are shown in. The API gives the code and the sentence;
// the pages use the same sentences.
import { PUBLIC_SEARCHES_PER_DAY } from "../core/limits";
import { longDate } from "./spec";

/** Why a company was set apart, as the list of companies says it. */
export const SET_APART: Record<string, string> = {
  no_url: "the row gives no link to an announcement",
  no_date: "the row gives no announcement date",
  before_window: "announced before the window",
  stage_not_asked: "the round is not one of the stages asked for",
  no_investors_listed: "the row names no investors",
  unreadable: "the announcement could not be read",
  company_not_named: "the linked page does not name the company",
  no_investor_named: "the linked page names none of the listed investors",
};

/** Why a search did not finish, completing "This search did not finish: <reason>. Nothing was ranked." */
export const FAILED: Record<string, string> = {
  none_found: "TinySet found no companies like this",
  run_failed: "TinySet stopped before it finished, and too few companies were proved",
  run_cancelled: "the TinySet run was stopped, and too few companies were proved",
  timeout: "TinySet took too long, and too few companies were proved",
  start_failed: "TinySet would not start the search",
  spend_stop: "this demo has spent its budget",
};

export function setApartSentence(reason: string | null): string {
  return (reason !== null && SET_APART[reason]) || "set apart";
}

export function failedSentence(reason: string | null): string {
  return `This search did not finish: ${(reason !== null && FAILED[reason]) || "it stopped"}. Nothing was ranked.`;
}

export function noCompaniesSentence(windowStart: string): string {
  return `TinySet found no companies like this that raised since ${longDate(windowStart)}. Try describing the product and its customer in other words.`;
}

export function thinSentence(proved: number): string {
  return `Only ${proved} ${proved === 1 ? "company" : "companies"} like this ${proved === 1 ? "was" : "were"} proved. The list is thin: read it as a start.`;
}

export const NO_PARTNER = "The announcement names no partner.";
export const DAILY_LIMIT = `Today's ${PUBLIC_SEARCHES_PER_DAY} new searches are used. Stored searches still open.`;
export const VISITOR_LIMIT = "You have started today's search from here already. Stored searches still open.";
export const SPEND_STOP = "New searches are closed: this demo has spent its budget. Stored searches still open.";
