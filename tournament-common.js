// Polytopia Tournament - Common JavaScript Functions
// This file contains all the shared logic for tournament pages

// ─── GLOBAL STATE ──────────────────────────────────────────────────────────
let N, TOTAL;
let results = {};
let database, resultsRef;
let currentResultsPath = null;
let activeCell = null;
let toastTimer;

// ─── FIREBASE FUNCTIONS ────────────────────────────────────────────────────
// Initialize the Firebase app + database connection once. Safe to call
// repeatedly (guarded by firebase.apps.length). Does NOT subscribe to any
// tournament data — use subscribeResults() for that.
function ensureFirebaseApp(firebaseConfig) {
  if (typeof firebase === 'undefined' || !firebaseConfig || firebaseConfig.apiKey === "YOUR_API_KEY") {
    return false;
  }
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    database = firebase.database();
    console.log('✓ Firebase connected');
    return true;
  } catch (e) {
    console.error('Firebase init failed:', e);
    return false;
  }
}

// Subscribe to a tournament's match-results node. Detaches any previous
// subscription first so the hub can switch tournaments without reloading.
// resultsPath may be a top-level node (legacy: "results", "tournament2", …)
// or a nested path under the registry (dynamic: "tournaments/t5/results").
function subscribeResults(resultsPath) {
  if (!database) return false;
  // Already listening to this exact node — keep it. This matters because the
  // dynamic hub also watches the parent "tournaments" node, and a saved result
  // (nested under it) re-fires that listener; without this guard we would tear
  // down and re-attach the results listener on every save.
  if (currentResultsPath === resultsPath && resultsRef) return true;
  if (resultsRef) resultsRef.off();
  currentResultsPath = resultsPath;
  results = {};
  resultsRef = database.ref(resultsPath);
  resultsRef.on('value', (snapshot) => {
    results = snapshot.val() || {};
    render();
    checkTournamentComplete();
  }, (err) => {
    // e.g. permission denied because the results node has no matching rule.
    console.error('Failed to read results for "' + resultsPath + '":', err);
    if (typeof showToast === 'function') {
      showToast('⚠ Cannot load "' + resultsPath + '" — check Firebase rules');
    }
  });
  return true;
}

function autoSave() {
  if (resultsRef) {
    resultsRef.set(results).catch(e => console.error('Save failed:', e));
  } else {
    localStorage.setItem(`polytournament-results-${TOURNAMENT_ID}`, JSON.stringify(results));
  }
}

// ─── SCORE DOCS (feed the WhatsApp announcement Cloud Function) ──────────────
// Alongside the positional `results` map (used for ranking), we write a richer
// per-match "score doc" under tournaments/<id>/scores/<matchId>. It carries an
// explicit winner_nickname and a `notified` flag. An n8n schedule polls these
// docs, reads winner_nickname (never recomputes it), announces to WhatsApp, and
// sets notified:true. Writing notified:false on every save lets a correction
// re-announce. Scores are Firebase-only (no localStorage fallback — no bot offline).
function scoresBasePath() {
  if (!currentResultsPath) return null;
  return currentResultsPath.replace(/\/results$/, '');
}

function saveScore(r, c, winner) {
  if (!database) return;
  const base = scoresBasePath();
  if (!base) return;
  const a = Math.min(r, c), b = Math.max(r, c);
  const matchId = `${a}-${b}`;
  const winnerIdx = winner === 'r' ? r : c;
  const loserIdx = winner === 'r' ? c : r;
  const score = {
    result: winnerIdx === a ? '1:0' : '0:1',   // canonical: row(a) vs col(b)
    winner_nickname: PLAYERS[winnerIdx].name,
    loser_nickname: PLAYERS[loserIdx].name,
    row_nickname: PLAYERS[a].name,
    col_nickname: PLAYERS[b].name,
    match_id: matchId,
    notified: false,
    created_at: Date.now(),
  };
  database.ref(`${base}/scores/${matchId}`).set(score).catch(e => console.error('Score save failed:', e));
}

function deleteScore(r, c) {
  if (!database) return;
  const base = scoresBasePath();
  if (!base) return;
  const a = Math.min(r, c), b = Math.max(r, c);
  database.ref(`${base}/scores/${a}-${b}`).remove().catch(e => console.error('Score delete failed:', e));
}

function loadFromStorage() {
  const stored = localStorage.getItem(`polytournament-results-${TOURNAMENT_ID}`);
  if (stored) {
    try {
      results = JSON.parse(stored);
    } catch (e) {
      console.error('Failed to load results:', e);
    }
  }
}

