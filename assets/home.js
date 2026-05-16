(function () {
  const LOGIN = { username: "polytopia", password: "ihatecymant1" };
  const state = { tournaments: [], isAuthed: false };

  const grid = document.getElementById("tournament-grid");
  const loginModal = document.getElementById("login-modal");
  const setupModal = document.getElementById("setup-modal");
  const setupForm = document.getElementById("setup-form");
  const loginForm = document.getElementById("login-form");
  const botCount = document.getElementById("bot-count");
  const botList = document.getElementById("bot-list");
  const setupOutput = document.getElementById("setup-output");
  const creationNotice = document.getElementById("creation-notice");

  document.getElementById("new-tournament-btn").addEventListener("click", () => {
    if (state.isAuthed) {
      openModal(setupModal);
      syncSetupDefaults();
    } else {
      openModal(loginModal);
    }
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", closeModals);
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModals();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModals();
  });

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const username = String(formData.get("username") || "");
    const password = String(formData.get("password") || "");

    if (username === LOGIN.username && password === LOGIN.password) {
      state.isAuthed = true;
      document.getElementById("login-error").textContent = "";
      loginForm.reset();
      closeModals();
      syncSetupDefaults();
      openModal(setupModal);
      return;
    }

    document.getElementById("login-error").textContent = "Incorrect username or password.";
  });

  botCount.addEventListener("change", renderBotRows);

  setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const entry = buildTournamentEntry();
    const output = JSON.stringify(entry, null, 2);
    setupOutput.textContent = output;
    setupOutput.classList.add("active");
    creationNotice.hidden = false;
    downloadJson(entry);
    showToast(`Prepared ${entry.slug}`);
  });

  loadTournaments();

  async function loadTournaments() {
    try {
      const response = await fetch("data/tournaments.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.tournaments = Array.isArray(data.tournaments) ? data.tournaments : [];
      renderTournaments();
      syncSetupDefaults();
    } catch (error) {
      grid.innerHTML = `<div class="empty-state">Could not load tournament data.</div>`;
      console.error("Failed to load tournaments:", error);
    }
  }

  function renderTournaments() {
    const tournaments = [...state.tournaments].sort((a, b) => {
      return new Date(b.creationDate) - new Date(a.creationDate) || b.id - a.id;
    });

    if (!tournaments.length) {
      grid.innerHTML = `<div class="empty-state">No tournaments yet. Create the first fight.</div>`;
      return;
    }

    const latestId = Math.max(...tournaments.map((tournament) => Number(tournament.id) || 0));
    grid.innerHTML = tournaments.map((tournament) => renderCard(tournament, tournament.id === latestId)).join("");
  }

  function renderCard(tournament, isLatest) {
    const settings = tournament.settings || {};
    const bots = Array.isArray(settings.bots) && settings.bots.length
      ? settings.bots.map((bot) => `${bot.name || "Bot"} (${bot.difficulty || "Normal"})`).join(", ")
      : "No bots";
    const summary = [
      settings.gameMode,
      settings.mapType,
      settings.mapSize
    ].filter(Boolean).join(" · ");

    return `
      <article class="tournament-card ${isLatest ? "latest" : ""}">
        <div>
          <div class="card-kicker">
            <span>${escapeHtml(formatDate(tournament.creationDate))}</span>
            ${isLatest ? `<span class="latest-pill">Latest</span>` : ""}
          </div>
          <h2 class="card-title">${escapeHtml(tournament.name || `Fight ${tournament.id}`)}</h2>
          <div class="settings-list">
            <div><span>Tribe:</span> ${escapeHtml(settings.selectedTribe || "Not set")}</div>
            <div><span>Map:</span> ${escapeHtml(summary || "Not set")}</div>
            <div><span>Bots:</span> ${escapeHtml(bots)}</div>
          </div>
        </div>
        <div class="card-actions">
          <a class="link-btn primary" href="${escapeAttribute(tournament.slug)}/">Open Tournament</a>
        </div>
      </article>
    `;
  }

  function syncSetupDefaults() {
    const nextId = getNextId();
    document.getElementById("tournament-name").placeholder = `Fight ${nextId}`;
    setupOutput.textContent = "";
    setupOutput.classList.remove("active");
    creationNotice.hidden = true;
    renderBotRows();
  }

  function renderBotRows() {
    const count = Number(botCount.value || 0);
    botList.innerHTML = "";

    for (let index = 1; index <= count; index += 1) {
      const row = document.createElement("div");
      row.className = "bot-row";
      row.innerHTML = `
        <div class="form-row">
          <label for="bot-name-${index}">Bot ${index}</label>
          <input id="bot-name-${index}" name="botName${index}" value="Bot ${index}">
        </div>
        <div class="form-row">
          <label for="bot-difficulty-${index}">Difficulty</label>
          <select id="bot-difficulty-${index}" name="botDifficulty${index}">
            <option>Easy</option>
            <option selected>Normal</option>
            <option>Hard</option>
            <option>Crazy</option>
          </select>
        </div>
      `;
      botList.appendChild(row);
    }
  }

  function buildTournamentEntry() {
    const nextId = getNextId();
    const formData = new FormData(setupForm);
    const bots = [];
    const count = Number(formData.get("botCount") || 0);

    for (let index = 1; index <= count; index += 1) {
      bots.push({
        name: String(formData.get(`botName${index}`) || `Bot ${index}`),
        difficulty: String(formData.get(`botDifficulty${index}`) || "Normal")
      });
    }

    return {
      id: nextId,
      slug: `fight-${nextId}`,
      name: String(formData.get("name") || `Fight ${nextId}`),
      creationDate: new Date().toISOString().slice(0, 10),
      settings: {
        selectedTribe: String(formData.get("selectedTribe") || "Kickoo"),
        mapType: String(formData.get("mapType") || "Drylands"),
        mapSize: String(formData.get("mapSize") || "Normal"),
        gameMode: String(formData.get("gameMode") || "1v1"),
        bots,
        specialRules: String(formData.get("specialRules") || "")
      },
      players: defaultPlayers(7),
      scoreResults: {},
      results: []
    };
  }

  function defaultPlayers(count) {
    return Array.from({ length: count }, (_, index) => ({ name: `Player ${index + 1}` }));
  }

  function getNextId() {
    return state.tournaments.reduce((max, tournament) => {
      return Math.max(max, Number(tournament.id) || 0);
    }, 0) + 1;
  }

  function downloadJson(entry) {
    const blob = new Blob([`${JSON.stringify(entry, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${entry.slug}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function openModal(modal) {
    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModals() {
    document.querySelectorAll(".modal-overlay").forEach((modal) => {
      modal.classList.remove("active");
      modal.setAttribute("aria-hidden", "true");
    });
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function formatDate(value) {
    if (!value) return "Unknown date";
    return new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(new Date(`${value}T00:00:00`));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }
}());
