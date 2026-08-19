using Dalamud.Bindings.ImGui;
using Dalamud.Interface.Windowing;
using MairsTrivia.Plugin.Api;
using MairsTrivia.QuestionSets;
using System.Numerics;

namespace MairsTrivia.Plugin.Windows;

public sealed class MainWindow : Window, IDisposable
{
    private readonly Plugin plugin;
    private string serverPassword = "", userPassword = "", status = "Disconnected", venue = "", gameName = "", search = "", category = "", tag = "", importPath = "", newSetTitle = "Untitled Question Set";
    private TriviaApiClient? api;
    private string? accessToken;
    private HostGameState? game;
    private TriviaQuestion? previewQuestion;
    private Guid? selectedSet, selectedQuestion;
    private QuestionSet? editingSet;

    public MainWindow(Plugin plugin) : base("Mair's Trivia###MairsTrivia")
    {
        this.plugin = plugin;
        SizeConstraints = new WindowSizeConstraints { MinimumSize = new Vector2(700, 500), MaximumSize = new Vector2(1200, 1000) };
    }

    public override void Draw()
    {
        ImGui.PushStyleColor(ImGuiCol.Button, new Vector4(1f, .329f, 0, 1));
        ImGui.PushStyleColor(ImGuiCol.Header, new Vector4(1f, .169f, .839f, .55f));
        if (ImGui.BeginTabBar("tabs"))
        {
            if (ImGui.BeginTabItem("Game")) { DrawGame(); ImGui.EndTabItem(); }
            if (ImGui.BeginTabItem("Players")) { DrawPlayers(); ImGui.EndTabItem(); }
            if (ImGui.BeginTabItem("Questions")) { DrawQuestions(); ImGui.EndTabItem(); }
            if (ImGui.BeginTabItem("Question Sets")) { DrawSets(); ImGui.EndTabItem(); }
            if (ImGui.BeginTabItem("Scoring")) { DrawScoring(); ImGui.EndTabItem(); }
            if (ImGui.BeginTabItem("Settings")) { DrawSettings(); ImGui.EndTabItem(); }
            ImGui.EndTabBar();
        }
        ImGui.PopStyleColor(2);
    }

    private void DrawSettings()
    {
        var backend = plugin.Configuration.BackendUrl;
        var username = plugin.Configuration.Username;
        Input("Backend URL", ref backend);
        Input("Server Password", ref serverPassword, true);
        Input("Username", ref username);
        plugin.Configuration.BackendUrl = backend;
        plugin.Configuration.Username = username;
        plugin.Configuration.Save();
        Input("User Password", ref userPassword, true);
        ImGui.TextDisabled("Usernames are 3-64 letters, numbers, ., _, or -. Your account password has no length or complexity restrictions.");
        ImGui.TextDisabled("Passwords are used only for this connection and are not saved in plugin configuration.");
        ImGui.TextColored(new Vector4(1f, .17f, .84f, 1f), status);
        if (ImGui.Button("Connect / Login")) _ = Authenticate(false);
        ImGui.SameLine();
        if (ImGui.Button("Create Host Account")) _ = Authenticate(true);
    }

    private async Task Authenticate(bool register)
    {
        try
        {
            api?.Dispose();
            var url = new Uri(plugin.Configuration.BackendUrl);
            if (url.Scheme is not "https" and not "http") throw new Exception("Backend URL must be HTTP(S).");
            if (string.IsNullOrWhiteSpace(serverPassword)) throw new Exception("Enter the server access password.");
            if (string.IsNullOrWhiteSpace(plugin.Configuration.Username)) throw new Exception("Enter a username.");
            api = new TriviaApiClient(url);
            var health = await api.GetAsync<HealthResponse>("/health", null, CancellationToken.None);
            await api.PostAsync<object>("/v1/access/validate", new { }, null, serverPassword, CancellationToken.None);
            var path = register ? "/v1/auth/register" : "/v1/auth/login";
            var login = await api.PostAsync<LoginResponse>(path, new { username = plugin.Configuration.Username, password = userPassword }, null, serverPassword, CancellationToken.None);
            accessToken = login.AccessToken;
            plugin.Configuration.RefreshToken = login.RefreshToken;
            plugin.Configuration.Save();
            await api.GetAsync<HostProfile>("/v1/me", accessToken, CancellationToken.None);
            status = $"Connected as {login.User.Username} ({health.Service})";
        }
        catch (Exception ex) { status = ex.Message; }
    }

