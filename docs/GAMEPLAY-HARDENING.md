# Mair's Trivia — Gameplay & Answer Reveal Hardening

## 1. Executive summary

This pass fixes three production gameplay defects reported from live venue operation:

1. A player could avoid a guaranteed incorrect-answer penalty simply by never answering a question, creating a real, observed scoring exploit.
2. The player web page locked all answer buttons the instant a first answer was submitted, so a genuine misclick or reconsidered answer could never be corrected before the timer expired.
3. During a multi-game Series, the per-question Answer Reveal screen showed the cumulative Series standings instead of the current game's standings — correct by coincidence in Game 1 (series total == game total when only one game has been played), visibly wrong from Game 2 onward.

All three fixes are server-authoritative where scoring or timing is involved; the browser is UX only.

## 2. The three production issues

- **No-answer exploit.** `settleAnswers()` (`server/src/service.ts`) only ever iterated existing `player_answers` rows. A player who never submitted an answer had no row at all, so they were never scored — not even the configured incorrect-answer penalty. A player who intentionally lets the timer expire on every question they don't know previously paid nothing, while a player who guessed and got it wrong paid the full penalty.
- **Answer changes were effectively impossible in production.** The server already had `Scoring.allowAnswerChange` and correct change-replacement logic in `answer()`, but (a) it defaulted to `false` and was never exposed as an operator setting anywhere, and (b) the web page (`server/public/app.js`) added the `disabled` attribute to every choice button the moment `answerSubmitted` became true, so even a host who somehow enabled the flag couldn't have a player exercise it — there was no UI path to a second click.
- **Series Answer Reveal defect.** `server/public/app.js`'s `resultSection()` — the per-question reveal screen — chose `state.seriesId ? result.seriesStandings : result.leaderboard`, i.e. it substituted the Series cumulative total for the current game's standings whenever the game belonged to a Series, discarding `result.leaderboard` entirely in that case.

## 3. Root causes

- **No-answer:** a straightforward scoring-loop omission — the loop iterated the wrong source set (`player_answers` rows) instead of the authoritative eligible-participant set (`player_question_layouts` rows for the occurrence).
- **Answer change:** a config flag that was wired end-to-end at the API layer but never had a production activation path (no operator UI, default off) combined with a hard client-side lock that would have defeated it even if enabled.
- **Series reveal:** a UI-layer either/or choice where the server already sent both values correctly on every close (`hostState()`/`playerState()`'s "results" branch already compute and embed both `leaderboard` and `seriesStandings`) — the bug never touched scoring or persistence, only which of two already-correct payload fields the reveal screen chose to render.

## 4. No-answer authoritative scoring

Implemented entirely server-side in `settleAnswers()` (`server/src/service.ts`), which runs only inside `closeGame()`'s existing `question_open -> results` transaction — the single place a question is ever finalized. After scoring every existing `player_answers` row as before, a second pass finds every **eligible player with no answer row for this occurrence** and inserts one, using the same configured `scoring.incorrectPoints` as a wrong answer, with no first/second/third-correct bonus and no time bonus (neither is meaningful for a non-response):

```ts
const unanswered = this.db.prepare(`
  SELECT l.player_id AS playerId FROM player_question_layouts l
    JOIN players p ON p.id = l.player_id
   WHERE l.occurrence_id = ? AND p.removed_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM player_answers a WHERE a.player_id = l.player_id AND a.occurrence_id = l.occurrence_id)`)
  .all(occurrence.id);
```

Each unanswered player gets a `player_answers` row with `answer_id = NULL`, `is_correct = 0`, `base_points/points_awarded = scoring.incorrectPoints`, and `players.score`/`incorrect_count` updated identically to a wrong answer. `incorrectPoints` is never hardcoded — it is always read from the game's own persisted `scoring_json`, so a game configured for `0` gives no-answer players `0`, and a game configured for `-100` gives them exactly `-100`, matching a wrong answer penny for penny.

## 5. Eligibility rule (who can be penalized for not answering)

Reused verbatim from the existing correct/incorrect eligibility rule, not invented separately: a player is eligible for a question's no-answer penalty if and only if they have a `player_question_layouts` row for that occurrence (i.e., the question was actually offered to them — either because they were in the game when it opened, or they joined mid-question and `joinGame`/`enrollParticipantInGame` gave them a layout for the currently-open occurrence) **and** they are not currently removed (`players.removed_at IS NULL`, re-checked at settle time, not just at layout-creation time). This means:

- A player kicked *after* the question opened but *before* it closes is excluded from the no-answer penalty for that question (re-checked at settle time), even though they had a layout.
- A player who joins mid-question and is offered that question is eligible for the no-answer penalty on it — identical to how they'd be scored if they *had* answered it.
- A player who joined after the question already closed, or who was never in the game, is never considered at all (no layout row exists for them).

