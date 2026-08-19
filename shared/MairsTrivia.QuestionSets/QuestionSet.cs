using System.Text.Json.Serialization;

namespace MairsTrivia.QuestionSets;

public sealed class QuestionSet
{
    [JsonPropertyName("format")] public string Format { get; set; } = QuestionSetFormat.Identifier;
    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; } = QuestionSetFormat.SchemaVersion;
    [JsonPropertyName("id")] public Guid Id { get; set; } = Guid.NewGuid();
    [JsonPropertyName("title")] public string Title { get; set; } = "Untitled Question Set";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("author")] public string Author { get; set; } = "Kei Joi";
    [JsonPropertyName("version")] public string Version { get; set; } = "1.0.0";
    [JsonPropertyName("categories")] public List<string> Categories { get; set; } = [];
    [JsonPropertyName("tags")] public List<string> Tags { get; set; } = [];
    [JsonPropertyName("questions")] public List<TriviaQuestion> Questions { get; set; } = [];
}

public sealed class TriviaQuestion
{
    [JsonPropertyName("id")] public Guid Id { get; set; } = Guid.NewGuid();
    [JsonPropertyName("question")] public string Question { get; set; } = "";
    [JsonPropertyName("correctAnswer")] public string CorrectAnswer { get; set; } = "";
    [JsonPropertyName("incorrectAnswers")] public List<string> IncorrectAnswers { get; set; } = Enumerable.Repeat("", QuestionSetFormat.MinimumIncorrectAnswers).ToList();
    [JsonPropertyName("category")] public string? Category { get; set; }
    [JsonPropertyName("tags")] public List<string> Tags { get; set; } = [];
    public TriviaQuestion Copy() => new() { Id = Guid.NewGuid(), Question = Question, CorrectAnswer = CorrectAnswer, IncorrectAnswers = [.. IncorrectAnswers], Category = Category, Tags = [.. Tags] };
}

public static class QuestionSetFormat { public const string Identifier = "fftrivia-question-set"; public const int LegacySchemaVersion = 1; public const int SchemaVersion = 2; public const int MinimumIncorrectAnswers = 3; public const int MaximumIncorrectAnswers = 9; public const string Extension = ".fftrivia"; public static bool SupportsSchemaVersion(int version) => version is LegacySchemaVersion or SchemaVersion; }