    private void DrawGame()
    {
        ImGui.Text("Create or manage a host game");
        Input("Venue Name", ref venue);
        Input("Game Name", ref gameName);
        ImGui.Text("Question set: " + (editingSet?.Title ?? "Select one in Question Sets"));
        if (ImGui.RadioButton("In Order", plugin.Configuration.CompactUi)) plugin.Configuration.CompactUi = true;
        ImGui.SameLine();
        if (ImGui.RadioButton("Shuffle Once", !plugin.Configuration.CompactUi)) plugin.Configuration.CompactUi = false;
        if (ImGui.Button("Create Game")) _ = CreateGame();
        if (game is not null)
        {
            ImGui.Separator();
            ImGui.Text($"{game.VenueName} — {game.GameName}");
            ImGui.Text($"Join code: {game.JoinCode}");
            ImGui.TextWrapped($"Player URL: {game.PlayerUrl}");
            if (ImGui.Button("Copy Link")) ImGui.SetClipboardText(game.PlayerUrl);
            ImGui.Text($"State: {game.State}");
        }
    }

    private async Task CreateGame()
    {
        try
        {
            if (api is null || accessToken is null) throw new Exception("Connect first.");
            if (string.IsNullOrWhiteSpace(venue) || string.IsNullOrWhiteSpace(gameName) || selectedSet is null) throw new Exception("Venue Name, Game Name, and question set are required.");
            var set = plugin.Library.Load(selectedSet.Value);
            var issues = QuestionSetValidator.Validate(set);
            if (issues.Count > 0) throw new QuestionSetFormatException("Question set cannot start a game:\n" + string.Join("\n", issues.Take(12).Select(issue => $"{issue.Path}: {issue.Message}")));
            game = await api.PostAsync<HostGameState>("/v1/games", new CreateGameRequest(venue, gameName, set, plugin.Configuration.CompactUi ? "inOrder" : "shuffleOnce", new(plugin.Configuration.CorrectPoints, plugin.Configuration.IncorrectPoints, plugin.Configuration.FirstCorrectBonus)), accessToken, null, CancellationToken.None);
            status = "Game created.";
        }
        catch (Exception ex) { status = ex.Message; }
    }

    private void DrawPlayers()
    {
        if (game is null) { ImGui.TextDisabled("Create or resume a game first."); return; }
        ImGui.Text($"Players: {game.Players.Count}");
        foreach (var p in game.Players) ImGui.BulletText($"{p.DisplayName}: {p.Score} points — ✓ {p.CorrectCount} / ✗ {p.IncorrectCount}");
    }

    private void DrawQuestions()
    {
        if (game is null) { ImGui.TextDisabled("No active game."); return; }
        ImGui.Text("Preview is host-only; the backend sends players only opaque choices.");
        if (ImGui.Button("Preview Next")) _ = PreviewNext(); ImGui.SameLine();
        if (ImGui.Button("Send Question")) _ = Command("questions/open"); ImGui.SameLine();
        if (ImGui.Button("Skip Question")) _ = Command("questions/skip"); ImGui.SameLine();
        if (ImGui.Button("Close / Results")) _ = Command("questions/close"); ImGui.SameLine();
        if (ImGui.Button("End Game")) _ = Command("end");
        if (previewQuestion is not null)
        {
            ImGui.Separator();
            ImGui.TextWrapped(previewQuestion.Question);
            ImGui.TextColored(new Vector4(.45f, .89f, .55f, 1f), $"Correct: {previewQuestion.CorrectAnswer}");
            ImGui.Text($"Incorrect answers available: {previewQuestion.IncorrectAnswers.Count} / 9");
        }
        ImGui.Text("First correct responder and answer order are determined by the backend.");
    }

    private async Task PreviewNext()
    {
        try
        {
            if (api is null || accessToken is null || game is null) throw new Exception("No connected game.");
            previewQuestion = await api.PostAsync<TriviaQuestion>($"/v1/games/{game.Id}/questions/preview", new { }, accessToken, null, CancellationToken.None);
            game = await api.GetAsync<HostGameState>($"/v1/games/{game.Id}", accessToken, CancellationToken.None);
            status = "Question previewed. Send it, skip it, or return to Questions later.";
        }
        catch (Exception ex) { status = ex.Message; }
    }

    private async Task Command(string suffix)
    {
        try
        {
            if (api is null || accessToken is null || game is null) throw new Exception("No connected game.");
            await api.PostAsync<object>($"/v1/games/{game.Id}/" + suffix, new { }, accessToken, null, CancellationToken.None);
            game = await api.GetAsync<HostGameState>($"/v1/games/{game.Id}", accessToken, CancellationToken.None);
            if (suffix is "questions/open" or "questions/skip" or "questions/close" or "end") previewQuestion = null;
            status = "Command sent.";
        }
        catch (Exception ex) { status = ex.Message; }
    }

