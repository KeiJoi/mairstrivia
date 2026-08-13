# Question-set guide

`.fftrivia` is Mair’s Trivia’s UTF-8 JSON interchange file. It is compatible with the editor, Dalamud plugin, and backend. See the formal [format contract](question-set-format.md) and JSON Schema for machine-readable details.

Every file declares its format identifier, schema version, stable UUID, title, description, author, version, categories, tags, and ordered questions. Readers reject unsupported schema versions rather than attempting to guess their meaning.

Every question must have one correct answer and exactly nine distinct, non-empty incorrect answers. Questions may have one category and any number of unique tags. Set-level categories/tags support library organization; question-level metadata supports searching and filtering.

Create or edit sets in the editor, validate them, then save/export `.fftrivia`. The plugin validates imports again and stores a copy locally. The backend validates sets submitted for a game; an authenticated host client is not trusted without validation.
