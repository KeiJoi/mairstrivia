# Architecture

## System boundary

The Node.js service is the authoritative game engine. The player browser is an untrusted presentation client; the Dalamud plugin and Question Set Editor are trusted only to the extent of their authenticated user, and the server still validates every host action. SQLite is the initial persistence store.

```text
Editor -- .fftrivia --> Plugin -- HTTPS/WSS --> Node.js service <-- HTTPS/WSS -- Player browser
                              |                    |
                              +-- local imports     +-- SQLite
```

The editor and plugin share the `.fftrivia` JSON contract and validate it before save/export/import. Imported plugin sets are copied into plugin-local storage and remain available after the source file disappears.

## Ownership and authority

The server password permits access to a deployment; it never grants administrator or host authority. A host account owns every game through `ownerUserId`. Server-side ownership checks protect all host-management routes and sockets. Players receive only the public game state and their private answer layout.

## Game model

A game has immutable identity (`id`, venue name, game name, owner), players, score totals, history, scoring settings, and one or more game-specific question-set queues. A queue is either stored source order or a single stored shuffle. Queue entries have `unused`, `previewed`, `skipped`, `asked`, or `completed` state. Switching sets retains the queue and all game/player statistics. A host cannot switch sets while the active question accepts answers.

On opening a question, the server selects three distinct incorrect answers plus the correct answer for each player, shuffles those four choices, assigns opaque IDs, and persists the layout. It sends no correctness metadata. Reconnection reuses the persisted layout. The server records receipt order and decides correctness from its mapping.

## Networking

Production connections use HTTPS and WSS. REST is used for authentication, account/game management, question-set upload, and recoverable snapshots. WebSocket messages provide game commands and state updates after token authentication. The plugin has one API client; it completely constructs URL, method, headers, credentials, and serialized body before `SendAsync`, and never intercepts or alters FFXIV traffic.

## Scale and resilience

The normal target is 20–30 players, but application code has no player-count ceiling. A player has a stable reconnect credential scoped to a game. The host plugin reconnects with an authenticated snapshot/resubscription flow. Server receipt ordering, not client timestamps or clocks, settles answer ordering.

## Shared visual language

Primary orange is `#FF5400`; neon pink accent is `#FF2BD6`; backgrounds are near-black with light primary text. Correctness is conveyed with explicit words/icons in addition to colour.
