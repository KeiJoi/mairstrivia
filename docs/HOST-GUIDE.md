# Host guide

## Before players arrive

Open `/mairstrivia`, connect to your backend, and log in. In Question Sets, choose the set you want to use. In Game, enter the required **Venue Name** and **Game Name**, choose scoring, select the set, choose a **Question time limit** from 0–15 seconds, and create the game. `0` means no limit and the host closes the question manually; a positive limit closes it automatically and shows players a countdown. Share the displayed player URL or join code.

**In Order** uses questions in their stored order. **Shuffle Once** creates one random queue for the game and consumes it without repeats; skipping does not reshuffle the remaining questions.

## Run the game

Use **Preview Next** to inspect the next question privately, including its correct answer, nine incorrect answers, category, and tags. It is not shown to players. Select **Skip Question** to record it as skipped and move on, or **Send Question** to open it.

Players receive the same question text but independently generated four-answer layouts: one correct answer and three selected incorrect answers in randomized order. The backend—not the plugin—records answer receipt order, correctness, scores, and the first correct responder.

Use **Players** to monitor the scoreboard, correct and incorrect totals, and participant count. Close the question to show results according to backend policy. Do not change the question set while answers are open.

## Change themes and finish

Between questions—in lobby, preview, or results—select another question set to change themes. The same game keeps its Venue Name, Game Name, players, scores, correct/incorrect totals, history, and skipped questions. Returning to a previously used set resumes its unused queue.

Temporary player and plugin disconnections can reconnect through the backend; player identity, assigned active-question layout, score, and statistics are retained. When the event is over, close any open question and select **End Game**.
