const app = document.querySelector("#app");
const code = location.pathname.split("/").pop();
const storageKey = `mairs:${code}`;
let token = localStorage.getItem(storageKey);
let state, socket, reconnectTimer, countdownTimer;
let stateInitialized = false;
let removed = false;
let connectionIssue = false;
let notificationSoundEnabled = localStorage.getItem("mairs:notification-sound") !== "off";
const notificationSound = document.querySelector("#question-notification");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

const request = async (path, body) => {
  let response;
  try { response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch { const error = new Error("Could not reach the server. Check your connection and try again."); error.code = "network_error"; throw error; }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error?.message || "Request failed"); error.code = payload.error?.code; throw error; }
  return payload;
};

/** Rank 1-3 get medals to the LEFT of the name; every tied rank-1 (etc.) gets the same medal — this is intentional. */
function medalFor(rank) { return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null; }

function renderLeaderboard(title, entries, highlightName) {
  if (!entries?.length) return "";
  const rows = entries.map((entry) => {
    const medal = medalFor(entry.rank);
    const isSelf = highlightName && entry.displayName === highlightName;
    // answered = correct + incorrect, never a source-question-count denominator (late joiners/missed questions are not "behind").
    const answered = (entry.correctCount ?? 0) + (entry.incorrectCount ?? 0);
    const correctAnswered = answered > 0 ? `<span class="leaderboard-correct">${entry.correctCount ?? 0} / ${answered} correct</span>` : "";
    return `<li class="leaderboard-row${isSelf ? " self" : ""}"><span class="leaderboard-rank">${medal ? `<span class="medal" aria-hidden="true">${medal}</span>` : `#${entry.rank}`}</span><span class="leaderboard-name">${escapeHtml(entry.displayName)}</span>${correctAnswered}<span class="leaderboard-score">${entry.score}</span></li>`;
  }).join("");
  return `<section class="leaderboard-section"><h3>${escapeHtml(title)}</h3><ul class="leaderboard" role="list">${rows}</ul></section>`;
}

function renderPodium(title, winners) {
  if (!winners?.length) return "";
  const names = winners.map((w) => escapeHtml(w.displayName)).join(winners.length > 1 ? " & " : "");
  return `<div class="podium"><p class="podium-medal" aria-hidden="true">🥇</p><h2>${escapeHtml(title)}</h2><p class="podium-names">${names}</p></div>`;
}

function renderJoinForm() {
  return `<h1>Join trivia</h1><p class="muted">Enter your name to join this game.</p><form id="join"><input required maxlength="48" placeholder="Display name" aria-label="Display name" autocomplete="off"><button>Join game</button></form>`;
}

function renderRemoved() {
  return `<h1>You've been removed</h1><p class="muted">The host removed you from this game. If you think this was a mistake, ask the host to re-invite you.</p>`;
}

function renderConnectionIssue() {
  return `<h1>Connection problem</h1><p class="muted">We couldn't reach the server. Retrying automatically…</p>`;
}

function questionSection() {
  const q = state.question;
  const selected = q.selectedAnswerId;
  const locked = q.answerSubmitted ? " disabled" : "";
  return `<h2>Question</h2><p>${escapeHtml(q.question)}</p>${q.closesAt ? `<p class="muted">Time remaining: <span id="countdown"></span></p>` : ""}<p class="muted">Choose one answer:</p>${q.choices.map((choice) => `<button class="choice${selected === choice.id ? " selected" : ""}" data-id="${choice.id}"${locked}>${escapeHtml(choice.text)}</button>`).join("")}${q.answerSubmitted ? `<p class="muted">Answer submitted. Waiting for results…</p>` : ""}`;
}

function resultSection() {
  const result = state.result;
  const outcome = result.selectedAnswer === null ? "No answer submitted." : result.isCorrect ? "Correct!" : "Incorrect.";
  const breakdown = result.isCorrect
    ? `<ul class="score-breakdown"><li>Correct answer: +${result.basePoints}</li>${result.firstCorrectBonus ? `<li>First correct: +${result.firstCorrectBonus}</li>` : ""}${result.timeBonus ? `<li>Speed bonus: +${result.timeBonus}</li>` : ""}</ul>`
    : "";
  const primary = state.seriesId ? renderLeaderboard("Series standings", result.seriesStandings, state.player.displayName) : renderLeaderboard("Standings", result.leaderboard, state.player.displayName);
  return `<section class="result"><h2>Results</h2><p>${escapeHtml(result.question)}</p><p class="result-outcome ${result.isCorrect ? "correct" : "incorrect"}">${outcome}</p><p>Your answer: ${escapeHtml(result.selectedAnswer ?? "No answer")}</p><p>Correct answer: <strong>${escapeHtml(result.correctAnswer)}</strong></p><p>Points awarded: ${result.pointsAwarded}</p>${breakdown}</section>${primary}`;
}

function gameCompleteSection() {
  const r = state.gameResult;
  const podium = renderPodium(r.winners.length > 1 ? "Game winners (tied)" : "Game winner", r.winners);
  const gameStandings = renderLeaderboard("Final game standings", r.standings, state.player.displayName);
  if (!state.seriesId) return `<h1>Game Complete</h1>${podium}${gameStandings}<p class="muted">Thanks for playing!</p>`;
  const seriesStandings = renderLeaderboard("Series standings", r.seriesStandings, state.player.displayName);
  const waiting = r.waitingForNextGame ? `<p class="muted waiting-next">Waiting for the host to begin the next game…</p>` : "";
  return `<h1>Game Complete</h1>${podium}${gameStandings}${seriesStandings}${waiting}`;
}

