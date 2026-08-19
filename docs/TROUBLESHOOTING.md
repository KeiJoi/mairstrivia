# Troubleshooting

## Server and connection

**`/health` fails:** Verify the Render service is deployed, its URL uses HTTPS, and `https://YOUR-SERVICE/health` returns `status: "ok"`. Review Render logs for SQLite migration/startup errors.

**Bad backend URL or server password rejected:** Use the public HTTPS service URL without a trailing slash and the exact `SERVER_ACCESS_PASSWORD` configured in Render. The server password is separate from a host account password.

**Login fails or authentication expires:** Check username/password, then log in again. Refresh credentials are revocable; a redeploy with a changed `TOKEN_SECRET` invalidates sessions.

**Render disk or SQLite problem:** Confirm the paid service has its disk mounted at `/var/data` and `DATABASE_PATH=/var/data/trivia.sqlite`. Only that path persists. Do not scale a disk-backed SQLite service beyond one instance. Use Render disk snapshots/restores for recovery.

**WebSocket disconnect:** The player/browser and plugin reconnect automatically where practical. Check the backend’s HTTPS URL, network availability, and that the service is healthy. Reopen the plugin or refresh the player page if needed.

## Plugin installation

**Custom repository does not appear:** Confirm this exact URL is reachable in an unauthenticated browser: `https://raw.githubusercontent.com/KeiJoi/mairstrivia/main/pluginmaster.json`. Save Experimental settings, then reopen Plugin Installer.

**Plugin API/version mismatch:** Update Dalamud, then refresh Plugin Installer and install the release compatible with the current Dalamud API. The manifest currently targets API 15.

**Question sets are missing:** Imports are stored in the plugin configuration directory, not beside the original file. If the plugin configuration was deleted or moved, import the `.fftrivia` file again.

**Question-set import or editor validation fails:** Each set needs a supported schema version, stable UUIDs, non-empty title/author/version, and unique categories/tags. A schema v2 question requires one correct answer and three to nine distinct, non-empty incorrect answers. Legacy schema v1 files require exactly nine; upgrade the set to schema v2 before reducing the count.

## Time and play

**Time looks different on different computers:** API and stored timestamps are UTC with `Z`; each UI converts only for display. Browser clocks do not decide answer order or the first correct response.

**A player sees the wrong question or cannot answer:** Refresh/reconnect. The backend retains that player’s exact active-question choices and verifies opaque answer IDs server-side. A question must be open before answers are accepted.
