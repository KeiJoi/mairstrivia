const app = document.querySelector("#app");
const code = location.pathname.split("/").pop();
let token = localStorage.getItem(`mairs:${code}`);
let state, socket, reconnectTimer;

const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
const request = async (path, body) => {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || "Request failed");
  return payload;
};

function render() {
  if (!state) {
    app.innerHTML = `<h1>Join trivia</h1><p class="muted">Enter your name to join this game.</p><form id="join"><input required maxlength="48" placeholder="Display name" aria-label="Display name"><button>Join game</button></form>`;
    document.querySelector("#join").onsubmit = async event => {
      event.preventDefault();
      try {
        const joined = await request("/v1/player/join", { joinCode: code, displayName: event.target[0].value });
        token = joined.reconnectToken;
        localStorage.setItem(`mairs:${code}`, token);
        state = joined.game;
        render();
        connect();
      } catch (error) { alert(error.message); }
    };
    return;
  }

  let content = `<h1>${escapeHtml(state.venueName)}</h1><p>${escapeHtml(state.gameName)}</p><p class="score">Score: ${state.player.score}</p>`;
  if (state.state === "question_open" && state.question) {
    const selected = state.question.selectedAnswerId;
    const locked = state.question.answerSubmitted ? " disabled" : "";
    const remaining = state.question.closesAt ? Math.max(0, Math.ceil((Date.parse(state.question.closesAt) - Date.now()) / 1000)) : null;
    content += `<h2>Question</h2><p>${escapeHtml(state.question.question)}</p>${remaining === null ? "" : `<p class="muted">Time remaining: ${remaining}s</p>`}<p class="muted">Choose one answer:</p>${state.question.choices.map(choice => `<button class="choice${selected === choice.id ? " selected" : ""}" data-id="${choice.id}"${locked}>${escapeHtml(choice.text)}</button>`).join("")}${state.question.answerSubmitted ? "<p class=\"muted\">Answer submitted. Waiting for results…</p>" : ""}`;
  } else if (state.state === "results" && state.result) {
    const result = state.result;
    const outcome = result.selectedAnswer === null ? "No answer submitted." : result.isCorrect ? "Correct!" : "Incorrect.";
    content += `<section class="result"><h2>Results</h2><p>${escapeHtml(result.question)}</p><p class="result-outcome ${result.isCorrect ? "correct" : "incorrect"}">${outcome}</p><p>Your answer: ${escapeHtml(result.selectedAnswer ?? "No answer")}</p><p>Correct answer: <strong>${escapeHtml(result.correctAnswer)}</strong></p><p>Points awarded: ${result.pointsAwarded}</p></section>`;
  } else if (state.state === "finished") {
    content += "<p class=\"muted\">This game has ended. Thanks for playing!</p>";
  } else {
    content += "<p class=\"muted\">Waiting for the host to open the next question…</p>";
  }
  app.innerHTML = content;
  document.querySelectorAll(".choice:not(:disabled)").forEach(button => button.onclick = async () => {
    try {
      state.question.selectedAnswerId = button.dataset.id;
      state.question.answerSubmitted = true;
      render();
      await request("/v1/player/answer", { reconnectToken: token, questionId: state.question.id, answerId: button.dataset.id });
    } catch (error) {
      state.question.answerSubmitted = false;
      render();
      alert(error.message);
    }
  });
  if (state.state === "question_open" && state.question?.closesAt) setTimeout(render, 250);
}

async function refresh() {
  if (token) {
    try { state = (await request("/v1/player/reconnect", { reconnectToken: token })).game; }
    catch { localStorage.removeItem(`mairs:${code}`); token = null; }
  }
  render();
}

function connect() {
  if (!token || socket || reconnectTimer) return;
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/ws`);
  socket.onopen = () => socket.send(JSON.stringify({ protocolVersion: 1, reconnectToken: token }));
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.game) { state = message.game; render(); }
  };
  socket.onclose = () => {
    socket = null;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 2000);
  };
}

refresh().then(connect);
