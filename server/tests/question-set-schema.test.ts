import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import schema from "../../schemas/fftrivia-question-set.schema.json" with { type: "json" };

describe(".fftrivia schema", () => {
  const ajv = new Ajv2020({
    strict: true,
    formats: { uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i },
  });
  const validate = ajv.compile(schema);

  it("accepts a complete question set", () => {
    const set = { format: "fftrivia-question-set", schemaVersion: 1, id: "1d968d2e-1d78-42be-82fe-3a2654be3660", title: "Set", description: "", author: "Kei Joi", version: "1.0.0", categories: [], tags: [], questions: [{ id: "a409f176-7e28-45e8-84db-fab34c9efea5", question: "Question?", correctAnswer: "Correct", incorrectAnswers: ["1", "2", "3", "4", "5", "6", "7", "8", "9"], category: null, tags: [] }] };
    expect(validate(set)).toBe(true);
  });

  it("rejects a question without exactly nine incorrect answers", () => {
    const set = { format: "fftrivia-question-set", schemaVersion: 1, id: "1d968d2e-1d78-42be-82fe-3a2654be3660", title: "Set", description: "", author: "Kei Joi", version: "1.0.0", categories: [], tags: [], questions: [{ id: "a409f176-7e28-45e8-84db-fab34c9efea5", question: "Question?", correctAnswer: "Correct", incorrectAnswers: ["1"], category: null, tags: [] }] };
    expect(validate(set)).toBe(false);
  });
});
