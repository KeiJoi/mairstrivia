using System.Text.Json;
using System.Text.Json.Serialization;

namespace MairsTrivia.QuestionSets;

public static class QuestionSetSerializer
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public static string Serialize(QuestionSet set) => JsonSerializer.Serialize(set, Options);
    public static QuestionSet Deserialize(string text)
    {
        try { return JsonSerializer.Deserialize<QuestionSet>(text, Options) ?? throw new QuestionSetFormatException("The file is empty."); }
        catch (JsonException ex) { throw new QuestionSetFormatException("The file is not valid JSON.", ex); }
    }
    public static QuestionSet Load(string path) => Deserialize(File.ReadAllText(path));
    public static void Save(string path, QuestionSet set) => File.WriteAllText(path, Serialize(set));
}
public sealed class QuestionSetFormatException(string message, Exception? inner = null) : Exception(message, inner);
