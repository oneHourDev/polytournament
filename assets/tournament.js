(function () {
  const tournament = window.TOURNAMENT_DATA;
  const players = tournament?.players?.length ? tournament.players : defaultPlayers(7);
  const slug = tournament?.slug || "fight-unknown";
  const totalMatches = (players.length * (players.length - 1)) / 2;
  let scoreResults = { ...(tournament?.scoreResults || {}) };
  let activeCell = null;
  let database;
  let resultsRef;

  const firebaseConfig = {
    apiKey: "AIzaSyBZtsslw-R17toTXbKBoikhc0vyOdAeDe0",
    authDomain: "polytournament-87d5b.firebaseapp.com",
    databaseURL: "https://polytournament-87d5b-default-rtdb.firebaseio.com",
    projectId: "polytournament-87d5b",
    storageBucket: "polytournament-87d5b.firebasestorage.app",
    messagingSenderId: "428892548438",
    appId: "1:428892548438:web:8c7a105e25fedd868b7af7"
  };

  initPage();

  function initPage() {
    if (!tournament) {
      document.body.innerHTML = `<div class="wrapper"><div class="empty-state">Tournament data is missing.</div></div>`;
      return;
    }

    document.title = `${tournament.name} - Polytournament`;
    document.getElementById("title-eyebrow").textContent = tournament.slug;
    document.getElementById("tournament-title").textContent = tournament.name || `Fight ${tournament.id}`;
    document.getElementById("tournament-subtitle").textContent = buildSubtitle(tournament.settings);
    renderSettingsSummary();
    renderResultsTable();
    wirePopup();

    const connected = initFirebase();
    if (!connected) {
      loadFromStorage();
      render();
    }

    render();
  }

  function initFirebase() {
    if (typeof firebase === "undefined") return false;

    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      database = firebase.database();
      resultsRef = database.ref(`results/${slug}`);
      resultsRef.on("value", (snapshot) => {
        const data = snapshot.val();
        scoreResults = data || { ...(tournament?.scoreResults || {}) };
        render();
      });
      return true;
    } catch (error) {
      console.error("Firebase init failed:", error);
      return false;
    }
  }

  function render() {
    renderMatrix();
    renderScoreboard();
    renderRankings();
    renderProgress();
  }

  function renderSettingsSummary() {
    const settings = tournament.settings || {};
    const summary = [
      ["Tribe", settings.selectedTribe],
      ["Map", [settings.mapType, settings.mapSize].filter(Boolean).join(" · ")],
      ["Mode", settings.gameMode],
      ["Bots", formatBots(settings.bots)]
    ].filter(([, value]) => value);

    document.getElementById("settings-summary").innerHTML = summary
      .map(([label, value]) => `<span class="settings-pill">${escapeHtml(label)}: ${escapeHtml(value)}</span>`)
      .join("");

    const specialRules = settings.specialRules;
    if (specialRules) {
      document.getElementById("special-rules").textContent = specialRules;
      document.getElementById("special-rules-wrap").hidden = false;
    }
  }

  function renderMatrix() {
    const table = document.getElementById("matrix-table");
    let html = `<thead><tr><th class="corner"></th>`;

    for (let col = 0; col < players.length; col += 1) {
      html += `<th class="col-header"><div class="col-header-inner">${avatarEl(col, 62)}<span class="player-idx">${col + 1}</span></div></th>`;
    }

    html += `</tr></thead><tbody>`;

    for (let row = 0; row < players.length; row += 1) {
      html += `<tr><td class="row-header"><div class="row-header-inner">${avatarEl(row, 58)}<span class="rh-name">${escapeHtml(playerName(row))}</span></div></td>`;

      for (let col = 0; col < players.length; col += 1) {
        if (row === col) {
          html += `<td class="result-cell diagonal"></td>`;
        } else {
          const result = getResult(row, col);
          let className = "empty";
          let display = "add result";

          if (result === "1:0") {
            className = "win";
            display = "1:0";
          } else if (result === "0:1") {
            className = "loss";
            display = "0:1";
          }

          html += `<td class="result-cell ${className}" data-row="${row}" data-col="${col}" title="${escapeAttribute(playerName(row))} vs ${escapeAttribute(playerName(col))}"><span class="result-display">${display}</span></td>`;
        }
      }

      html += `</tr>`;
    }

    html += `</tbody>`;
    table.innerHTML = html;
    table.querySelectorAll("td.result-cell:not(.diagonal)").forEach((cell) => {
      cell.addEventListener("click", () => openPopup(Number(cell.dataset.row), Number(cell.dataset.col)));
    });
  }

  function renderScoreboard() {
    const stats = calcStats().sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.losses - b.losses);
    const maxPts = stats[0]?.pts ?? 0;

    document.getElementById("scoreboard").innerHTML = stats.map((stat) => {
      const leader = stat.pts === maxPts && stat.pts > 0 ? "leader" : "";
      return `<div class="score-card ${leader}">
        ${avatarEl(stat.idx, 80)}
        <div class="sc-name">${escapeHtml(playerName(stat.idx))}</div>
        <div class="sc-pts">${stat.pts} <span>PTS</span></div>
        <div class="sc-record">${stat.wins}W - ${stat.losses}L</div>
      </div>`;
    }).join("");
  }

  function renderRankings() {
    const stats = calcStats().sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.losses - b.losses);
    document.getElementById("rank-body").innerHTML = stats.map((stat, rank) => {
      return `<tr>
        <td class="rank-no">${rank + 1}.</td>
        <td><div class="rank-name">${avatarEl(stat.idx, 42)} ${escapeHtml(playerName(stat.idx))}</div></td>
        <td class="pts">${stat.pts}</td>
        <td class="wins">${stat.wins}</td>
        <td class="losses">${stat.losses}</td>
        <td style="color:var(--muted)">${stat.remaining}</td>
      </tr>`;
    }).join("");
  }

  function renderProgress() {
    let played = 0;
    for (let row = 0; row < players.length; row += 1) {
      for (let col = row + 1; col < players.length; col += 1) {
        if (scoreResults[key(row, col)]) played += 1;
      }
    }

    document.getElementById("progress-text").textContent = `${played} / ${totalMatches}`;
    const percent = totalMatches ? (played / totalMatches) * 100 : 0;
    document.getElementById("progress-fill").style.width = `${percent.toFixed(1)}%`;
  }

  function renderResultsTable() {
    const rows = Array.isArray(tournament.results) ? tournament.results : [];
    const body = document.getElementById("manual-results-body");

    if (!rows.length) {
      body.innerHTML = `<tr><td>${escapeHtml(tournament.slug)}</td><td colspan="3" style="color:var(--muted)">No manual results yet.</td></tr>`;
      return;
    }

    body.innerHTML = rows.map((result) => {
      return `<tr>
        <td>${escapeHtml(result.fightNumber || tournament.slug)}</td>
        <td>${escapeHtml(result.winner || "")}</td>
        <td>${escapeHtml(result.tribe || "")}</td>
        <td>${escapeHtml(result.notes || "")}</td>
      </tr>`;
    }).join("");
  }

  function calcStats() {
    return players.map((_, index) => {
      let wins = 0;
      let losses = 0;
      let played = 0;
      let remaining = 0;

      for (let other = 0; other < players.length; other += 1) {
        if (index === other) continue;
        const result = getResult(index, other);

        if (result === "1:0") {
          wins += 1;
          played += 1;
        } else if (result === "0:1") {
          losses += 1;
          played += 1;
        } else {
          remaining += 1;
        }
      }

      return { idx: index, wins, losses, played, remaining, pts: wins };
    });
  }

  function wirePopup() {
    document.getElementById("popup").addEventListener("click", (event) => {
      if (event.target === document.getElementById("popup")) closePopup();
    });

    document.getElementById("popup-cancel").addEventListener("click", closePopup);
    document.getElementById("popup-clear").addEventListener("click", clearResult);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.getElementById("popup").classList.contains("active")) {
        closePopup();
      }
    });
  }

  function openPopup(row, col) {
    activeCell = { row, col };
    document.getElementById("popup-matchup").textContent = `${playerName(row)} vs ${playerName(col)}`;

    const selector = document.getElementById("winner-selector");
    selector.innerHTML = `
      <div class="winner-option" data-winner="row">
        ${avatarEl(row, 80)}
        <div class="player-name">${escapeHtml(playerName(row))}</div>
      </div>
      <div class="winner-option" data-winner="col">
        ${avatarEl(col, 80)}
        <div class="player-name">${escapeHtml(playerName(col))}</div>
      </div>
    `;

    selector.querySelectorAll(".winner-option").forEach((option) => {
      option.addEventListener("click", () => selectWinner(option.dataset.winner));
    });

    const existing = getResult(row, col);
    if (existing === "1:0") selector.querySelector('[data-winner="row"]').classList.add("selected");
    if (existing === "0:1") selector.querySelector('[data-winner="col"]').classList.add("selected");

    document.getElementById("popup").classList.add("active");
  }

  function selectWinner(winner) {
    document.querySelectorAll(".winner-option").forEach((option) => option.classList.remove("selected"));
    document.querySelector(`[data-winner="${winner}"]`)?.classList.add("selected");
    setTimeout(() => confirmResult(winner), 250);
  }

  function confirmResult(winner) {
    if (!activeCell) return;
    setResult(activeCell.row, activeCell.col, winner === "row" ? "1:0" : "0:1");
    autoSave();
    closePopup();
    render();
    showToast(`Saved ${slug}`);
  }

  function closePopup() {
    document.getElementById("popup").classList.remove("active");
    activeCell = null;
  }

  function clearResult() {
    if (!activeCell) return;
    clearResultAt(activeCell.row, activeCell.col);
    autoSave();
    closePopup();
    render();
    showToast("Result cleared");
  }

  function autoSave() {
    if (resultsRef) {
      resultsRef.set(scoreResults).catch((error) => console.error("Save failed:", error));
      return;
    }

    localStorage.setItem(storageKey(), JSON.stringify(scoreResults));
  }

  function loadFromStorage() {
    const stored = localStorage.getItem(storageKey());
    if (!stored) return;

    try {
      scoreResults = JSON.parse(stored);
    } catch (error) {
      console.error("Failed to load local results:", error);
    }
  }

  function getResult(row, col) {
    if (row === col) return null;
    if (row < col) return scoreResults[key(row, col)] || null;

    const value = scoreResults[key(col, row)] || null;
    if (!value) return null;
    return value === "1:0" ? "0:1" : "1:0";
  }

  function setResult(row, col, value) {
    if (row < col) {
      scoreResults[key(row, col)] = value;
    } else {
      scoreResults[key(col, row)] = value === "1:0" ? "0:1" : "1:0";
    }
  }

  function clearResultAt(row, col) {
    if (row < col) {
      delete scoreResults[key(row, col)];
    } else {
      delete scoreResults[key(col, row)];
    }
  }

  function avatarEl(index, size) {
    const player = players[index] || {};
    const name = playerName(index);

    if (player.avatar) {
      return `<img src="${escapeAttribute(player.avatar)}" width="${size}" height="${size}" class="avatar-fallback" alt="${escapeAttribute(name)}">`;
    }

    const colors = ["#3a5a8a", "#5a3a8a", "#8a5a3a", "#3a8a5a", "#8a3a5a", "#5a8a3a", "#3a6a7a"];
    const initials = name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
    return `<div class="avatar-fallback" style="width:${size}px;height:${size}px;background:${colors[index % colors.length]};font-size:${Math.round(size * 0.35)}px;">${escapeHtml(initials)}</div>`;
  }

  function buildSubtitle(settings = {}) {
    return [settings.gameMode, settings.mapType, settings.selectedTribe].filter(Boolean).join(" · ");
  }

  function formatBots(bots) {
    if (!Array.isArray(bots) || !bots.length) return "No bots";
    return bots.map((bot) => `${bot.name || "Bot"} (${bot.difficulty || "Normal"})`).join(", ");
  }

  function playerName(index) {
    return players[index]?.name || `Player ${index + 1}`;
  }

  function key(row, col) {
    return `${row}-${col}`;
  }

  function storageKey() {
    return `polytournament-results-${slug}`;
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function defaultPlayers(count) {
    return Array.from({ length: count }, (_, index) => ({ name: `Player ${index + 1}` }));
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
