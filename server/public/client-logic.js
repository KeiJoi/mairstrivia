// Pure, DOM-free decision helpers for the player answer page's click/confirmation flow and Answer Reveal
// standings selection. Kept separate from app.js (which touches document/fetch/WebSocket/localStorage at module
// load time) purely so this logic can be unit-tested with plain Node/vitest, with no browser environment needed.

/** True once the server-issued deadline has passed. This is a UX-only guard (disable buttons, hide the confirm
 * modal) — the server independently rejects any answer/change arriving after its own auto-close timer fires (or
 * after a host-triggered close), so a stale client can never author a late answer either way. */
export function isQuestionExpired(closesAt, nowMs = Date.now()) {
  return !!(closesAt && Date.parse(closesAt) <= nowMs);
}

/**
 * Decides what a click on `answerId` should do, given the current question state:
 * - "ignore"  — the question has already expired, or the SAME answer that's already submitted was clicked again
 *               (a deliberate no-op: no dialog, no request, no timestamp change)
 * - "submit"  — no answer has been submitted yet for this question: submit instantly, no confirmation
 * - "confirm" — a DIFFERENT answer is already submitted: require Change Answer / Keep Current Answer confirmation
 *               before anything authoritative changes
 */
export function decideChoiceClick(question, answerId, expired) {
  if (expired) return "ignore";
  if (!question.answerSubmitted) return "submit";
  if (answerId === question.selectedAnswerId) return "ignore";
  return "confirm";
}

/** Title for the per-question Answer Reveal standings list. This list is ALWAYS the current game's standings —
 * never the Series cumulative total, even inside a Series (see docs/MAIRS_TRIVIA_GAMEPLAY_HARDENING.md) — the
 * label just disambiguates "Game standings" from the separately-shown Series total when a Series is active. */
export function revealStandingsTitle(seriesId) {
  return seriesId ? "Game standings" : "Standings";
}
