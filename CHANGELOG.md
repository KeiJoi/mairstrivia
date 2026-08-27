# Changelog

## 1.2.0 - 2026-08-27

- Stabilize player answer controls while the timer is counting down.
- Refresh the host player list automatically as players join from the web link.
- Extend question limits to 20 seconds and add opt-in cumulative scoring across games.
- Make local question-set deletion resilient to stale library entries.

## 1.1.2 - 2026-08-23

- Assign active-question layouts to players who join while a question is open.
- Record answers immediately but award scores and statistics only when the question is revealed.

## 1.1.1 - 2026-08-19

- Add a per-game question time limit from 0–15 seconds.
- Automatically close timed questions server-side and show the player countdown.

## 1.1.0 - 2026-08-18

- Add `.fftrivia` schema v2, allowing three to nine unique, non-empty incorrect answers per question.
- Preserve legacy schema v1 support and its exactly-nine-answer requirement.
- Add schema-v2 migration and variable incorrect-answer controls to the editor and Dalamud plugin.

## 1.0.4 - 2026-08-18

- Add a dedicated question-set delete action and report deletion failures visibly.
- Show local question-set validation errors before creating a game instead of returning a generic backend error.

## 1.0.3 - 2026-08-18

- Fix live player updates, answer-selection feedback, and player results after a question closes.
- Show host question previews and correctly attach/select a question set for an existing game.
- Strengthen local question-set deletion, including stale duplicate configuration entries.

## 1.0.2 - 2026-08-18

- Add a complete in-plugin question-set editor, including metadata, questions, answers, tags, categories, duplication, reordering, draft saves, validation, and reliable deletion.
- Remove host-account password length and complexity restrictions.

## 1.0.1 - 2026-08-12

- Add in-plugin host-account registration from the Settings tab.

## 1.0.0 - 2026-08-12

Initial production release of Mair's Trivia.

- Node.js SQLite trivia backend and browser player experience.
- Windows Question Set Editor with `.fftrivia` validation and installer source.
- Dalamud API 15 host plugin and custom repository manifest.
- Render Blueprint deployment and release automation.