function seriesCompleteSection() {
  const r = state.seriesResult;
  const podium = renderPodium(r.champions.length > 1 ? "Series Champions (tied)" : "Series Champion", r.champions);
  const standings = renderLeaderboard("Final series standings", r.standings, state.player.displayName);
  return `<h1>Trivia Series Complete</h1>${podium}${standings}`;
}

function render() {
  clearInterval(countdownTimer);
  if (removed) { app.innerHTML = renderRemoved(); return; }
  if (connectionIssue && !state) { app.innerHTML = renderConnectionIssue(); return; }
  if (!state) { app.innerHTML = renderJoinForm(); attachJoinHandler(); return; }

  let content = `<div class="game-header"><div><h1>${escapeHtml(state.venueName || state.seriesName || "")}</h1><p>${escapeHtml(state.gameName)}</p>${state.seriesName ? `<p class="series-label">Series: ${escapeHtml(state.seriesName)}</p>` : ""}</div><button id="sound-toggle" class="sound-toggle" aria-pressed="${notificationSoundEnabled}">${notificationSoundEnabled ? "Sound on" : "Sound off"}</button></div><p class="score">Score: ${state.player.score}</p>`;

  if (state.state === "question_open" && state.question) content += questionSection();
  else if (state.state === "results" && state.result) content += resultSection();
  else if (state.state === "finished" && state.seriesResult) content += seriesCompleteSection();
  else if (state.state === "finished" && state.gameResult) content += gameCompleteSection();
  else if (state.state === "finished") content += `<p class="muted">This game has ended. Thanks for playing!</p>`;
  else if (state.state === "series_lobby") content += `<p class="muted">Waiting for the host to start the first game…</p>${renderLeaderboard("Series standings", state.seriesStandings, state.player.displayName)}`;
  else content += `<p class="muted">Waiting for the host to open the next question…</p>`;

  app.innerHTML = content;
  document.querySelector("#sound-toggle")?.addEventListener("click", () => {
    notificationSoundEnabled = !notificationSoundEnabled;
    localStorage.setItem("mairs:notification-sound", notificationSoundEnabled ? "on" : "off");
    render();
  });
  document.querySelectorAll(".choice:not(:disabled)").forEach((button) => button.onclick = async () => {
    try {
      state.question.selectedAnswerId = button.dataset.id;
      state.question.answerSubmitted = true;
      render();
      await request("/v1/player/answer", { reconnectToken: token, questionId: state.question.id, answerId: button.dataset.id });
    } catch (error) {
      state.question.selectedAnswerId = null;
      state.question.answerSubmitted = false;
      render();
      if (error.code === "player_removed") applyRemoved(); else alert(error.message);
    }
  });
  if (state.state === "question_open" && state.question?.closesAt) {
    const updateCountdown = () => { const countdown = document.querySelector("#countdown"); if (countdown) countdown.textContent = `${Math.max(0, Math.ceil((Date.parse(state.question.closesAt) - Date.now()) / 1000))}s`; };
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 250);
  }
}

function attachJoinHandler() {
  document.querySelector("#join").onsubmit = async (event) => {
    event.preventDefault();
    try {
      const joined = await request("/v1/player/join", { joinCode: code, displayName: event.target[0].value });
      token = joined.reconnectToken;
      localStorage.setItem(storageKey, token);
      connectionIssue = false;
      applyGameState(joined.game);
      connect();
    } catch (error) { alert(error.message); }
  };
}

function applyRemoved() {
  removed = true;
  localStorage.removeItem(storageKey);
  token = null;
  if (socket) { socket.close(); socket = null; }
  clearTimeout(reconnectTimer); reconnectTimer = null;
  render();
}

function applyGameState(nextState) {
  const previousQuestionId = state?.state === "question_open" ? state.question?.id : null;
  const nextQuestionId = nextState?.state === "question_open" ? nextState.question?.id : null;
  state = nextState;
  connectionIssue = false;
  if (stateInitialized && notificationSoundEnabled && nextQuestionId && nextQuestionId !== previousQuestionId) {
    notificationSound.currentTime = 0;
    notificationSound.play().catch(() => { /* Browser autoplay policies may require a prior user gesture. */ });
  }
  stateInitialized = true;
  render();
}

async function refresh() {
  if (token) {
    try { state = (await request("/v1/player/reconnect", { reconnectToken: token })).game; connectionIssue = false; }
    catch (error) {
      if (error.code === "player_removed" || error.code === "invalid_player_session") { applyRemoved(); return; }
      // A network hiccup must not be treated as an invalid session — keep the token and show a recoverable state instead.
      connectionIssue = true;
    }
  }
  stateInitialized = true;
  render();
  if (connectionIssue) setTimeout(refresh, 3000);
}

function connect() {
  if (!token || socket || reconnectTimer) return;
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/ws`);
  socket.onopen = () => socket.send(JSON.stringify({ protocolVersion: 1, reconnectToken: token }));
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "error" && message.code === "player_removed") { applyRemoved(); return; }
    if (message.game) applyGameState(message.game);
  };
  socket.onclose = () => {
    socket = null;
    if (removed) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 2000);
  };
}

refresh().then(connect);
