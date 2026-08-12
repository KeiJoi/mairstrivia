# Protocol contract

Base paths are `/v1` over HTTPS. Current protocol version is `1`; WebSocket clients send `protocolVersion: 1` in their first frame and unsupported versions receive `unsupported_protocol`. All JSON fields use camelCase. Error bodies are `{ "error": { "code": "...", "message": "..." } }`. Timestamps follow the [time contract](time-format.md).

## Bootstrap REST endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | Service liveness/version. |
| POST | `/access/validate` | server credential | Validate deployment access without granting host authority. |
| POST | `/auth/register` | server credential | Create a host account. |
| POST | `/auth/login` | server credential | Issue access/session credentials. |
| POST | `/auth/refresh` | refresh credential | Renew an access token. |
| GET | `/me` | host bearer token | Return the authenticated host profile. |
| `/games…` | host bearer token | Create/list/read/control only the caller's games. |

Server-credential proof is passed in a dedicated request header over TLS and must not be logged. Host credentials are `Authorization: Bearer <access-token>`.

## Game and player REST endpoints

`POST /games` requires venue name, game name, a valid question set, ordering mode (`inOrder` or `shuffleOnce`), and optional scoring. It returns the internal ID, join code, player URL, and host state. Hosts use `POST /games/:gameId/question-sets`, `/question-sets/:setId/select`, `/questions/preview`, `/questions/skip`, `/questions/open`, `/questions/close`, and `/end` for lifecycle commands.

Players call `POST /player/join` with a join code/display name, retain the returned reconnect credential locally, call `/player/reconnect` after a refresh, and send only `{ reconnectToken, questionId, answerId }` to `/player/answer`. The player state contains only four opaque `{ id, text }` choices while a question is open.

## WebSocket

Connect at `wss://host/v1/ws`. The first client frame must be `{ "type": "authenticate", "accessToken": "…" }` for a host or a player reconnect credential in the appropriate field. No game state is sent until the server replies with `authenticated`. Authentication failure closes the connection with a policy error.

Host commands include `game.subscribe`, `question.preview`, `question.send`, `question.skip`, and `questionSet.select`. The server rejects ownership violations, invalid state transitions, and selection while answers are open. Player commands include `player.join`, `player.reconnect`, and `answer.submit`, which carries only `{ gameId, answerId }`.

Player choice messages contain only opaque `{ id, text }` answers. They never contain correctness flags, correct answer IDs, or hidden equivalent metadata. Server state messages distinguish public/player/host projections so that host-only scoring and private player layouts cannot leak.