// ─── HELPER FUNCTIONS ──────────────────────────────────────────────────────
const key = (r, c) => `${r}-${c}`;

function getResult(r, c) {
  if (r === c) return null;
  if (r < c) return results[key(r, c)] || null;
  const v = results[key(c, r)] || null;
  if (!v) return null;
  return v === "1:0" ? "0:1" : "1:0";
}

function setResult(r, c, val) {
  if (r < c) {
    results[key(r, c)] = val;
  } else {
    results[key(c, r)] = val === "1:0" ? "0:1" : "1:0";
  }
}

function clearResultAt(r, c) {
  if (r < c) delete results[key(r, c)];
  else delete results[key(c, r)];
}

function initialsAvatar(idx, size) {
  const p = PLAYERS[idx];
  const initials = (p.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#3a5a8a', '#5a3a8a', '#8a5a3a', '#3a8a5a', '#8a3a5a', '#5a8a3a', '#3a6a7a'];
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${colors[idx % colors.length]};display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:${Math.round(size * 0.35)}px;color:#fff;border:2px solid var(--border);flex-shrink:0;">${initials}</div>`;
}

// If a derived avatar image is missing, swap it for the initials placeholder.
function onAvatarError(img, idx, size) {
  img.outerHTML = initialsAvatar(idx, size);
}

function avatarEl(idx, size) {
  const p = PLAYERS[idx];
  if (p.avatar) {
    return `<img src="${p.avatar}" width="${size}" height="${size}" style="border-radius:50%;border:2px solid var(--border);object-fit:cover;" alt="${p.name}" onerror="onAvatarError(this, ${idx}, ${size})">`;
  }
  return initialsAvatar(idx, size);
}

// ─── STATS AND RANKING ─────────────────────────────────────────────────────
function calcStats() {
  return PLAYERS.map((_, i) => {
    let wins = 0, losses = 0, played = 0, remaining = 0;
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const r = getResult(i, j);
      if (r === "1:0") { wins++; played++; }
      else if (r === "0:1") { losses++; played++; }
      else remaining++;
    }
    return { idx: i, wins, losses, played, remaining, pts: wins };
  });
}

function headToHead(aIdx, bIdx) {
  const result = getResult(aIdx, bIdx);
  if (result === "1:0") return -1;
  if (result === "0:1") return 1;
  return 0;
}

function beatAllInGroup(playerIdx, group) {
  return group.every(other => {
    if (other.idx === playerIdx) return true;
    const result = getResult(playerIdx, other.idx);
    return result === "1:0";
  });
}

function sortByRank(stats) {
  const grouped = {};
  stats.forEach(s => {
    if (!grouped[s.pts]) grouped[s.pts] = [];
    grouped[s.pts].push(s);
  });

  const result = [];
  Object.keys(grouped)
    .map(Number)
    .sort((a, b) => b - a)
    .forEach(pts => {
      const group = grouped[pts];

      if (group.length === 1) {
        group[0].isTied = false;
        result.push(group[0]);
      } else if (group.length === 2) {
        const h2h = headToHead(group[0].idx, group[1].idx);
        if (h2h < 0) {
          group[0].isTied = false;
          group[1].isTied = false;
          result.push(group[0], group[1]);
        } else if (h2h > 0) {
          group[0].isTied = false;
          group[1].isTied = false;
          result.push(group[1], group[0]);
        } else {
          group[0].isTied = true;
          group[1].isTied = true;
          result.push(...group);
        }
      } else {
        const winners = group.filter(p => beatAllInGroup(p.idx, group));
        if (winners.length === 1) {
          winners[0].isTied = false;
          const rest = group.filter(p => p.idx !== winners[0].idx);
          rest.forEach(p => p.isTied = true);
          result.push(winners[0], ...rest.sort((a, b) => b.wins - a.wins || a.losses - b.losses));
        } else {
          group.forEach(p => p.isTied = true);
          result.push(...group.sort((a, b) => b.wins - a.wins || a.losses - b.losses));
        }
      }
    });

  return result;
}

// ─── RENDER FUNCTIONS ──────────────────────────────────────────────────────
function render() {
  renderMatrix();
  renderScoreboard();
  renderProgress();
}

