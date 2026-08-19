# `.fftrivia` question-set format

`.fftrivia` files are UTF-8 JSON validated against [`schemas/fftrivia-question-set.schema.json`](../schemas/fftrivia-question-set.schema.json). The current `format` is `fftrivia-question-set` and `schemaVersion` is `2`. Readers support legacy schema version `1` and current version `2`, and reject other versions rather than guessing.

Each set has stable UUID `id`, title, description, author, semantic-style version text, categories, tags, and questions. Question and set IDs are UUIDs. A schema v2 question has exactly one `correctAnswer` and three to nine unique `incorrectAnswers`; every answer string must be non-empty and distinct after trimming. Schema v1 remains valid only with exactly nine incorrect answers. Categories and tags are optional metadata but, when present, are arrays of non-empty strings.

The editor and plugin must validate the schema plus the trimming/distinctness rule before save, export, or import. Invalid sets are not persisted as valid exports. JSON is the internal interchange format; no binary format is authoritative.

Minimal example:

```json
{
  "format": "fftrivia-question-set",
  "schemaVersion": 2,
  "id": "1d968d2e-1d78-42be-82fe-3a2654be3660",
  "title": "Example set",
  "description": "An example.",
  "author": "Kei Joi",
  "version": "1.0.0",
  "categories": ["General"],
  "tags": ["example"],
  "questions": [{
    "id": "a409f176-7e28-45e8-84db-fab34c9efea5",
    "question": "Which answer is correct?",
    "correctAnswer": "Correct",
    "incorrectAnswers": ["Wrong 1", "Wrong 2", "Wrong 3"],
    "category": "General",
    "tags": ["example"]
  }]
}
```
