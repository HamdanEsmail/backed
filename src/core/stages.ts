// The four stages a founder can pick, in order, and how a row's round type is read as one of them.

export const STAGES = ["pre-seed", "seed", "series-a", "series-b"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  "pre-seed": "Pre-seed",
  seed: "Seed",
  "series-a": "Series A",
  "series-b": "Series B",
};

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

/** The founder's stage and the ones next to it, in order. */
export function stagesAround(stage: Stage): Stage[] {
  const i = STAGES.indexOf(stage);
  return STAGES.filter((_, j) => Math.abs(j - i) <= 1);
}

/** How far apart two stages are (0 the same, 1 next to each other). */
export function stageDistance(a: Stage, b: Stage): number {
  return Math.abs(STAGES.indexOf(a) - STAGES.indexOf(b));
}

/**
 * A row's round type as a stage, or null when it is none of the four. "Seed extension" and "Seed+"
 * are seed; "Series A extension" is Series A; "Pre-Series A" is a bridge after a seed and is read
 * as seed; a later round, a grant or debt is null.
 */
export function stageOfRound(roundType: unknown): Stage | null {
  if (typeof roundType !== "string") return null;
  const t = roundType.toLowerCase().replace(/[‐-―_]/g, "-");
  if (/\bpre[- ]?seed\b/.test(t)) return "pre-seed";
  if (/\bpre[- ]?series[- ]?a\b/.test(t)) return "seed";
  if (/\bseries[- ]?a\d?\b/.test(t)) return "series-a";
  if (/\bseries[- ]?b\d?\b/.test(t)) return "series-b";
  if (/\bseries[- ]?[c-z]\b/.test(t)) return null;
  if (/\bseed\b/.test(t)) return "seed";
  return null;
}