function renderMatrix() {
  const t = document.getElementById('matrix-table');
  let html = '<thead><tr><th class="corner"></th>';
  for (let j = 0; j < N; j++) {
    html += `<th class="col-header"><div class="col-header-inner">${avatarEl(j, 62)}<span class="player-idx">${j + 1}</span></div></th>`;
  }
  html += '</tr></thead><tbody>';
  for (let i = 0; i < N; i++) {
    html += `<tr><td class="row-header"><div class="row-header-inner">${avatarEl(i, 58)}<span class="rh-name">${PLAYERS[i].name}</span></div></td>`;
    for (let j = 0; j < N; j++) {
      if (i === j) {
        html += `<td class="result-cell diagonal"></td>`;
      } else {
        const r = getResult(i, j);
        let cls = 'empty';
        let disp = 'add result';
        if (r === '1:0') { cls = 'win'; disp = '1:0'; }
        else if (r === '0:1') { cls = 'loss'; disp = '0:1'; }
        html += `<td class="result-cell ${cls}" onclick="openPopup(${i},${j})" title="${PLAYERS[i].name} vs ${PLAYERS[j].name}"><span class="result-display">${disp}</span></td>`;
      }
    }
    html += '</tr>';
  }
  html += '</tbody>';
  t.innerHTML = html;
}

function renderScoreboard() {
  const stats = sortByRank(calcStats());
  const maxPts = stats[0]?.pts ?? 0;
  let html = '';
  let displayRank = 1;
  let tieGroupStart = null;

  stats.forEach((s, idx) => {
    const isLeader = s.pts === maxPts && s.pts > 0;
    const leader = isLeader ? 'leader' : '';
    const tied = s.isTied ? 'tied' : '';

    if (idx > 0 && s.pts === stats[idx - 1].pts && s.isTied && stats[idx - 1].isTied) {
      if (tieGroupStart === null) tieGroupStart = displayRank;
    } else {
      tieGroupStart = null;
      displayRank = idx + 1;
    }
    const position = tieGroupStart !== null ? `T${tieGroupStart}` : `${displayRank}`;

    html += `<div class="score-card ${leader} ${tied}">
      <div class="sc-position">#${position}</div>
      ${avatarEl(s.idx, 80)}
      <div class="sc-name">${PLAYERS[s.idx].name}</div>
      <div class="sc-pts">${s.pts} <span>POINTS</span></div>
      <div class="sc-record">${s.wins}V – ${s.losses}P</div>
    </div>`;
  });
  document.getElementById('scoreboard').innerHTML = html;
}

function renderProgress() {
  let played = 0;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (results[key(i, j)]) played++;
  document.getElementById('progress-text').textContent = `${played} / ${TOTAL}`;
  const pct = TOTAL > 0 ? (played / TOTAL * 100) : 0;
  document.getElementById('progress-fill').style.width = `${pct.toFixed(1)}%`;
}

// ─── POPUP FUNCTIONS ───────────────────────────────────────────────────────
function openPopup(r, c) {
  activeCell = { r, c };
  const existing = getResult(r, c);
  document.getElementById('popup-matchup').textContent =
    `${PLAYERS[r].name}  vs  ${PLAYERS[c].name}`;

  const selector = document.getElementById('winner-selector');
  const player1 = PLAYERS[r];
  const player2 = PLAYERS[c];

  selector.innerHTML = `
    <div class="winner-option" data-winner="r" onclick="selectWinner('r')">
      ${avatarEl(r, 80).replace('class="avatar-circle"', 'class="avatar"')}
      <div class="player-name">${player1.name}</div>
    </div>
    <div class="winner-option" data-winner="c" onclick="selectWinner('c')">
      ${avatarEl(c, 80).replace('class="avatar-circle"', 'class="avatar"')}
      <div class="player-name">${player2.name}</div>
    </div>
  `;

  if (existing === '1:0') {
    setTimeout(() => document.querySelector('[data-winner="r"]').classList.add('selected'), 10);
  } else if (existing === '0:1') {
    setTimeout(() => document.querySelector('[data-winner="c"]').classList.add('selected'), 10);
  }

  document.getElementById('popup').classList.add('active');
}

function selectWinner(winner) {
  document.querySelectorAll('.winner-option').forEach(el => el.classList.remove('selected'));
  document.querySelector(`[data-winner="${winner}"]`).classList.add('selected');
  setTimeout(() => confirmResult(winner), 300);
}

function closePopup() {
  document.getElementById('popup').classList.remove('active');
  activeCell = null;
}

