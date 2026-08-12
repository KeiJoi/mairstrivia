using Dalamud.Game.Command;
using Dalamud.Interface.Windowing;
using Dalamud.IoC;
using Dalamud.Plugin;
using Dalamud.Plugin.Services;
using MairsTrivia.Plugin.Windows;

namespace MairsTrivia.Plugin;
public sealed class Plugin : IDalamudPlugin
{
    [PluginService] internal static IDalamudPluginInterface PluginInterface { get; private set; } = null!;
    [PluginService] internal static ICommandManager CommandManager { get; private set; } = null!;
    [PluginService] internal static IPluginLog Log { get; private set; } = null!;
    public Configuration Configuration { get; } public QuestionSetLibrary Library { get; }
    private readonly WindowSystem windows = new("MairsTrivia"); private readonly MainWindow main;
    public Plugin(){Configuration=PluginInterface.GetPluginConfig() as Configuration??new();Library=new QuestionSetLibrary(Path.Combine(PluginInterface.GetPluginConfigDirectory(),"question-sets"),Configuration);main=new MainWindow(this);windows.AddWindow(main);CommandManager.AddHandler("/mairstrivia",new CommandInfo((_,_)=>main.Toggle()){HelpMessage="Open Mair's Trivia host controls."});PluginInterface.UiBuilder.Draw+=windows.Draw;PluginInterface.UiBuilder.OpenMainUi+=main.Toggle;PluginInterface.UiBuilder.OpenConfigUi+=main.Toggle;}
    public void Dispose(){PluginInterface.UiBuilder.Draw-=windows.Draw;PluginInterface.UiBuilder.OpenMainUi-=main.Toggle;PluginInterface.UiBuilder.OpenConfigUi-=main.Toggle;CommandManager.RemoveHandler("/mairstrivia");windows.RemoveAllWindows();main.Dispose();}
}
