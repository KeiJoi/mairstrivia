using MairsTrivia.QuestionSets;

namespace MairsTrivia.Plugin;
public sealed class QuestionSetLibrary
{
    private readonly string directory; private readonly Configuration config;
    public QuestionSetLibrary(string directory, Configuration config) { this.directory = directory; this.config = config; Directory.CreateDirectory(directory); }
    public IReadOnlyList<QuestionSetLibraryEntry> Search(string search, string category, string tag) => config.QuestionSets.Where(e => (string.IsNullOrWhiteSpace(search) || $"{e.Title} {e.Description} {string.Join(' ',e.Tags)}".Contains(search, StringComparison.OrdinalIgnoreCase)) && (string.IsNullOrWhiteSpace(category) || e.Categories.Contains(category, StringComparer.OrdinalIgnoreCase)) && (string.IsNullOrWhiteSpace(tag) || e.Tags.Contains(tag, StringComparer.OrdinalIgnoreCase))).ToList();
    public QuestionSet Import(string externalPath) { var set=QuestionSetSerializer.Load(externalPath); RequireValid(set); var name=$"{set.Id}{QuestionSetFormat.Extension}"; QuestionSetSerializer.Save(Path.Combine(directory,name),set); Upsert(set,name); return set; }
    public QuestionSet Create(string title) { var set=new QuestionSet { Title=title }; SaveDraft(set); return set; }
    public QuestionSet Load(Guid id) { var e=config.QuestionSets.Single(x=>x.Id==id); return QuestionSetSerializer.Load(Path.Combine(directory,e.FileName)); }
    public void Save(QuestionSet set) { RequireValid(set); var e=config.QuestionSets.SingleOrDefault(x=>x.Id==set.Id); var name=e?.FileName??$"{set.Id}{QuestionSetFormat.Extension}"; QuestionSetSerializer.Save(Path.Combine(directory,name),set); Upsert(set,name); }
    public void SaveDraft(QuestionSet set) { RequireValidMetadata(set); var e=config.QuestionSets.SingleOrDefault(x=>x.Id==set.Id); var name=e?.FileName??$"{set.Id}{QuestionSetFormat.Extension}"; QuestionSetSerializer.Save(Path.Combine(directory,name),set); Upsert(set,name); }
    public void Delete(Guid id) { var e=config.QuestionSets.SingleOrDefault(x=>x.Id==id); if(e is null) return; var path=Path.Combine(directory,e.FileName); if(File.Exists(path)) File.Delete(path); config.QuestionSets.Remove(e); config.Save(); }
    private static void RequireValidMetadata(QuestionSet set) { if(set.Id==Guid.Empty||string.IsNullOrWhiteSpace(set.Title)) throw new QuestionSetFormatException("Question set title and ID are required."); }
    private static void RequireValid(QuestionSet set) { var issues=QuestionSetValidator.Validate(set); if(issues.Count>0) throw new QuestionSetFormatException(string.Join("\n",issues.Select(x=>$"{x.Path}: {x.Message}"))); }
    private void Upsert(QuestionSet set,string file) { var entry=config.QuestionSets.SingleOrDefault(x=>x.Id==set.Id); if(entry is null){entry=new();config.QuestionSets.Add(entry);} entry.Id=set.Id;entry.FileName=file;entry.Title=set.Title;entry.Description=set.Description;entry.Categories=[..set.Categories];entry.Tags=[..set.Tags];config.Save(); }
}