function confirmResult(winner) {
  if (!activeCell) return;

  if (!winner) {
    const selected = document.querySelector('.winner-option.selected');
    if (!selected) {
      showToast('⚠ Select winner');
      return;
    }
    winner = selected.getAttribute('data-winner');
  }

  const result = winner === 'r' ? '1:0' : '0:1';
  setResult(activeCell.r, activeCell.c, result);
  autoSave();
  saveScore(activeCell.r, activeCell.c, winner);
  closePopup();
  render();
  showToast(result === '1:0'
    ? `✓ Winner: ${PLAYERS[activeCell?.r]?.name ?? ''}`
    : `✓ Winner: ${PLAYERS[activeCell?.c]?.name ?? ''}`);

  checkTournamentComplete();
}

function clearResult() {
  if (!activeCell) return;
  clearResultAt(activeCell.r, activeCell.c);
  autoSave();
  deleteScore(activeCell.r, activeCell.c);
  closePopup();
  render();
  showToast('Result deleted');
}

// ─── CELEBRATION FUNCTIONS ─────────────────────────────────────────────────
function checkTournamentComplete() {
  const stats = calcStats();
  const allPlayed = stats.every(s => s.remaining === 0);

  if (allPlayed) {
    const sorted = [...stats].sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.losses - b.losses);
    const winner = sorted[0];
    setTimeout(() => showCelebration(winner), 800);
  }
}

function showCelebration(winner) {
  const overlay = document.getElementById('celebration');
  const player = PLAYERS[winner.idx];
  const video = document.getElementById('winner-video');
  const videoSource = document.getElementById('winner-video-source');
  const avatarContainer = document.getElementById('winner-avatar-container');
  const avatar = document.getElementById('winner-avatar');

  document.getElementById('winner-name').textContent = player.name;
  document.getElementById('winner-stats').textContent =
    `${winner.wins} wins | ${winner.losses} losses | ${winner.pts} points`;

  const videoPath = `resources/video/${player.name}.mp4`;

  fetch(videoPath, { method: 'HEAD' })
    .then(response => {
      if (response.ok) {
        videoSource.src = videoPath;
        video.load();
        video.style.display = 'block';
        avatarContainer.style.display = 'none';
        video.play().catch(err => console.log('Video autoplay blocked:', err));
      } else {
        avatar.src = player.avatar || '';
        video.style.display = 'none';
        avatarContainer.style.display = 'block';
      }
    })
    .catch(() => {
      avatar.src = player.avatar || '';
      video.style.display = 'none';
      avatarContainer.style.display = 'block';
    });

  overlay.classList.add('active');
  createConfetti();
}

function closeCelebration() {
  const overlay = document.getElementById('celebration');
  const video = document.getElementById('winner-video');

  overlay.classList.remove('active');
  video.pause();
  video.currentTime = 0;
  document.querySelectorAll('.confetti').forEach(c => c.remove());
}

function createConfetti() {
  const overlay = document.getElementById('celebration');
  const colors = ['#e8c06a', '#c9933a', '#7be89a', '#e87b7b', '#6b7094'];

  for (let i = 0; i < 50; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.left = Math.random() * 100 + '%';
    confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDelay = Math.random() * 3 + 's';
    confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
    overlay.appendChild(confetti);
  }
}

// ─── TOAST ─────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── EVENT LISTENERS ───────────────────────────────────────────────────────
// Attached after the shared templates are injected (the popup element must
// already exist in the DOM), so this is called from injectSharedTemplates().
function attachGlobalListeners() {
  const popup = document.getElementById('popup');
  if (popup) {
    popup.addEventListener('click', e => {
      if (e.target === popup) closePopup();
    });
  }
  document.addEventListener('keydown', e => {
    const p = document.getElementById('popup');
    if (e.key === 'Escape' && p && p.classList.contains('active')) {
      closePopup();
    }
  });
}