## 6. Idempotency

No new idempotency mechanism was needed. `closeGame()`'s existing guard — `if (g.state !== "question_open" || !g.active_occurrence_id) return false` — already makes question finalization single-flight: a second `close()` call (host double-click, timer racing a host action, or any other caller) throws `409 invalid_state` and never re-enters `settleAnswers()`. Since the no-answer pass lives *inside* `settleAnswers()`, it inherits this guarantee automatically, and is additionally self-idempotent even in isolation: its `NOT EXISTS` check means a hypothetical second invocation would find zero remaining unanswered players (rows now exist for all of them) and do nothing. Verified by `tests/no-answer-scoring.test.ts`'s "does not double-penalize" case, which explicitly closes twice and confirms the score is unchanged and the second call throws.

## 7. First-answer behavior (unchanged, confirmed instant)

`answer()`'s core accept path is untouched. The web page's click handler still submits the very first answer immediately — optimistic UI update, then a fire-and-forget POST to `/v1/player/answer`, no dialog, no second click. This was explicitly re-verified rather than assumed: see `tests/answer-change.test.ts`'s "accepts a first answer immediately" case and `tests/client-logic.test.ts`'s `decideChoiceClick` coverage, which asserts the decision is `"submit"` (not `"confirm"`) whenever no answer has been submitted yet.

## 8. Answer-change confirmation behavior

The web page (`server/public/app.js`) no longer disables choice buttons once an answer is submitted. Clicking a **different** answer than the one currently submitted now opens an in-page confirmation modal (`renderChangeConfirm()`, styled via new CSS in `server/public/app.css`, no `alert()`/browser-default dialog — the existing template-literal/CSS convention was matched since no modal component previously existed):

> **Change your answer?**
> You already submitted an answer. Changing it will replace your current answer and reset your response-time bonus to the time of the new answer.
> [Keep Current Answer] [Change Answer]

- Clicking **Keep Current Answer** or dismissing the modal changes nothing — no request is sent, the original answer and its timing remain authoritative.
- Clicking **Change Answer** sends the new answer to the server exactly as a first answer would.
- Clicking the **same** answer that's already submitted is a silent no-op — no modal, no request, no timestamp change.
- All of this decision logic lives in a small, dependency-free module, `server/public/client-logic.js` (`decideChoiceClick`, `isQuestionExpired`, `revealStandingsTitle`), extracted specifically so it can be unit-tested without a browser/DOM — see `tests/client-logic.test.ts`.

## 9. Backend answer-change authority

`Scoring.allowAnswerChange` no longer gates anything in `answer()` — the `if (prior && !scoring.allowAnswerChange) this.fail(409, "answer_locked", ...)` check was removed. Answer changes are now an unconditional, always-on server capability while a question remains open; the field itself is kept in the `Scoring` interface/type and in `TriviaScoringRequest`/`ScoringRequest` on the VenueOS and legacy-plugin sides purely for backward compatibility with already-persisted `scoring_json` blobs and existing request shapes — it is simply no longer read for this decision. (It was never exposed as an operator-configurable setting in either host client, and no existing test asserted the old `answer_locked` rejection behavior, so removing the gate is a pure behavior fix with no compatibility break.) The only server-enforced boundary on a change is the same one that already gated the very first answer: `g.state === "question_open"` and the occurrence must match the currently active one.

## 10. Timestamp replacement behavior

Unchanged from the code that already existed for the (previously unreachable) change path — confirmed correct, not rewritten: a confirmed change **deletes** the player's prior `player_answers` row for the occurrence and **inserts** a brand-new row with a fresh `receipt_order` and `received_at = now()` (server clock, never a client-supplied value), and `elapsed_ms` computed from `occurrence.opened_at` to this new acceptance moment. The old answer's timestamp is never reused or blended into the new one.

## 11. Time-left/speed-bonus recalculation

Also unchanged, and exercised by new tests rather than modified: `settleAnswers()`'s time bonus formula (`floor(remaining_seconds * timeBonusMultiplier)`) already reads `received_at` off whichever `player_answers` row exists for the player at close time — since a change fully replaces that row, the bonus is automatically computed from the **latest confirmed answer's** timestamp, never the original fast submission. `tests/answer-change.test.ts` proves the specific exploit scenario is closed: answering instantly, then changing to a different answer near the deadline, scores using the late timestamp — the fast time bonus from the original answer is not preserved either direction (wrong→correct or correct→wrong).

## 12. Deadline/race handling

