export const QUESTION_SET_FORMAT = "fftrivia-question-set" as const;
export const QUESTION_SET_SCHEMA_VERSION = 1 as const;
export const BRAND = {
  primaryOrange: "#FF5400",
  accentPink: "#FF2BD6",
  background: "#101010",
} as const;

export type QuestionState = "unused" | "previewed" | "skipped" | "asked" | "completed";
export type QuestionOrder = "inOrder" | "shuffleOnce";
