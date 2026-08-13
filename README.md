# Mair's Trivia

Mair's Trivia is a host-operated trivia platform for Final Fantasy XIV venues. It has three clients around one authoritative Node.js game service:

- `server/` — API, WebSocket game engine, SQLite persistence, and browser player app.
- `editor/` — standalone C# Question Set Editor.
- `plugin/` — Dalamud host/admin plugin.

The platform shares the versioned `.fftrivia` JSON format defined in [docs/question-set-format.md](docs/question-set-format.md). Architecture and protocol decisions are intentional contracts, not UI specifications; see [docs/architecture.md](docs/architecture.md), [docs/protocol.md](docs/protocol.md), [docs/authentication.md](docs/authentication.md), and [docs/time-format.md](docs/time-format.md).

## Status

The backend, player site, editor, and Dalamud host plugin are implemented. Deployment and release instructions are in [docs/SETUP-SERVER.md](docs/SETUP-SERVER.md) and [docs/RELEASING.md](docs/RELEASING.md).

## Development

Prerequisites: Node.js 24 LTS and .NET SDKs required by the editor/plugin. The Dalamud project additionally requires current Dalamud development dependencies.

```powershell
cd server
npm install
npm run validate:schema
```

Never commit secrets. Copy `server/.env.example` to a local `.env` and set a strong `SERVER_ACCESS_PASSWORD`.
