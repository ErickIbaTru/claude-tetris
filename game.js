'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#9e9e9e', // N - tuerca (gris metálico)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N (tuerca)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');

const pauseMenu = document.getElementById('pause-menu');
const resumeBtn = document.getElementById('resume-btn');
const pauseRestartBtn = document.getElementById('pause-restart-btn');
const controlsBtn = document.getElementById('controls-btn');
const pauseControls = document.getElementById('pause-controls');
const startLevelSel = document.getElementById('start-level');

let startLevel = 1;
try { startLevel = Math.min(10, Math.max(1, parseInt(localStorage.getItem('tetris-start-level'), 10) || 1)); } catch (e) {}
let resumeGuard = 0;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo = 0, maxCombo = 0, onStartScreen = true, newRecordIndex = -1;

const RECORDS_KEY = 'tetris-records';
const NAME_KEY = 'tetris-player-name';
const MAX_RECORDS = 5;
const recordMsg = document.getElementById('record-msg');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('player-name');
const saveRecordBtn = document.getElementById('save-record-btn');
const overlayRecords = document.getElementById('overlay-records');
const startScreen = document.getElementById('start-screen');
const startRecords = document.getElementById('start-records');
const playBtn = document.getElementById('play-btn');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const bestComboEl = document.getElementById('best-combo');
const maxLinesEl = document.getElementById('max-lines');

function loadRecords() {
  const empty = { top: [], bestCombo: 0, maxLines: 0 };
  try {
    const r = JSON.parse(localStorage.getItem(RECORDS_KEY));
    if (!r || !Array.isArray(r.top)) return empty;
    return {
      top: r.top.slice(0, MAX_RECORDS),
      bestCombo: Number(r.bestCombo) || 0,
      maxLines: Number(r.maxLines) || 0,
    };
  } catch (e) {
    return empty;
  }
}

function saveRecords(r) {
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(r)); } catch (e) { /* sin almacenamiento */ }
}

function qualifies(s) {
  const top = loadRecords().top;
  return s > 0 && (top.length < MAX_RECORDS || s > top[top.length - 1].score);
}

// Inserta la entrada y devuelve su posición en el top (-1 si no entra)
function addRecord(entry) {
  const r = loadRecords();
  r.top.push(entry);
  r.top.sort((a, b) => b.score - a.score);
  const idx = r.top.indexOf(entry);
  r.top = r.top.slice(0, MAX_RECORDS);
  saveRecords(r);
  return idx < MAX_RECORDS ? idx : -1;
}

function resetRecords() {
  saveRecords({ top: [], bestCombo: 0, maxLines: 0 });
}

function renderRecords(listEl, highlightIndex) {
  const top = loadRecords().top;
  listEl.innerHTML = '';
  if (!top.length) {
    const li = document.createElement('li');
    li.className = 'record-empty';
    li.textContent = 'Sin records todavía';
    listEl.appendChild(li);
    return;
  }
  top.forEach((rec, i) => {
    const li = document.createElement('li');
    if (i === highlightIndex) li.className = 'record-new';
    const name = document.createElement('span');
    name.textContent = rec.name;
    const pts = document.createElement('span');
    pts.textContent = Number(rec.score).toLocaleString();
    li.append(name, pts);
    li.title = `${rec.lines} líneas · combo ${rec.combo} · ${rec.date}`;
    listEl.appendChild(li);
  });
}

function showStartScreen() {
  onStartScreen = true;
  const r = loadRecords();
  renderRecords(startRecords, -1);
  bestComboEl.textContent = r.bestCombo;
  maxLinesEl.textContent = r.maxLines;
  startScreen.classList.remove('hidden');
}

function submitRecord() {
  const name = nameInput.value.trim() || 'Anónimo';
  try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* ignorar */ }
  newRecordIndex = addRecord({
    name, score, lines, combo: maxCombo, date: new Date().toISOString().slice(0, 10),
  });
  nameEntry.classList.add('hidden');
  recordMsg.textContent = '¡Nuevo récord!';
  renderRecords(overlayRecords, newRecordIndex);
  restartBtn.focus();
}