// ─── TEMPLATE INJECTION ────────────────────────────────────────────────────
function injectSharedTemplates() {
  const template = `
    <!-- Popup for selecting winner -->
    <div class="popup-overlay" id="popup">
      <div class="popup">
        <h3>Who won?</h3>
        <div class="matchup-label" id="popup-matchup"></div>
        <div class="winner-selector" id="winner-selector"></div>
        <div class="hint">Click on the winner's avatar</div>
        <div class="popup-btns">
          <button class="btn btn-cancel" onclick="closePopup()">Cancel</button>
          <button class="btn btn-clear" onclick="clearResult()">Smazat</button>
        </div>
      </div>
    </div>

    <!-- Winner Celebration -->
    <div class="celebration-overlay" id="celebration">
      <div class="celebration-content">
        <div class="celebration-title">🏆 TOURNAMENT WINNER! 🏆</div>
        <video class="winner-video" id="winner-video" autoplay loop muted style="display:none;">
          <source id="winner-video-source" src="" type="video/mp4">
        </video>
        <div class="winner-avatar-container" id="winner-avatar-container" style="display:none;">
          <img class="winner-avatar" id="winner-avatar" src="" alt="Winner">
        </div>
        <div class="winner-name" id="winner-name"></div>
        <div class="winner-stats" id="winner-stats"></div>
        <button class="celebration-close" onclick="closeCelebration()">Close</button>
      </div>
    </div>

    <!-- Toast notifications -->
    <div class="toast" id="toast"></div>
  `;

  document.body.insertAdjacentHTML('beforeend', template);

  // Wire up listeners now that the popup/celebration elements exist.
  attachGlobalListeners();

  // Add click-to-close for celebration overlay
  setTimeout(() => {
    const celebrationOverlay = document.getElementById('celebration');
    if (celebrationOverlay) {
      celebrationOverlay.addEventListener('click', closeCelebration);
    }
  }, 0);
}

// ─── INITIALIZATION ────────────────────────────────────────────────────────
// Normalize a roster into the internal { name, avatar } shape.
// Dynamic tournaments store players as a simple list of nicknames (strings);
// the avatar path is a repo convention derived from the nickname. Legacy pages
// pass { name, avatar } objects, which are kept as-is.
function normalizePlayers(players) {
  return (players || []).map(p => {
    if (typeof p === 'string') {
      return { name: p, avatar: 'resources/img/' + p + '.jpeg' };
    }
    if (p && typeof p === 'object') {
      return { name: p.name, avatar: p.avatar || (p.name ? 'resources/img/' + p.name + '.jpeg' : '') };
    }
    return { name: String(p), avatar: '' };
  });
}

// Set the active roster and derive the round-robin totals.
function setPlayers(players) {
  window.PLAYERS = normalizePlayers(players);
  N = window.PLAYERS.length;
  TOTAL = (N * (N - 1)) / 2;
}

// ─── DYNAMIC HUB (Tournament 2.0) ──────────────────────────────────────────

