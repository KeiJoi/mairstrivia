import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { QuestionSet } from "../src/shared/question-set.js";

const validSet: QuestionSet = {
  format: "fftrivia-question-set", schemaVersion: 1, id: "1d968d2e-1d78-42be-82fe-3a2654be3660", title: "Set", description: "", author: "Test", version: "1", categories: [], tags: [],
  questions: [{ id: "a409f176-7e28-45e8-84db-fab34c9efea5", question: "Question?", correctAnswer: "Correct", incorrectAnswers: ["1", "2", "3", "4", "5", "6", "7", "8", "9"], category: null, tags: [] }],
};

describe("player WebSocket updates", () => {
  it("pushes the open question and results without a browser refresh", async () => {
    const app = createApp({ databasePath: ":memory:", serverAccessPassword: "server-secret", tokenSecret: "token-secret", registrationEnabled: true, publicBaseUrl: "http://test" });
    await app.ready();
    try {
      const host = await app.trivia.register("websocket-host", "");
      const game = app.trivia.createGame(app.trivia.authenticate(host.accessToken), { venueName: "Venue", gameName: "Game", questionSet: validSet, orderingMode: "inOrder" });
      const player = app.trivia.join(game.joinCode, "Player");
      const socket = await app.injectWS("/v1/ws");
      const nextMessage = () => new Promise<any>(resolve => socket.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString()))));
      socket.send(JSON.stringify({ protocolVersion: 1, reconnectToken: player.reconnectToken }));
      await nextMessage();
      app.trivia.preview(app.trivia.authenticate(host.accessToken), game.id);
      const openedMessage = nextMessage();
      app.trivia.open(app.trivia.authenticate(host.accessToken), game.id);
      const opened = await openedMessage;
      expect(opened.game.question.choices).toHaveLength(4);
      expect(JSON.stringify(opened.game.question)).not.toMatch(/correct(answer|_answer)|isCorrect/i);
      const answer = opened.game.question.choices[0];
      const submittedMessage = nextMessage();
      app.trivia.answer(player.reconnectToken, opened.game.question.id, answer.id);
      await submittedMessage;
      const resultsMessage = nextMessage();
      app.trivia.close(app.trivia.authenticate(host.accessToken), game.id);
      const results = await resultsMessage;
      expect(results.game.state).toBe("results");
      expect(results.game.result.correctAnswer).toBe("Correct");
      socket.terminate();
    } finally { await app.close(); }
  });
});
