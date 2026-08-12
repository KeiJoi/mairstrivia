using MairsTrivia.Editor.Models;

namespace MairsTrivia.Editor.Services;

public static class QuestionSetValidator
{
    public static IReadOnlyList<string> Validate(QuestionSet set) => set.Questions.SelectMany(Validate).ToList();

    public static IEnumerable<string> Validate(TriviaQuestion question)
    {
        var answers = new[] { question.CorrectAnswer }.Concat(question.IncorrectAnswers).Select(x => x.Trim()).ToArray();
        if (question.IncorrectAnswers.Count != 9) yield return $"{question.Id}: exactly nine incorrect answers are required.";
        if (answers.Any(string.IsNullOrWhiteSpace)) yield return $"{question.Id}: answers cannot be blank.";
        if (answers.Distinct(StringComparer.OrdinalIgnoreCase).Count() != answers.Length) yield return $"{question.Id}: answers must be distinct.";
    }
}
