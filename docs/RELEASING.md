# Releasing Mair's Trivia

## Version strategy

Application releases use semantic Git tags such as `v1.0.0`. The editor installer and Dalamud plugin share that release version, while the plugin assembly has four components (`1.0.0.0`). The `.fftrivia` `schemaVersion` is independently versioned and only changes for incompatible question-file changes. The backend protocol is independently versioned (`v1` today); it changes only for incompatible API/WebSocket changes.

## Create a release

1. Choose the next semantic version and update the changelog/release notes.
2. Run `npm run build` and `npm test` from `server/`, then run `dotnet test tests/MairsTrivia.QuestionSets.Tests/MairsTrivia.QuestionSets.Tests.csproj --configuration Release`.
3. Commit all changes, create an annotated tag such as `git tag -a v1.0.0 -m "Mair's Trivia v1.0.0"`, and push it: `git push origin v1.0.0`.
4. Monitor the **Release** GitHub Actions workflow. It validates the tag, tests, publishes the editor, invokes Inno Setup, and consumes the Dalamud SDK-generated `latest.zip` package.
5. Verify the GitHub Release includes `MairsTrivia-v1.0.0.zip`, `MairsTrivia-Editor-Setup-v1.0.0.exe`, `MairsTrivia-Editor-v1.0.0.zip`, and checksums.
6. Verify the release workflow updated `pluginmaster.json`: its version, API level, Unix-seconds `LastUpdate`, and both download links must point at the public release ZIP.

## Dalamud custom repository

Use this stable URL in **Dalamud Settings → Experimental → Custom Plugin Repositories**:

`https://raw.githubusercontent.com/KeiJoi/mairstrivia/main/pluginmaster.json`

This raw public-branch URL is deliberate: it remains unchanged across releases and requires no GitHub Pages configuration. Test it in a private/incognito browser window after release, then install/update Mair's Trivia through Dalamud and confirm the downloaded plugin opens with `/mairstrivia`.

## Release checks

Install the editor setup executable on a clean Windows profile, open/save a `.fftrivia` file, and verify the file association. Inspect the plugin ZIP without altering it—the archive must be the SDK/packager-produced layout, containing the generated plugin manifest beside the DLL. Verify the GitHub Release asset URL in `pluginmaster.json` downloads that same archive without authentication.
