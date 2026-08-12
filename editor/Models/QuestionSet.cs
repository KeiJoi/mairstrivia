namespace MairsTrivia.Editor.Models;

public sealed record QuestionSet(
    string Format, int SchemaVersion, Guid Id, string Title, string Description,
    string Author, string Version, IReadOnlyList<string> Categories,
    IReadOnlyList<string> Tags, IReadOnlyList<TriviaQuestion> Questions);

public sealed record TriviaQuestion(
    Guid Id, string Question, string CorrectAnswer, IReadOnlyList<string> IncorrectAnswers,
    string? Category, IReadOnlyList<string> Tags);
