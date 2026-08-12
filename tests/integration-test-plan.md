# Integration test plan

Stage 1 includes an executable `/health` contract test and schema validation. When authentication persistence is implemented, this suite must add executable tests for:

1. valid and invalid server-credential validation;
2. host login and token issuance without returning a password/hash;
3. authenticated `/me` and rejected missing/invalid tokens;
4. WebSocket first-frame authentication, rejection, and ownership isolation.

The test fixture uses an ephemeral SQLite database and distinct host accounts. It must verify a host cannot enumerate, inspect, resume, or mutate another host's game.
