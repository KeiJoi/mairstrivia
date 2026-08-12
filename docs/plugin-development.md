# Dalamud plugin development

The Mair's Trivia host plugin targets the current official SamplePlugin convention: `Dalamud.NET.Sdk/15.0.0`, .NET 10, and Dalamud API level 15. It uses `IDalamudPlugin`, `WindowSystem`, plugin-service injection, and the `/mairstrivia` slash command. Release packaging follows the SDK’s normal output/manifest convention; `MairsTrivia.json` sits beside the plugin DLL.

The plugin’s only network code is `Api/TriviaApiClient.cs`. It creates complete backend-only HTTP requests before `SendAsync`; it does not hook, inspect, intercept, modify, or generate Final Fantasy XIV traffic. Its stored refresh credential is revocable; raw host and server passwords remain in memory only.

Question-set imports are validated against the shared .NET `.fftrivia` contract and copied to the plugin configuration directory under `question-sets/`. Consequently, imports survive restarts and do not depend on their original file.
