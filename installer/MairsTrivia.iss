; Build with Inno Setup 6 after `dotnet publish editor/MairsTrivia.Editor.csproj -c Release -r win-x64 --self-contained true -o artifacts/editor`.
#define MyAppName "Mair's Trivia Question Set Editor"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Kei Joi"
#define MyAppExeName "MairsTrivia.Editor.exe"
[Setup]
AppId={{C59CB122-6C9D-4E8A-8194-0E9CC49A2E6F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\MairsTrivia
DefaultGroupName=Mair's Trivia
OutputDir=..\artifacts\installer
OutputBaseFilename=MairsTrivia-Editor-Setup-v{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#MyAppName}
[Files]
Source: "..\artifacts\editor\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
[Registry]
Root: HKCU; Subkey: "Software\Classes\.fftrivia"; ValueType: string; ValueData: "MairsTrivia.QuestionSet"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\MairsTrivia.QuestionSet"; ValueType: string; ValueData: "Mair's Trivia Question Set"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\MairsTrivia.QuestionSet\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Flags: uninsdeletekey
