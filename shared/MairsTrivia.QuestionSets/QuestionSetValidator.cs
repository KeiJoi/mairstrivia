namespace MairsTrivia.QuestionSets;

public sealed record ValidationIssue(string Path, string Message);
public static class QuestionSetValidator
{
    public static IReadOnlyList<ValidationIssue> Validate(QuestionSet? set)
    {
        var issues = new List<ValidationIssue>();
        if (set is null) return [new("$", "A question set is required.")];
        if (set.Format != QuestionSetFormat.Identifier) issues.Add(new("format", "Unsupported format identifier."));
        if (set.SchemaVersion != QuestionSetFormat.SchemaVersion) issues.Add(new("schemaVersion", "Unsupported schema version."));
        if (set.Id == Guid.Empty) issues.Add(new("id", "A stable set UUID is required."));
        Required(set.Title, "title", issues); Required(set.Author, "author", issues); Required(set.Version, "version", issues);
        DuplicateValues(set.Categories, "categories", issues); DuplicateValues(set.Tags, "tags", issues);
        var ids = new HashSet<Guid>();
        for (var i = 0; i < set.Questions.Count; i++)
        {
            var q = set.Questions[i]; var path = $"questions[{i}]";
            if (q.Id == Guid.Empty) issues.Add(new($"{path}.id", "A question UUID is required."));
            else if (!ids.Add(q.Id)) issues.Add(new($"{path}.id", "Question IDs must be unique."));
            Required(q.Question, $"{path}.question", issues); Required(q.CorrectAnswer, $"{path}.correctAnswer", issues);
            if (q.IncorrectAnswers.Count != 9) issues.Add(new($"{path}.incorrectAnswers", "Exactly 9 incorrect answers are required."));
            foreach (var (answer, answerIndex) in q.IncorrectAnswers.Select((x, n) => (x, n))) Required(answer, $"{path}.incorrectAnswers[{answerIndex}]", issues);
            var answers = new[] { q.CorrectAnswer }.Concat(q.IncorrectAnswers).Select(x => x.Trim()).ToList();
            if (answers.Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Count() != answers.Count(x => x.Length > 0)) issues.Add(new(path, "Correct and incorrect answer text must be distinct."));
            if (q.Category is { } category) Required(category, $"{path}.category", issues); DuplicateValues(q.Tags, $"{path}.tags", issues);
        }
        return issues;
    }
    private static void Required(string? value, string path, List<ValidationIssue> issues) { if (string.IsNullOrWhiteSpace(value)) issues.Add(new(path, "A non-empty value is required.")); }
    private static void DuplicateValues(IEnumerable<string> values, string path, List<ValidationIssue> issues) { var all = values.ToList(); if (all.Any(string.IsNullOrWhiteSpace)) issues.Add(new(path, "Values cannot be blank.")); if (all.Select(x => x.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Count() != all.Count) issues.Add(new(path, "Values must be unique.")); }
}
