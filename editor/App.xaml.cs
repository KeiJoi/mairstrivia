using System.Windows;
namespace MairsTrivia.Editor; public partial class App : Application { protected override void OnStartup(StartupEventArgs e) { base.OnStartup(e); new MainWindow().Show(); } }
