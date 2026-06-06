// Polytopia Tournament - Common JavaScript Functions
// This file contains all the shared logic for tournament pages

// ─── GLOBAL STATE ──────────────────────────────────────────────────────────
let N, TOTAL;
let results = {};
let database, resultsRef;
let activeCell = null;
let toastTimer;

// ─── FIREBASE FUNCTIONS ────────────────────────────────────────────────────
function initFirebase(firebaseConfig, tournamentId) {
  if (typeof firebase !== 'undefined' && firebaseConfig.apiKey !== "YOUR_API_KEY") {
    try {
      // Check if Firebase app already exists, otherwise initialize
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      database = firebase.database();
      resultsRef = database.ref(tournamentId);

      // Listen for real-time updates
      resultsRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
          results = data;
          render();
          checkTournamentComplete();
        }
      });
      console.log('✓ Firebase connected');
      return true;
    } catch (e) {
      console.error('Firebase init failed:', e);
      return false;
    }
  }
  return false;
}

function autoSave() {
  if (resultsRef) {
    resultsRef.set(results).catch(e => console.error('Save failed:', e));
  } else {
    localStorage.setItem(`polytournament-results-${TOURNAMENT_ID}`, JSON.stringify(results));
  }
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

function avatarEl(idx, size) {
  const p = PLAYERS[idx];
  if (p.avatar) {
    return `<img src="${p.avatar}" width="${size}" height="${size}" style="border-radius:50%;border:2px solid var(--border);object-fit:cover;" alt="${p.name}">`;
  }
  const initials = p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const colors = ['#3a5a8a', '#5a3a8a', '#8a5a3a', '#3a8a5a', '#8a3a5a', '#5a8a3a', '#3a6a7a'];
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${colors[idx % colors.length]};display:flex;align-items:center;justify-content:center;font-family:'Cinzel',serif;font-size:${Math.round(size * 0.35)}px;color:#fff;border:2px solid var(--border);flex-shrink:0;">${initials}</div>`;
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
  renderRankings();
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

function renderRankings() {
  const stats = sortByRank(calcStats());
  let html = '';
  let displayRank = 1;
  let tieGroupStart = null;

  stats.forEach((s, idx) => {
    if (idx > 0 && s.pts === stats[idx - 1].pts && s.isTied && stats[idx - 1].isTied) {
      if (tieGroupStart === null) tieGroupStart = displayRank;
    } else {
      tieGroupStart = null;
      displayRank = idx + 1;
    }

    const rankDisplay = tieGroupStart !== null ? `T${tieGroupStart}` : `${displayRank}`;
    const tieIcon = s.isTied && idx === 0 ? ' 🤝' : '';

    html += `<tr>
      <td class="rank-no">${rankDisplay}.</td>
      <td><div class="rank-name">${avatarEl(s.idx, 42)} ${PLAYERS[s.idx].name}${tieIcon}</div></td>
      <td class="pts">${s.pts}</td>
      <td class="wins">${s.wins}</td>
      <td class="losses">${s.losses}</td>
      <td style="color:var(--muted)">${s.remaining}</td>
    </tr>`;
  });
  document.getElementById('rank-body').innerHTML = html;
}

function renderProgress() {
  let played = 0;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (results[key(i, j)]) played++;
  document.getElementById('progress-text').textContent = `${played} / ${TOTAL}`;
  document.getElementById('progress-fill').style.width = `${(played / TOTAL * 100).toFixed(1)}%`;
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
document.getElementById('popup').addEventListener('click', e => {
  if (e.target === document.getElementById('popup')) closePopup();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('popup').classList.contains('active')) {
    closePopup();
  }
});

// ─── INITIALIZATION ────────────────────────────────────────────────────────
function initTournament(players, tournamentId, firebaseConfig) {
  // Set globals
  window.PLAYERS = players;
  window.TOURNAMENT_ID = tournamentId;
  N = players.length;
  TOTAL = (N * (N - 1)) / 2;

  // Try Firebase first, fallback to localStorage
  const firebaseConnected = initFirebase(firebaseConfig, tournamentId);

  if (!firebaseConnected) {
    loadFromStorage();
  }

  // Initial render
  render();
  checkTournamentComplete();
}