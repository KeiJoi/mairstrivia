import { describe, expect, it } from "vitest";
import { decideChoiceClick, isQuestionExpired, revealStandingsTitle } from "../public/client-logic.js";

describe("player web page — pure click/confirmation decision logic", () => {
  describe("isQuestionExpired", () => {
    it("is false with no deadline (untimed question)", () => expect(isQuestionExpired(null)).toBe(false));
    it("is false before the deadline", () => expect(isQuestionExpired("2026-01-01T00:00:10.000Z", Date.parse("2026-01-01T00:00:05.000Z"))).toBe(false));
    it("is true at or after the deadline", () => {
      expect(isQuestionExpired("2026-01-01T00:00:10.000Z", Date.parse("2026-01-01T00:00:10.000Z"))).toBe(true);
      expect(isQuestionExpired("2026-01-01T00:00:10.000Z", Date.parse("2026-01-01T00:00:11.000Z"))).toBe(true);
    });
  });

  describe("decideChoiceClick", () => {
    it("submits instantly when no answer has been submitted yet", () => {
      expect(decideChoiceClick({ answerSubmitted: false, selectedAnswerId: null }, "B", false)).toBe("submit");
    });
    it("asks for confirmation when a DIFFERENT answer is already submitted", () => {
      expect(decideChoiceClick({ answerSubmitted: true, selectedAnswerId: "A" }, "B", false)).toBe("confirm");
    });
    it("is a no-op when the SAME already-submitted answer is clicked again", () => {
      expect(decideChoiceClick({ answerSubmitted: true, selectedAnswerId: "A" }, "A", false)).toBe("ignore");
    });
    it("is a no-op once the question has expired, even for a first answer", () => {
      expect(decideChoiceClick({ answerSubmitted: false, selectedAnswerId: null }, "A", true)).toBe("ignore");
    });
    it("is a no-op once the question has expired, even for a would-be change", () => {
      expect(decideChoiceClick({ answerSubmitted: true, selectedAnswerId: "A" }, "B", true)).toBe("ignore");
    });
  });

  describe("revealStandingsTitle", () => {
    it("is plain 'Standings' for a standalone game", () => expect(revealStandingsTitle(null)).toBe("Standings"));
    it("is 'Game standings' inside a Series, to disambiguate from the separately-shown Series total", () => expect(revealStandingsTitle("series-1")).toBe("Game standings"));
  });
});