function calcInterval(lvl) {
  return Math.max(100, 1000 - (lvl - 1) * 90);
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 8) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.max(startLevel, Math.floor(lines / 10) + 1);
    dropInterval = calcInterval(level);
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  if (clearLines() > 0) {
    combo++;
    maxCombo = Math.max(maxCombo, combo);
  } else {
    combo = 0;
  }
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--grid-line').trim();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  const r = loadRecords();
  r.bestCombo = Math.max(r.bestCombo, maxCombo);
  r.maxLines = Math.max(r.maxLines, lines);
  saveRecords(r);
  recordMsg.textContent = '';
  overlay.classList.remove('hidden');
  if (qualifies(score)) {
    overlayRecords.innerHTML = '';
    nameEntry.classList.remove('hidden');
    try { nameInput.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { nameInput.value = ''; }
    nameInput.focus();
    nameInput.select();
  } else {
    nameEntry.classList.add('hidden');
    renderRecords(overlayRecords, -1);
  }
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    pauseMenu.classList.add('hidden');
    if (document.activeElement) document.activeElement.blur();
    resumeGuard = performance.now() + 150;
    lastTime = performance.now();
    dropAccum = 0;
    animId = requestAnimationFrame(loop);
  } else {
    cancelAnimationFrame(animId);
    startLevelSel.value = startLevel;
    pauseMenu.classList.remove('hidden');
    resumeBtn.focus();
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  if (gameOver) return;
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = startLevel;
  paused = false;
  gameOver = false;
  combo = 0;
  maxCombo = 0;
  onStartScreen = false;
  startScreen.classList.add('hidden');
  nameEntry.classList.add('hidden');
  recordMsg.textContent = '';
  overlayRecords.innerHTML = '';
  dropInterval = calcInterval(level);
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  pauseMenu.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.target === nameInput) return;
  if (onStartScreen) {
    if (e.code === 'Enter' && e.target.tagName !== 'BUTTON') init();
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
  if (paused || gameOver || performance.now() < resumeGuard) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);
resumeBtn.addEventListener('click', togglePause);
pauseRestartBtn.addEventListener('click', () => {
  if (document.activeElement) document.activeElement.blur();
  init();
});
controlsBtn.addEventListener('click', () => {
  const open = pauseControls.classList.toggle('hidden') === false;
  controlsBtn.setAttribute('aria-expanded', open);
  controlsBtn.textContent = open ? 'Ocultar controles' : 'Ver controles';
});
startLevelSel.addEventListener('change', () => {
  startLevel = parseInt(startLevelSel.value, 10);
  try { localStorage.setItem('tetris-start-level', startLevel); } catch (e) {}
});
playBtn.addEventListener('click', init);
saveRecordBtn.addEventListener('click', submitRecord);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitRecord(); });
resetRecordsBtn.addEventListener('click', () => {
  if (confirm('¿Borrar todos los records?')) {
    resetRecords();
    showStartScreen();
  }
});

const themeToggle = document.getElementById('theme-toggle');
const toggleIcon = themeToggle.querySelector('.toggle-icon');
const toggleLabel = themeToggle.querySelector('.toggle-label');

function applyTheme(isLight) {
  if (isLight) {
    document.body.classList.add('light-mode');
    toggleIcon.textContent = '☀';
    toggleLabel.textContent = 'DARK';
  } else {
    document.body.classList.remove('light-mode');
    toggleIcon.textContent = '☾';
    toggleLabel.textContent = 'LIGHT';
  }
}

const savedTheme = localStorage.getItem('tetris-theme');
applyTheme(savedTheme === 'light');

themeToggle.addEventListener('click', () => {
  const isLight = !document.body.classList.contains('light-mode');
  applyTheme(isLight);
  localStorage.setItem('tetris-theme', isLight ? 'light' : 'dark');
});

showStartScreen();
