# Time format contract

All timestamps crossing component boundaries are UTC ISO 8601/RFC 3339 strings with a literal `Z`, for example `2026-08-12T18:36:42.381Z`.

- Node.js normalizes all boundary timestamps with `new Date().toISOString()` and SQLite stores this canonical text form.
- C# request/response models use `DateTimeOffset`; they serialize/parse UTC values only.
- Local time conversion belongs exclusively to a UI display layer.
- Player/browser clocks are never authoritative. The server's receipt order decides answer order and first-answer results.
- The server uses monotonic elapsed timing where practical for durations, while UTC wall-clock timestamps provide history and audit records.
- Automated integration coverage runs UTC serialization under `America/Chicago` and `Asia/Tokyo`; both must produce the identical `Z`-suffixed boundary value.
