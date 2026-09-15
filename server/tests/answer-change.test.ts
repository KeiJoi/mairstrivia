import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db.js";
import { ServiceError, TriviaService } from "../src/service.js";
import type { QuestionSet } from "../src/shared/question-set.js";

const qid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const set = (id: string): QuestionSet => ({ format: "fftrivia-question-set", schemaVersion: 2, id, title: "Set", description: "", author: "Test", version: "1", categories: [], tags: [], questions: [{ id: qid, question: "Q?", correctAnswer: "Right", incorrectAnswers: ["Wrong1", "Wrong2", "Wrong3"], category: null, tags: [] }] });

let service: TriviaService;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  service = new TriviaService(openDatabase(":memory:"), { databasePath: ":memory:", serverAccessPassword: "server-secret", tokenSecret: "token-secret", registrationEnabled: true, publicBaseUrl: "http://test" });
});
afterEach(() => vi.useRealTimers());
async function host(name: string) { return service.register(name, "a sufficiently strong password"); }

describe("answer changes — always permitted while open, authoritative timestamp is always the latest confirmed change", () => {
  it("accepts a first answer immediately with no special flag required", async () => {
    const h = await host("host-a"), owner = service.authenticate(h.accessToken);
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("bbbbbbbb-0000-4000-8000-000000000001"), orderingMode: "inOrder", questionTimeLimitSeconds: 20, scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false, timeBonusMultiplier: 5 } });
    const alice = service.join(game.joinCode, "Alice");
    service.preview(owner, game.id); service.open(owner, game.id);
    const question = service.playerReconnect(alice.reconnectToken).game.question as any;
    const right = question.choices.find((c: any) => c.text === "Right").id;
    const response = service.answer(alice.reconnectToken, qid, right);
    expect(response).toEqual({ accepted: true, changed: false });
  });

  it("replaces the prior answer and its scoring/timing basis entirely on a confirmed change (allowAnswerChange:false no longer blocks this)", async () => {
    const h = await host("host-b"), owner = service.authenticate(h.accessToken);
    // 20s question, multiplier 5: answering instantly (0s elapsed -> ~20s remaining) would bank ~100 time bonus.
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("cccccccc-0000-4000-8000-000000000001"), orderingMode: "inOrder", questionTimeLimitSeconds: 20, scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false, timeBonusMultiplier: 5 } });
    const alice = service.join(game.joinCode, "Alice");
    service.preview(owner, game.id); service.open(owner, game.id);
    const question = service.playerReconnect(alice.reconnectToken).game.question as any;
    const right = question.choices.find((c: any) => c.text === "Right").id;
    const wrong = question.choices.find((c: any) => c.text === "Wrong1").id;

    service.answer(alice.reconnectToken, qid, right); // instant first answer, banks near-max time bonus
    vi.advanceTimersByTime(18_000); // wait until 2s remain before changing
    const changeResponse = service.answer(alice.reconnectToken, qid, wrong);
    expect(changeResponse).toEqual({ accepted: true, changed: true });

    service.close(owner, game.id);
    const player = service.hostState(owner, game.id).players[0];
    // The exploit this prevents: banking Right's fast timestamp, then changing to Wrong (or vice versa) late must
    // NOT preserve the fast time bonus. Final answer is Wrong, scored as incorrect (0 base by default), not as a
    // fast-banked correct answer.
    expect(player.score).toBe(0);
    expect(player.correctCount).toBe(0);
    expect(player.incorrectCount).toBe(1);
  });

  it("scores a wrong-to-correct change using the NEW answer's timing, not the original fast submission", async () => {
    const h = await host("host-c"), owner = service.authenticate(h.accessToken);
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("dddddddd-0000-4000-8000-000000000001"), orderingMode: "inOrder", questionTimeLimitSeconds: 20, scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false, timeBonusMultiplier: 5 } });
    const alice = service.join(game.joinCode, "Alice");
    service.preview(owner, game.id); service.open(owner, game.id);
    const question = service.playerReconnect(alice.reconnectToken).game.question as any;
    const right = question.choices.find((c: any) => c.text === "Right").id;
    const wrong = question.choices.find((c: any) => c.text === "Wrong1").id;

    service.answer(alice.reconnectToken, qid, wrong); // wrong first answer, instantly
    vi.advanceTimersByTime(5_000); // 15s remaining when the change is confirmed
    service.answer(alice.reconnectToken, qid, right); // changes to correct with 15s left -> time bonus floor(15*5)=75
    service.close(owner, game.id);
    const player = service.hostState(owner, game.id).players[0];
    expect(player.score).toBe(175); // 100 base + 75 time bonus computed from the CHANGE moment
    expect(player.correctCount).toBe(1);
    expect(player.incorrectCount).toBe(0);
  });

  it("allows repeated changes (A -> B -> C), scoring only the final confirmed answer at its own timestamp", async () => {
    const h = await host("host-d"), owner = service.authenticate(h.accessToken);
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("eeeeeeee-0000-4000-8000-000000000001"), orderingMode: "inOrder", questionTimeLimitSeconds: 20, scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false, timeBonusMultiplier: 5 } });
    const alice = service.join(game.joinCode, "Alice");
    service.preview(owner, game.id); service.open(owner, game.id);
    const question = service.playerReconnect(alice.reconnectToken).game.question as any;
    const right = question.choices.find((c: any) => c.text === "Right").id;
    const wrong1 = question.choices.find((c: any) => c.text === "Wrong1").id;
    const wrong2 = question.choices.find((c: any) => c.text === "Wrong2").id;

    service.answer(alice.reconnectToken, qid, wrong1); // A
    vi.advanceTimersByTime(3_000);
    service.answer(alice.reconnectToken, qid, wrong2); // B
    vi.advanceTimersByTime(3_000);
    service.answer(alice.reconnectToken, qid, right); // C, 14s remaining -> time bonus floor(14*5)=70
    service.close(owner, game.id);
    const player = service.hostState(owner, game.id).players[0];
    expect(player.score).toBe(170); // 100 + 70, computed only from C's timing
    expect(player.correctCount).toBe(1); // only ONE final answer is ever scored, not one per change
    expect(player.incorrectCount).toBe(0);
  });

  it("rejects a change once the question has closed (timer expiry), never accepting a late answer", async () => {
    const h = await host("host-e"), owner = service.authenticate(h.accessToken);
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("ffffffff-0000-4000-8000-000000000001"), orderingMode: "inOrder", questionTimeLimitSeconds: 5, scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false, timeBonusMultiplier: 5 } });
    const alice = service.join(game.joinCode, "Alice");
    service.preview(owner, game.id); service.open(owner, game.id);
    const question = service.playerReconnect(alice.reconnectToken).game.question as any;
    const right = question.choices.find((c: any) => c.text === "Right").id;
    const wrong = question.choices.find((c: any) => c.text === "Wrong1").id;
    service.answer(alice.reconnectToken, qid, wrong);
    vi.advanceTimersByTime(9_000); // well past the 5s deadline; the server auto-close timer already fired
    expect(() => service.answer(alice.reconnectToken, qid, right)).toThrow(ServiceError);
    expect(service.hostState(owner, game.id).state).toBe("results");
    // The change attempt must not have altered anything: the original wrong answer stands, scored as incorrect.
    expect(service.hostState(owner, game.id).players[0].incorrectCount).toBe(1);
  });

  it("rejects a change once the host has manually closed the question", async () => {
    const h = await host("host-f"), owner = service.authenticate(h.accessToken);
    const game = service.createGame(owner, { venueName: "Venue", gameName: "Game", questionSet: set("11111111-0000-4000-8000-000000000001"), orderingMode: "inOrder", questionTimeLimitSeconds: 0, scoring: { correctPoints: 100, firstCorrectBonus: 0, allowAnswerChange: false } });
    const alice = service.join(game.joinCode, "Alice");
    service.preview(owner, game.id); service.open(owner, game.id);
    const question = service.playerReconnect(alice.reconnectToken).game.question as any;
    const right = question.choices.find((c: any) => c.text === "Right").id;
    const wrong = question.choices.find((c: any) => c.text === "Wrong1").id;
    service.answer(alice.reconnectToken, qid, wrong);
    service.close(owner, game.id); // host-triggered close, no timer involved
    expect(() => service.answer(alice.reconnectToken, qid, right)).toThrow(ServiceError);
  });
});