    private void DrawSets()
    {
        Input("Search", ref search); Input("Category filter", ref category); Input("Tag filter", ref tag);
        Input("Import file path", ref importPath);
        if (ImGui.Button("Import .fftrivia"))
        {
            try { SelectSet(plugin.Library.Import(importPath)); status = $"Imported and copied: {editingSet!.Title}"; }
            catch (Exception ex) { status = ex.Message; }
        }
        ImGui.SameLine();
        Input("New set title", ref newSetTitle);
        if (ImGui.Button("Create Set"))
        {
            try { SelectSet(plugin.Library.Create(newSetTitle)); status = "Created a new draft. Add questions below, then save the valid set."; }
            catch (Exception ex) { status = ex.Message; }
        }

        Guid? deleteId = null;
        foreach (var entry in plugin.Library.Search(search, category, tag).ToList())
        {
            var selected = selectedSet == entry.Id;
            if (ImGui.Selectable($"{entry.Title}##{entry.Id}", selected))
            {
                try { SelectSet(plugin.Library.Load(entry.Id)); status = editingSet!.Description; }
                catch (Exception ex) { status = ex.Message; }
            }
            ImGui.SameLine();
            if (game is not null && ImGui.SmallButton("Use##" + entry.Id)) _ = UseSet(entry.Id);
            ImGui.SameLine();
            if (ImGui.SmallButton("Delete##" + entry.Id)) deleteId = entry.Id;
        }
        if (deleteId is { } id)
        {
            try
            {
                DeleteSet(id);
            }
            catch (Exception ex) { status = ex.Message; }
        }

        if (editingSet is not null) DrawSetEditor(editingSet);
        ImGui.TextWrapped(status);
    }

    private void DrawSetEditor(QuestionSet set)
    {
        ImGui.Separator();
        ImGui.Text($"Editing: {set.Title}");
        var title = set.Title; Input("Title", ref title, maxLength: 256); set.Title = title;
        var description = set.Description; Input("Description", ref description, maxLength: 2048); set.Description = description;
        var author = set.Author; Input("Author", ref author, maxLength: 256); set.Author = author;
        var version = set.Version; Input("Set version", ref version, maxLength: 64); set.Version = version;
        var categories = string.Join(", ", set.Categories); Input("Set categories (comma-separated)", ref categories, maxLength: 1024); set.Categories = ParseList(categories);
        var tagsValue = string.Join(", ", set.Tags); Input("Set tags (comma-separated)", ref tagsValue, maxLength: 1024); set.Tags = ParseList(tagsValue);
        if (ImGui.Button("Save Draft"))
        {
            try { plugin.Library.SaveDraft(set); status = "Draft saved. Use Validate and Save Set when every question is complete."; }
            catch (Exception ex) { status = ex.Message; }
        }
        ImGui.SameLine();
        if (ImGui.Button("Validate and Save Set")) SaveValidSet(set);
        ImGui.SameLine();
        if (ImGui.Button("Delete This Question Set")) { DeleteSet(set.Id); return; }
        ImGui.SameLine();
        if (ImGui.Button("Add Question"))
        {
            var question = new TriviaQuestion();
            set.Questions.Add(question);
            selectedQuestion = question.Id;
            status = "Question added. Complete the question, correct answer, and all 9 incorrect answers.";
        }
        ImGui.SameLine();
        ImGui.Text($"Questions: {set.Questions.Count}");

        var issues = QuestionSetValidator.Validate(set);
        if (issues.Count > 0)
        {
            ImGui.TextColored(new Vector4(1f, .17f, .84f, 1f), $"Cannot start a game yet: {issues.Count} validation issue(s).");
            foreach (var issue in issues.Take(3)) ImGui.TextWrapped($"• {issue.Path}: {issue.Message}");
        }

        if (set.Questions.Count == 0) { ImGui.TextDisabled("Add a question to begin. A valid question set needs each question to have 1 correct and exactly 9 incorrect answers."); return; }
        ImGui.Separator();
        foreach (var (question, index) in set.Questions.Select((value, index) => (value, index)).ToList())
        {
            var label = string.IsNullOrWhiteSpace(question.Question) ? $"Question {index + 1} (incomplete)" : $"Question {index + 1}: {question.Question}";
            if (ImGui.Selectable(label + "##" + question.Id, selectedQuestion == question.Id)) selectedQuestion = question.Id;
        }

        var active = set.Questions.SingleOrDefault(x => x.Id == selectedQuestion) ?? set.Questions[0];
        selectedQuestion = active.Id;
        DrawQuestionEditor(set, active);
    }

