# Mair's Trivia

Mair's Trivia is a host-operated trivia platform for Final Fantasy XIV venues. It has three clients around one authoritative Node.js game service:

- `server/` — API, WebSocket game engine, SQLite persistence, and browser player app.
- `editor/` — standalone C# Question Set Editor.
- `plugin/` — Dalamud host/admin plugin.

The platform shares the versioned `.fftrivia` JSON format defined in [docs/question-set-format.md](docs/question-set-format.md). Architecture and protocol decisions are intentional contracts, not UI specifications; see [docs/architecture.md](docs/architecture.md), [docs/protocol.md](docs/protocol.md), [docs/authentication.md](docs/authentication.md), and [docs/time-format.md](docs/time-format.md).

## Status

This is the Stage 1 foundation: repository layout, contracts, validation schema, and application skeletons. Large UI and gameplay implementations are deliberately deferred.

## Development

Prerequisites: Node.js 22+ and .NET 8 SDK. The Dalamud project additionally requires Dalamud development dependencies configured by a plugin developer.

```powershell
cd server
npm install
npm run validate:schema
```

Never commit secrets. Copy `server/.env.example` to a local `.env` and set a strong `SERVER_ACCESS_PASSWORD`.
