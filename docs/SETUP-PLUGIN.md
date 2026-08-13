# Set up the Dalamud plugin

1. Install and launch XIVLauncher with Dalamud enabled, if you have not already.
2. Open Dalamud Settings, then open **Experimental**.
3. Find **Custom Plugin Repositories** and add this URL:

   `https://raw.githubusercontent.com/KeiJoi/mairstrivia/main/pluginmaster.json`

4. Save/apply the settings and open **Plugin Installer**.
5. Find **Mair's Trivia** and install it. Adding the custom repository only makes the plugin available; it does not install it automatically.
6. Open the plugin through Plugin Installer or type `/mairstrivia`.
7. In **Settings**, enter the public HTTPS backend URL, server password, username, and user password, then select **Connect / Login**. Create a host account on the backend if you do not have one.
8. In **Question Sets**, import a valid `.fftrivia` file or create a local set. Imported files are copied into plugin storage and remain after FFXIV restarts.
9. In **Game**, enter a required Venue Name and Game Name, choose a question set and scoring, then choose **In Order** or **Shuffle Once** and create the game.
10. Give players the displayed join URL/code. Preview a question privately, skip it if unwanted, or send it to players. Close it for results, change question sets between questions, and end the game when finished.

The plugin uses the configured trivia backend only. It never intercepts or modifies FFXIV network traffic.
