export interface TriviaQuestion {
  id: string;
  question: string;
  correctAnswer: string;
  incorrectAnswers: [string, string, string, string, string, string, string, string, string];
  category: string | null;
  tags: string[];
}

export interface QuestionSet {
  format: "fftrivia-question-set";
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  author: string;
  version: string;
  categories: string[];
  tags: string[];
  questions: TriviaQuestion[];
}

/** Schema cannot express cross-field uniqueness after trimming, so enforce it here. */
export function hasValidAnswerSet(question: TriviaQuestion): boolean {
  const answers = [question.correctAnswer, ...question.incorrectAnswers].map((value) => value.trim());
  return answers.every(Boolean) && new Set(answers.map((value) => value.toLocaleLowerCase())).size === 10;
}