No new deadline logic was added. The existing `scheduleClose()` server-side timer (armed on `open()`, cleared/re-armed on any close, and rehydrated on process boot for any game left `question_open`) is the single source of truth for when a question stops accepting answers or changes — `answer()`'s `g.state !== "question_open"` check rejects both a first answer and a change identically once that timer (or a host action) has fired. `tests/answer-change.test.ts` covers both a timer-expiry rejection and a host-triggered-close rejection. The web page adds an equivalent client-side guard (`isQuestionExpired`, disabling buttons and dismissing any open confirmation modal once the countdown reaches zero) purely as UX polish — the server never trusts it.

## 13. Series Answer Reveal — root cause and fix

**Root cause:** `server/public/app.js`, `resultSection()` (the per-question Answer Reveal screen), previously read:

```js
const primary = state.seriesId
  ? renderLeaderboard("Series standings", result.seriesStandings, state.player.displayName)
  : renderLeaderboard("Standings", result.leaderboard, state.player.displayName);
```

Whenever the current game belonged to a Series, this discarded `result.leaderboard` (the correct, already-computed current-game standings) and showed `result.seriesStandings` (the cumulative total) instead. The server-side computation (`leaderboardForGame()`, `seriesStandings()`, and their embedding in `playerState()`'s "results" branch, `service.ts`) was already correct and unchanged by this fix — this was purely a client-side either/or choice discarding one of two already-correct fields.

**Fix:** the reveal screen now always renders `result.leaderboard`:

```js
const primary = renderLeaderboard(revealStandingsTitle(state.seriesId), result.leaderboard, state.player.displayName);
```

`revealStandingsTitle()` (`server/public/client-logic.js`) only affects the **label** — "Game standings" inside a Series (to disambiguate from the separately-shown Series total elsewhere) versus plain "Standings" for a standalone game — never which data set is shown. `result.seriesStandings` is simply not read at this screen anymore; it is still present on the payload and still used at `series_lobby` and at game/series completion.

## 14. End-of-game standings behavior (preserved)

`gameCompleteSection()` (`server/public/app.js`) was **not modified** — it already, correctly, renders both "Final game standings" (`r.standings`) and "Series standings" (`r.seriesStandings`) side by side when a game inside a Series ends. This dual display at game completion (and at series completion, and at the series lobby before the first game starts) is intentional and unaffected by this pass. Only the per-question reveal was ever wrong.

## 15. API/realtime contract changes

- `POST /v1/player/answer` response shape changed from `{ accepted: true, locked: boolean }` to `{ accepted: true, changed: boolean }` — `locked` was a static reflection of the now-removed `allowAnswerChange` gate and had zero consumers (confirmed by repo-wide search across `server/`, `plugin/`, and `editor/`); `changed` more usefully indicates whether this request replaced a prior answer. No client currently reads this response at all — the web page only awaits it for error handling.
- No other request/response/WebSocket message shapes changed. `TriviaHostGameState`, `TriviaQuestionResult`/`TriviaCloseResult`, `TriviaGameCompleteResult`, `TriviaSeriesCompleteResult`, `TriviaSeriesState`, and the WebSocket `player.state` push all keep their existing fields.

## 16. Persistence/schema changes

One additive schema migration (`server/src/db.ts`, migration 10 of what is now 10): `player_answers.answer_id` changes from `TEXT NOT NULL` to `TEXT` (nullable), via the same create-copy-drop-rename rebuild pattern already used by two earlier migrations in this file. A `NULL answer_id` is what distinguishes "player never answered" from "player answered incorrectly" (`answer_id` set, `is_correct = 0`) everywhere this table is read — no new column was needed, since this single nullable field is already sufficient and every existing read site (`playerState()`'s `selectedAnswer` resolution) already handles a missing/undefined answer gracefully. The migration was verified against the existing pre-Phase-2-database upgrade test (`tests/migration.test.ts`), which still passes unmodified.

## 17. Backend tests added

New files, all passing:

- `server/tests/no-answer-scoring.test.ts` (7 tests) — configured penalty applied equally to wrong-answer and no-answer, `incorrectPoints: 0` yields 0, negative `incorrectPoints` applies equally, double-close does not double-penalize, a kicked-before-close player is excluded, a mid-question joiner who then doesn't answer IS penalized, the player's own reveal payload distinguishes "no answer" from "wrong answer" while scoring both identically, and the penalty applies correctly and rolls up inside a Series game.
- `server/tests/answer-change.test.ts` (6 tests) — instant first answer, a confirmed change fully replaces the prior answer and its timing basis (closing the exact fast-then-late exploit described in the task), wrong→correct and repeated A→B→C changes score only the final answer at its own timestamp, and both timer-expiry and host-triggered-close correctly reject a change attempt.
- `server/tests/series-reveal.test.ts` (3 tests) — pins the server contract the reveal fix depends on: Game 1 of a Series has `leaderboard`/`seriesStandings` coincide, Game 2 of a Series has them legitimately **diverge** (the exact bug scenario), and a standalone game's `seriesStandings` is `null`.
- `server/tests/client-logic.test.ts` (10 tests) — pure unit coverage of `isQuestionExpired`, `decideChoiceClick` (submit/confirm/ignore decisions, including the same-answer no-op and post-expiry lock), and `revealStandingsTitle`.

Total: 57/57 tests pass (31 pre-existing + 26 new), `tsc --noEmit` clean, `node --check public/app.js` clean, `question-set-schema` validation unaffected.

## 18. Web/frontend tests

No new frontend test framework was introduced (none existed; `server/package.json` has no browser test runner). Per the "isolate pure state logic" guidance, the actual click/confirm/expiry decision logic was extracted out of the DOM-touching `app.js` into a small, side-effect-free module, `server/public/client-logic.js`, specifically so it could be unit-tested directly under the existing Vitest/Node setup with zero DOM dependency (`server/tests/client-logic.test.ts`, 10 tests, listed above). The DOM-wiring parts of `app.js` itself (button click listeners, modal rendering, countdown timer, WebSocket/reconnect flow) still require manual browser QA — see §20 below.

## 19. VenueOS tests

None added or needed. VenueOS's Trivia module never calls `/v1/player/answer` and never renders a "Standings" field ambiguously — its `MairsTriviaOperatorPanel` already reads `game.Leaderboard` (game-scoped) for the reveal moment and `series.Standings` (series-scoped) for the separate Series card, confirmed by prior investigation before any code was touched. No VenueOS DTO changed shape as a result of this pass (the one API response shape that changed, `/v1/player/answer`'s return value, is never consumed by VenueOS). VenueOS's full existing test suite (1092 tests) was re-run as a byproduct of this pass's other repo's validation and passes unchanged.

## 20. Exact test/build results

```
cd server && npm test              → 15 test files, 57 tests, all passed
cd server && npm run build         → tsc --noEmit, no errors
cd server && npm run validate:browser → node --check public/app.js, no errors
cd server && npm run validate:schema  → 2 tests, passed
```

## 21. Live QA required

**No-answer penalty:** configure a visible incorrect-answer score (e.g. `-100`) on a game with at least two players; have one player answer wrong and one player let the timer expire on the same question; confirm both receive exactly `-100` and standings update correctly; let a second question expire unanswered and confirm the penalty is still applied exactly once (not accumulating from a stray double-close).

**Answer change:** open a question with enough time to test; click Answer A (confirm it submits instantly, no dialog); click a different Answer B while time remains (confirm the modal appears); click Keep Current Answer (confirm A remains authoritative, no request sent); click B again and confirm Change Answer (confirm B becomes authoritative); verify the score/time bonus reflects B's later confirmation time, not A's original fast submission; repeat for a wrong→correct and a correct→wrong change; finally, open the confirmation dialog, let the timer hit zero, and attempt to confirm — the change must be rejected and the UI must reconcile to the reveal screen rather than accepting a late answer.

**Series reveal:** run a two-game Series with score patterns different enough between games that current-game and series totals are visibly distinguishable; during Game 2's per-question Answer Reveal, confirm the standings shown are Game 2's alone, not the Series cumulative; at Game 2's completion, confirm both Game 2 standings and Series standings are shown together as before.

## 22. Files changed (this repository)

- `server/src/db.ts` — new migration (player_answers.answer_id nullable)
- `server/src/service.ts` — no-answer scoring pass in `settleAnswers()`; removed `allowAnswerChange` gate and changed `answer()`'s return shape in `answer()`
- `server/public/app.js` — answer-change confirmation UX, expiry guard, always-current-game-standings reveal fix; now imports `client-logic.js`
- `server/public/client-logic.js` — new, pure decision-logic module
- `server/public/app.css` — new modal styling
- `server/tsconfig.json` — `allowJs` + include the new pure JS module so it type-checks under the test project
- `server/tests/no-answer-scoring.test.ts`, `server/tests/answer-change.test.ts`, `server/tests/series-reveal.test.ts`, `server/tests/client-logic.test.ts` — new test files
- `docs/GAMEPLAY-HARDENING.md` — this document

## 23. Confirmation

No release action of any kind was taken in this repository: nothing was staged, committed, pushed, tagged, released, or deployed, and no database migration was applied against Render or any non-local database (the migration only exists in `server/src/db.ts`'s in-process migration list, applied automatically to whatever local/test database the process opens, exactly like every other migration in that file). `git status` for this repository at the end of this pass is reported in the top-level response to the user.
