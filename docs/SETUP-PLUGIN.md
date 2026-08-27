# Set up the Dalamud plugin

1. Install and launch XIVLauncher with Dalamud enabled, if you have not already.
2. Open Dalamud Settings, then open **Experimental**.
3. Find **Custom Plugin Repositories** and add this URL:

   `https://raw.githubusercontent.com/KeiJoi/mairstrivia/main/pluginmaster.json`

4. Save/apply the settings and open **Plugin Installer**.
5. Find **Mair's Trivia** and install it. Adding the custom repository only makes the plugin available; it does not install it automatically.
6. Open the plugin through Plugin Installer or type `/mairstrivia`.
7. Open the final **Settings** tab. Enter the public HTTPS backend URL, the server access password configured for the server, a username, and a user password. For a first-time host, select **Create Host Account**; usernames are 3-64 characters, while account passwords have no length or complexity restrictions. For an existing account, select **Connect / Login**. The plugin always shows the saved backend, username, session availability, and current connection status there. It stores a revocable refresh session and automatically reconnects when opened; use **Reconnect Now** if needed. The plugin does not save either password.
8. In **Question Sets**, import a valid `.fftrivia` file or create a local set. Select a set to edit its metadata and questions. Add each question's text, one correct answer, and all nine incorrect answers; use **Save Draft** while working and **Validate and Save Set** before using it in a game. Imported files are copied into plugin storage and remain after FFXIV restarts. The **Delete** control removes the selected local set and its stored file.
9. In **Game**, enter a required Venue Name and Game Name, choose a question set and scoring, then choose **In Order** or **Shuffle Once** and create the game.
10. Give players the displayed join URL/code. Preview a question privately, skip it if unwanted, or send it to players. Close it for results, change question sets between questions, and end the game when finished.

The plugin uses the configured trivia backend only. It never intercepts or modifies FFXIV network traffic.