// Case-insensitive, whitespace-trimmed nickname key (mirrors n8n/lib/bot-logic).
function normalizeNick(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

// Registry caching: keep the last good registry in localStorage so the hub can
// still render tournaments if a later Firebase read fails (offline / rules).
const REGISTRY_CACHE_KEY = 'polytournament-registry';
function cacheRegistry(reg) {
  try { localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify(reg)); } catch (e) { /* storage unavailable */ }
}
function loadCachedRegistry() {
  try {
    const s = localStorage.getItem(REGISTRY_CACHE_KEY);
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}

// Build the "Style: Glory 15k · Map: … · Bots: 14 Crazy" subtitle from a
// structured setup object stored in Firebase.
function buildSubtitle(setup, override) {
  // An explicit subtitle string wins — used to preserve the exact wording of
  // tournaments whose descriptor doesn't fit the structured setup schema
  // (e.g. the early 1v1 PvP tournaments).
  if (override) return override;
  if (!setup) return '';
  const parts = [];
  if (setup.style) {
    const style = String(setup.style).toLowerCase() === 'glory'
      ? 'Glory' + (setup.gloryTier ? ' ' + setup.gloryTier : '')
      : 'Might';
    parts.push('Style: ' + style);
  }
  if (setup.mapType) parts.push('Map: ' + setup.mapType);
  if (setup.mapSize) parts.push('Size: ' + setup.mapSize);
  if (setup.nation) parts.push('Nation: ' + setup.nation);
  if (setup.botCount != null && setup.botCount !== '') {
    parts.push('Bots: ' + setup.botCount + (setup.botDifficulty ? ' ' + setup.botDifficulty : ''));
  }
  return parts.join(' · ');
}

// Registry (Firebase `tournaments` node) → sorted array of {id, ...entry}.
function registryToList(registry) {
  return Object.entries(registry || {})
    .map(([id, t]) => Object.assign({ id }, t))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

// The tournament id currently selected via the URL hash (#t=<id>).
function currentHashTid() {
  const m = (location.hash || '').match(/[#&]t=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Resolve which dynamic tournament to show: the hash selection if valid, then
// the `latest_tournament` pointer if valid, otherwise the newest (highest-order)
// dynamic tournament. The pointer read may fail (rules) — the fallback covers it.
function resolveActiveTid(list) {
  const dynamic = list.filter(t => !t.legacy);
  const hashed = currentHashTid();
  if (hashed && dynamic.some(t => t.id === hashed)) return hashed;
  const latest = window.LATEST_TID;
  if (latest && dynamic.some(t => t.id === latest)) return latest;
  return dynamic.length ? dynamic[dynamic.length - 1].id : null;
}

function buildHubNav(list, activeTid) {
  const nav = document.getElementById('tournament-nav');
  if (!nav) return;
  nav.innerHTML = list.map(t => {
    const title = t.title || t.id;
    if (t.legacy) {
      return `<a href="${t.href}">${title}</a>`;
    }
    const active = t.id === activeTid ? ' class="active"' : '';
    return `<a href="#t=${encodeURIComponent(t.id)}"${active}>${title}</a>`;
  }).join('');
}

function setHubState(hasTournament, message) {
  const board = document.getElementById('hub-board');
  const empty = document.getElementById('hub-empty');
  if (board) board.style.display = hasTournament ? '' : 'none';
  if (empty) {
    empty.style.display = hasTournament ? 'none' : '';
    if (message) empty.textContent = message;
  }
}

function loadDynamicTournament(entry) {
  // Reset any lingering celebration from a previously viewed tournament.
  const celebration = document.getElementById('celebration');
  if (celebration) celebration.classList.remove('active');

  const title = entry.title || entry.id;
  document.title = title + ' · Polytopia Tournament';
  const h1 = document.getElementById('hub-title');
  const sub = document.getElementById('hub-subtitle');
  if (h1) h1.textContent = title;
  if (sub) sub.textContent = buildSubtitle(entry.setup, entry.subtitle);

  // `players` is the single source of truth for who is in the tournament: a plain
  // list of nickname strings. The WhatsApp bot appends to it on sign-in, and it
  // can be edited by hand in Firebase. The board renders exactly this list.
  setPlayers(entry.players || []);
  // Match results live INSIDE the registry entry, so creating a tournament is
  // just adding a child under "tournaments" — no separate node or rule per
  // tournament. (Legacy pages still use their own top-level nodes.)
  const resultsPath = 'tournaments/' + entry.id + '/results';
  window.TOURNAMENT_ID = resultsPath;

  setHubState(true);
  if (!subscribeResults(resultsPath)) {
    // No Firebase → fall back to local storage for this tournament.
    loadFromStorage();
    render();
    checkTournamentComplete();
  }
}

// Entry point for the dynamic hub (new index.html).
function initHub(firebaseConfig) {
  injectSharedTemplates();

  if (!ensureFirebaseApp(firebaseConfig)) {
    setHubState(false, 'Firebase is unavailable, so tournaments cannot be loaded.');
    return;
  }

  const route = () => {
    const registry = window.REGISTRY || {};
    const list = registryToList(registry);
    const activeTid = resolveActiveTid(list);
    buildHubNav(list, activeTid);
    if (!activeTid) {
      setHubState(false, 'No dynamic tournaments yet. Add one to the "tournaments" node in Firebase.');
      return;
    }
    loadDynamicTournament(list.find(t => t.id === activeTid));
  };

  database.ref('tournaments').on('value', (snapshot) => {
    window.REGISTRY = snapshot.val() || {};
    cacheRegistry(window.REGISTRY);
    route();
  }, (err) => {
    console.error('Failed to read tournaments registry:', err);
    // Explicit fallback: serve the last successfully-loaded registry if we have
    // one cached, otherwise show the guidance message.
    const cached = loadCachedRegistry();
    if (cached) {
      window.REGISTRY = cached;
      route();
      if (typeof showToast === 'function') showToast('⚠ Offline — showing cached tournaments');
    } else {
      setHubState(false, 'Could not read the tournament list (check Firebase rules for the "tournaments" node).');
    }
  });

  // The latest_tournament pointer is a nicety for choosing the default view.
  // It lives at the top level and may be unreadable under strict rules — if so,
  // we simply fall back to newest-by-order (see resolveActiveTid).
  database.ref('latest_tournament').on('value', (snap) => {
    const v = snap.val();
    window.LATEST_TID = (typeof v === 'string') ? v : null;
    route();
  }, () => { /* ignore: pointer is optional */ });

  window.addEventListener('hashchange', route);
}