    private void DrawQuestionEditor(QuestionSet set, TriviaQuestion question)
    {
        ImGui.Separator();
        ImGui.Text($"Question editor — {question.Id}");
        var questionText = question.Question; Input("Question text", ref questionText, maxLength: 4096); question.Question = questionText;
        var correctAnswer = question.CorrectAnswer; Input("Correct answer", ref correctAnswer, maxLength: 1024); question.CorrectAnswer = correctAnswer;
        var questionCategory = question.Category ?? "";
        Input("Question category", ref questionCategory, maxLength: 256);
        question.Category = string.IsNullOrWhiteSpace(questionCategory) ? null : questionCategory;
        var tagsValue = string.Join(", ", question.Tags); Input("Question tags (comma-separated)", ref tagsValue, maxLength: 1024); question.Tags = ParseList(tagsValue);
        NormalizeIncorrectAnswers(question);
        ImGui.TextColored(new Vector4(1f, .329f, 0, 1), $"{question.IncorrectAnswers.Count(x => !string.IsNullOrWhiteSpace(x))} / 9 incorrect answers");
        for (var i = 0; i < 9; i++)
        {
            var incorrectAnswer = question.IncorrectAnswers[i];
            Input($"Incorrect answer {i + 1}", ref incorrectAnswer, maxLength: 1024);
            question.IncorrectAnswers[i] = incorrectAnswer;
        }

        var index = set.Questions.IndexOf(question);
        if (ImGui.Button("Duplicate Question"))
        {
            var copy = question.Copy(); set.Questions.Insert(index + 1, copy); selectedQuestion = copy.Id; status = "Question duplicated.";
        }
        ImGui.SameLine();
        if (ImGui.Button("Delete Question"))
        {
            set.Questions.Remove(question); selectedQuestion = set.Questions.FirstOrDefault()?.Id; status = "Question removed. Save the set to persist this change."; return;
        }
        ImGui.SameLine();
        if (ImGui.Button("Move Up") && index > 0) { set.Questions.RemoveAt(index); set.Questions.Insert(index - 1, question); }
        ImGui.SameLine();
        if (ImGui.Button("Move Down") && index < set.Questions.Count - 1) { set.Questions.RemoveAt(index); set.Questions.Insert(index + 1, question); }
    }

    private void SaveValidSet(QuestionSet set)
    {
        try { plugin.Library.Save(set); status = "Question set validated and saved."; }
        catch (Exception ex) { status = ex.Message; }
    }

    private void DeleteSet(Guid id)
    {
        try
        {
            var deleted = plugin.Library.Delete(id);
            if (selectedSet == id) { selectedSet = null; selectedQuestion = null; editingSet = null; }
            status = deleted ? "Question set deleted." : "Question set was already removed.";
        }
        catch (Exception ex)
        {
            Plugin.Log.Error(ex, "Failed to delete local question set {QuestionSetId}", id);
            status = $"Could not delete question set: {ex.Message}";
        }
    }

    private async Task UseSet(Guid setId)
    {
        try
        {
            if (api is null || accessToken is null || game is null) throw new Exception("No connected game.");
            var set = plugin.Library.Load(setId);
            var added = await api.PostAsync<QuestionSetAddResponse>($"/v1/games/{game.Id}/question-sets", new QuestionSetAddRequest(set, plugin.Configuration.CompactUi ? "inOrder" : "shuffleOnce"), accessToken, null, CancellationToken.None);
            game = await api.PostAsync<HostGameState>($"/v1/games/{game.Id}/question-sets/{added.GameSetId}/select", new { }, accessToken, null, CancellationToken.None);
            SelectSet(set);
            previewQuestion = null;
            status = added.Reused ? $"Selected existing game copy of {set.Title}." : $"Added and selected {set.Title}.";
        }
        catch (Exception ex) { status = ex.Message; }
    }

    private void SelectSet(QuestionSet set)
    {
        editingSet = set;
        selectedSet = set.Id;
        selectedQuestion = set.Questions.FirstOrDefault()?.Id;
    }

    private static void NormalizeIncorrectAnswers(TriviaQuestion question)
    {
        question.IncorrectAnswers ??= [];
        while (question.IncorrectAnswers.Count < 9) question.IncorrectAnswers.Add("");
        if (question.IncorrectAnswers.Count > 9) question.IncorrectAnswers = question.IncorrectAnswers.Take(9).ToList();
    }

    private static List<string> ParseList(string value) => value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    private void DrawScoring()
    {
        var correct = plugin.Configuration.CorrectPoints; var incorrect = plugin.Configuration.IncorrectPoints; var first = plugin.Configuration.FirstCorrectBonus;
        if (ImGui.InputInt("Correct points", ref correct)) plugin.Configuration.CorrectPoints = correct;
        if (ImGui.InputInt("Incorrect points", ref incorrect)) plugin.Configuration.IncorrectPoints = incorrect;
        if (ImGui.InputInt("First-correct bonus", ref first)) plugin.Configuration.FirstCorrectBonus = first;
        plugin.Configuration.Save();
    }

    private static void Input(string label, ref string value, bool password = false, int maxLength = 256) => ImGui.InputText(label, ref value, maxLength, password ? ImGuiInputTextFlags.Password : ImGuiInputTextFlags.None);
    public void Dispose() => api?.Dispose();
}
