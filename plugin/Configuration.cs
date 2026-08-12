using Dalamud.Configuration;
using Dalamud.Plugin;

namespace MairsTrivia.Plugin;
public sealed class Configuration : IPluginConfiguration
{
    public int Version { get; set; } = 1;
    public string BackendUrl { get; set; } = "https://";
    public string Username { get; set; } = "";
    public string? RefreshToken { get; set; }
    public bool CompactUi { get; set; }
    public int CorrectPoints { get; set; } = 100;
    public int IncorrectPoints { get; set; }
    public int FirstCorrectBonus { get; set; } = 50;
    public List<QuestionSetLibraryEntry> QuestionSets { get; set; } = [];
    public void Save() => Plugin.PluginInterface.SavePluginConfig(this);
}
public sealed class QuestionSetLibraryEntry { public Guid Id { get; set; } public string FileName { get; set; } = ""; public string Title { get; set; } = ""; public string Description { get; set; } = ""; public List<string> Categories { get; set; } = []; public List<string> Tags { get; set; } = []; }
