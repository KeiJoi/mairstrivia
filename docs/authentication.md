# Authentication

## Server access credential

`SERVER_ACCESS_PASSWORD` is a deployment secret configured in the server environment. A client proves knowledge of it at `POST /v1/access/validate` before login/registration flows. The server stores no plaintext value and does not expose it in configuration, logs, responses, or source control. Passing this check grants no host privileges.

## Host account and session

Host accounts contain a stable UUID, unique username, Argon2id password hash, and UTC creation timestamp. `POST /v1/auth/login` accepts the server credential proof and account credentials, then returns a short-lived signed access token and renewable session/refresh credential. Raw host passwords are never reused as API credentials. `GET /v1/me` requires the access token.

Tokens identify a single host user. Every host route loads the requested game and compares `game.ownerUserId` with the authenticated token subject before returning or mutating anything. List routes are filtered by owner at the query layer. Socket authentication follows the same token verification and owner checks.

## Player identity

Joining creates a game-scoped player UUID and reconnect credential. This credential may only retrieve that player's own layout and player-visible state. It cannot invoke host operations or reveal answers/correctness.
