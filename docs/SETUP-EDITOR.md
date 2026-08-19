# Set up the Question Set Editor

1. Open [GitHub Releases](https://github.com/KeiJoi/mairstrivia/releases) and download `MairsTrivia-Editor-Setup-vX.Y.Z.exe` for the version you want.
2. Run the installer and choose whether to create a desktop shortcut. It installs **Mair's Trivia Question Set Editor** and registers `.fftrivia` files for the current user.
3. Open the editor and select **New**. Fill in title, description, author, version, categories, and tags.
4. Add questions. Every new (schema v2) question has exactly one correct answer and three to nine non-empty, distinct incorrect answers. The editor visibly tracks the `3–9` requirement. Existing schema v1 files retain their `9 / 9` requirement until you choose **Upgrade to Schema v2**.
5. Add optional per-question category and tags. Use search and category/tag filters to manage larger sets.
6. Select **Validate** before saving. Invalid sets cannot be saved or exported.
7. Use **Save**, **Save As**, or **Export** to create a `.fftrivia` file. In the plugin’s **Question Sets** tab, import that file; the plugin copies it into its own persistent library.
