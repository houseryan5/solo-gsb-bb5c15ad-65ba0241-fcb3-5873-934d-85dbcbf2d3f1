/* ============================================================
 * 剧场排练走位工具 —— 原生 JavaScript
 * 网格：8 列（x: 0~7，左→右）× 6 行（y: 0~5，后台→前台）
 * 第 0 拍为起点；第 N 拍的动作把演员从第 N-1 拍位置移动到第 N 拍
 * ============================================================ */

'use strict';

const COLS = 8;
const ROWS = 6;
const STORAGE_KEY = 'stage-blocking-tool:v1';
const MAX_BEATS = 60;

// 舞台方位：上 = 向后台（y 减小），下 = 向观众（y 增大）
const DIRS = {
  U: { dx: 0, dy: -1, label: '上 ↑' },
  D: { dx: 0, dy: 1, label: '下 ↓' },
  L: { dx: -1, dy: 0, label: '左 ←' },
  R: { dx: 1, dy: 0, label: '右 →' },
  S: { dx: 0, dy: 0, label: '原地 —' }
};
const DIR_ORDER = ['S', 'U', 'D', 'L', 'R'];

const PALETTE = [
  '#e8b84b', '#7ed0ff', '#8ee08a', '#f28ba8',
  '#c3a6ff', '#ffab73', '#5ee0c9', '#f5d06a',
  '#9aa7ff', '#f07878'
];

/* ---------------- 示例数据（内含撞格 + 互换 + 越界拦截演示） ---------------- */
// 看点（推演验证过）：
// 第 3 拍：甲、乙撞格 (列3,行3)
// 第 7 拍：甲 (列3,行2) 与乙 (列2,行2) 互换格子
// 第 8 拍：丙在 (列5,行1) 执行“上 ↑”越出后台边界，被拦截停留原位
function makeDemo() {
  return {
    beats: 8,
    actors: [
      {
        id: 'a1', name: '甲', start: { x: 1, y: 2 },
        moves: ['R', 'R', 'L', 'S', 'U', 'L', 'R', 'U']
      },
      {
        id: 'a2', name: '乙', start: { x: 3, y: 2 },
        moves: ['U', 'L', 'D', 'U', 'R', 'L', 'L', 'U']
      },
      {
        id: 'a3', name: '丙', start: { x: 6, y: 4 },
        moves: ['L', 'L', 'U', 'U', 'U', 'U', 'S', 'U']
      }
    ]
  };
}

/* ---------------- 状态与持久化 ---------------- */
let state = null;
let currentBeat = 0;
let placingActorId = null;   // 正在设置起点的演员
let focus = null;            // 当前定位的冲突/拦截
let saveTimer = null;
let playTimer = null;
let lastSim = null;          // 最近一次推演结果缓存

function uid() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  let beats = parseInt(s.beats, 10);
  if (!Number.isFinite(beats) || beats < 1) beats = 8;
  beats = Math.min(MAX_BEATS, Math.max(1, beats));

  const actors = Array.isArray(s.actors) ? s.actors : [];
  const seen = new Set();
  const normActors = actors.map((a, i) => {
    let id = typeof a.id === 'string' && a.id && !seen.has(a.id) ? a.id : uid();
    seen.add(id);
    const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 12) : `演员${i + 1}`;
    let start = null;
    if (a.start && Number.isInteger(a.start.x) && Number.isInteger(a.start.y) &&
        a.start.x >= 0 && a.start.x < COLS && a.start.y >= 0 && a.start.y < ROWS) {
      start = { x: a.start.x, y: a.start.y };
    }
    const moves = Array.isArray(a.moves) ? a.moves : [];
    const normMoves = [];
    for (let b = 0; b < beats; b++) {
      normMoves.push(DIRS[moves[b]] ? moves[b] : 'S');
    }
    return { id, name, start, moves: normMoves };
  });
  return { beats, actors: normActors };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn('本地走位表读取失败，使用示例数据', e);
  }
  return normalize(makeDemo());
}

function scheduleSave() {
  const el = document.getElementById('saveState');
  el.textContent = '保存中…';
  el.classList.remove('saved');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      el.textContent = '已本地保存 ✓';
      el.classList.add('saved');
    } catch (e) {
      el.textContent = '保存失败';
      toast('本地保存失败：' + e.message, true);
    }
  }, 300);
}

/* ---------------- 推演引擎 ---------------- */
function simulate() {
  // positions[beat]: actorId -> {x,y}（未设起点的演员不在 Map 中）
  const positions = [new Map()];
  let loc = new Map();
  for (const a of state.actors) if (a.start) loc.set(a.id, { ...a.start });
  positions[0] = new Map(loc);

  const blocked = []; // {actorId, beat, dir, from:{x,y}}

  for (let beat = 1; beat <= state.beats; beat++) {
    const next = new Map(loc);
    for (const a of state.actors) {
      const cur = loc.get(a.id);
      const dir = a.moves[beat - 1] || 'S';
      if (!cur) continue;
      if (dir === 'S') { next.set(a.id, { ...cur }); continue; }
      const d = DIRS[dir];
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
        // 越界拦截：停留原位
        blocked.push({ actorId: a.id, beat, dir, from: { ...cur } });
        next.set(a.id, { ...cur });
      } else {
        next.set(a.id, { x: nx, y: ny });
      }
    }
    positions.push(next);
    loc = next;
  }

  const collisions = []; // {beat, cell, actorIds}
  const swaps = [];      // {beat, aId, bId, cellA, cellB}

  for (let beat = 1; beat <= state.beats; beat++) {
    const cur = positions[beat];
    const prev = positions[beat - 1];

    // 同拍同格
    const byCell = new Map();
    for (const [id, p] of cur) {
      const key = p.x + ',' + p.y;
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key).push(id);
    }
    for (const [key, ids] of byCell) {
      if (ids.length > 1) {
        const [x, y] = key.split(',').map(Number);
        collisions.push({ beat, cell: { x, y }, actorIds: ids });
      }
    }

    // 相邻两拍互换格子
    const ids = [...cur.keys()];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const aId = ids[i], bId = ids[j];
        const ca = cur.get(aId), cb = cur.get(bId);
        const pa = prev.get(aId), pb = prev.get(bId);
        if (!pa || !pb) continue;
        if (pa.x === cb.x && pa.y === cb.y && pb.x === ca.x && pb.y === ca.y &&
            (ca.x !== cb.x || ca.y !== cb.y)) {
          swaps.push({ beat, aId, bId, cellA: { ...ca }, cellB: { ...cb } });
        }
      }
    }
  }

  return { positions, blocked, collisions, swaps };
}

/* ---------------- DOM 引用 ---------------- */
const stageEl = document.getElementById('stage');
const beatSlider = document.getElementById('beatSlider');
const beatLabel = document.getElementById('beatLabel');
const focusBar = document.getElementById('focusBar');
const beatsInput = document.getElementById('beatsInput');
const actorListEl = document.getElementById('actorList');
const conflictListEl = document.getElementById('conflictList');
const timelineHead = document.querySelector('#timelineTable thead');
const timelineBody = document.querySelector('#timelineTable tbody');
const toastEl = document.getElementById('toast');

/* ---------------- 工具 ---------------- */
function actorName(id) {
  const a = state.actors.find((x) => x.id === id);
  return a ? a.name : '?';
}
function actorColor(id) {
  const i = state.actors.findIndex((x) => x.id === id);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}
const cellKey = (x, y) => x + ',' + y;
const coordText = (p) => `(${p.x + 1}, ${p.y + 1})`; // 1 基：列·行

let toastTimer = null;
function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', isError);
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

/* ---------------- 舞台渲染 ---------------- */
function buildStage() {
  stageEl.innerHTML = '';
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = document.createElement('div');
      c.className = 'cell';
      c.dataset.x = x;
      c.dataset.y = y;
      const coord = document.createElement('span');
      coord.className = 'cell-coord';
      coord.textContent = `${x + 1}·${y + 1}`;
      c.appendChild(coord);
      c.addEventListener('click', () => onCellClick(x, y));
      stageEl.appendChild(c);
    }
  }
}

function renderStage() {
  const sim = lastSim;
  const loc = sim.positions[currentBeat];
  const blockedAtBeat = new Set(sim.blocked.filter((b) => b.beat === currentBeat).map((b) => b.actorId));

  // 当前拍的冲突索引
  const collisionCells = new Map(); // key -> actorIds
  for (const c of sim.collisions) {
    if (c.beat !== currentBeat) continue;
    collisionCells.set(cellKey(c.cell.x, c.cell.y), c.actorIds);
  }
  const swapCells = new Map(); // key -> swap
  for (const s of sim.swaps) {
    if (s.beat !== currentBeat) continue;
    swapCells.set(cellKey(s.cellA.x, s.cellA.y), s);
    swapCells.set(cellKey(s.cellB.x, s.cellB.y), s);
  }

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const el = stageEl.children[y * COLS + x];
      const key = cellKey(x, y);
      el.innerHTML = '';
      const coord = document.createElement('span');
      coord.className = 'cell-coord';
      coord.textContent = `${x + 1}·${y + 1}`;
      el.appendChild(coord);

      const classes = ['cell'];
      if (placingActorId) classes.push('clickable');
      if (collisionCells.has(key)) classes.push('collision');
      if (swapCells.has(key)) classes.push('swap');
      if (focus && focus.beat === currentBeat && focus.cells.some((p) => p.x === x && p.y === y)) {
        classes.push('focused');
      }
      el.className = classes.join(' ');

      // 演员棋子
      for (const [id, p] of loc) {
        if (p.x !== x || p.y !== y) continue;
        const chip = document.createElement('span');
        chip.className = 'actor-chip';
        chip.style.background = actorColor(id);
        chip.title = `${actorName(id)}：列 ${x + 1} / 行 ${y + 1}（点击可重设起点）`;
        chip.innerHTML = '';
        const nm = document.createElement('span');
        nm.textContent = actorName(id);
        chip.appendChild(nm);
        if (blockedAtBeat.has(id)) {
          const bl = document.createElement('small');
          bl.textContent = '🚫';
          bl.title = '该演员本拍动作越界，已被拦截';
          chip.appendChild(bl);
        }
        chip.addEventListener('click', (ev) => {
          ev.stopPropagation();
          startPlacing(id);
        });
        el.appendChild(chip);
      }

      // 越界角标（格子左上角，同格只显示一次）
      let blockedHere = false;
      for (const id of blockedAtBeat) {
        const p = loc.get(id);
        if (p && p.x === x && p.y === y) { blockedHere = true; break; }
      }
      if (blockedHere) {
        const m = document.createElement('span');
        m.className = 'blocked-mark';
        m.textContent = '越界拦截';
        el.appendChild(m);
      }

      // 冲突徽标
      const badges = document.createElement('div');
      badges.className = 'cell-badges';
      if (collisionCells.has(key)) {
        const b = document.createElement('span');
        b.className = 'badge collision';
        b.textContent = '撞格';
        badges.appendChild(b);
      }
      if (swapCells.has(key)) {
        const b = document.createElement('span');
        b.className = 'badge swap';
        b.textContent = '互换';
        badges.appendChild(b);
      }
      if (badges.children.length) el.appendChild(badges);
    }
  }
}

function onCellClick(x, y) {
  if (!placingActorId) return;
  const actor = state.actors.find((a) => a.id === placingActorId);
  if (!actor) { placingActorId = null; document.body.classList.remove('placing'); renderStage(); return; }
  actor.start = { x, y };
  currentBeat = 0; // 起点属于第 0 拍
  setFocus(null);
  toast(`已将「${actor.name}」的起点设为 ${coordText({ x, y })}`);
  placingActorId = null;
  document.body.classList.remove('placing');
  persistAndRender();
}

/* ---------------- 演员列表 ---------------- */
function renderActors() {
  actorListEl.innerHTML = '';
  if (state.actors.length === 0) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.textContent = '还没有演员，请在上方添加。';
    actorListEl.appendChild(li);
    return;
  }
  for (const a of state.actors) {
    const li = document.createElement('li');
    li.className = 'actor-item' + (a.start ? '' : ' unplaced');

    const dot = document.createElement('span');
    dot.className = 'actor-dot';
    dot.style.background = actorColor(a.id);
    li.appendChild(dot);

    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = a.name;
    li.appendChild(nm);

    const pos = document.createElement('span');
    pos.className = 'start-pos';
    pos.textContent = a.start ? `起 ${coordText(a.start)}` : '未设起点';
    li.appendChild(pos);

    const placeBtn = document.createElement('button');
    placeBtn.type = 'button';
    placeBtn.className = 'btn btn-small' + (placingActorId === a.id ? ' active' : '');
    placeBtn.textContent = placingActorId === a.id ? '点击舞台…' : '设起点';
    placeBtn.addEventListener('click', () => {
      if (placingActorId === a.id) startPlacing(null);
      else startPlacing(a.id);
    });
    li.appendChild(placeBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-small danger';
    delBtn.textContent = '删';
    delBtn.title = '删除演员';
    delBtn.addEventListener('click', () => {
      if (!confirm(`确定删除演员「${a.name}」及其全部走位吗？`)) return;
      state.actors = state.actors.filter((x) => x.id !== a.id);
      if (placingActorId === a.id) startPlacing(null);
      setFocus(null);
      persistAndRender();
    });
    li.appendChild(delBtn);

    actorListEl.appendChild(li);
  }
}

function startPlacing(id) {
  placingActorId = id;
  document.body.classList.toggle('placing', !!id);
  if (id) toast(`请在舞台上点击「${actorName(id)}」的起点格子`);
  renderActors();
  renderStage();
}

/* ---------------- 走位表 ---------------- */
function renderTimeline() {
  // 表头
  const headTr = document.createElement('tr');
  const thActor = document.createElement('th');
  thActor.className = 'row-actor';
  thActor.textContent = '演员 ＼ 拍';
  headTr.appendChild(thActor);
  const thStart = document.createElement('th');
  thStart.textContent = '起点(第0拍)';
  headTr.appendChild(thStart);
  for (let b = 1; b <= state.beats; b++) {
    const th = document.createElement('th');
    th.textContent = '第' + b + '拍';
    headTr.appendChild(th);
  }
  timelineHead.innerHTML = '';
  timelineHead.appendChild(headTr);

  // 冲突索引
  const markMap = new Map(); // actorId:beat -> 'collision' | 'swap'
  for (const c of lastSim.collisions) {
    for (const id of c.actorIds) markMap.set(id + ':' + c.beat, 'cell-collision');
  }
  for (const s of lastSim.swaps) {
    markMap.set(s.aId + ':' + s.beat, 'cell-swap');
    markMap.set(s.bId + ':' + s.beat, 'cell-swap');
  }
  const blockedSet = new Set(lastSim.blocked.map((b) => b.actorId + ':' + b.beat));

  timelineBody.innerHTML = '';
  for (const a of state.actors) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.className = 'row-actor';
    const dot = document.createElement('span');
    dot.className = 'actor-dot';
    dot.style.background = actorColor(a.id);
    dot.style.display = 'inline-block';
    dot.style.verticalAlign = 'middle';
    dot.style.marginRight = '6px';
    tdName.appendChild(dot);
    tdName.appendChild(document.createTextNode(a.name));
    tr.appendChild(tdName);

    const tdStart = document.createElement('td');
    tdStart.textContent = a.start ? coordText(a.start) : '— 未设 —';
    if (!a.start) tdStart.style.color = 'var(--danger)';
    tr.appendChild(tdStart);

    for (let b = 1; b <= state.beats; b++) {
      const td = document.createElement('td');
      const sel = document.createElement('select');
      sel.title = `第 ${b} 拍：${a.name} 的动作`;
      for (const d of DIR_ORDER) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = DIRS[d].label;
        if ((a.moves[b - 1] || 'S') === d) opt.selected = true;
        sel.appendChild(opt);
      }
      const isBlocked = blockedSet.has(a.id + ':' + b);
      if (isBlocked) {
        sel.classList.add('blocked');
        sel.title = `第 ${b} 拍动作越界（从舞台边缘继续外移），已被拦截，演员停留原位`;
      }
      sel.dataset.actor = a.id;
      sel.dataset.beat = b;
      sel.addEventListener('change', onMoveChange);
      td.appendChild(sel);

      const mark = markMap.get(a.id + ':' + b);
      if (mark) td.classList.add(mark);
      if (b === currentBeat) td.classList.add('cell-current-beat');
      tr.appendChild(td);
    }
    timelineBody.appendChild(tr);
  }
}

function onMoveChange(ev) {
  const sel = ev.target;
  const actorId = sel.dataset.actor;
  const beat = parseInt(sel.dataset.beat, 10);
  const dir = sel.value;
  const actor = state.actors.find((a) => a.id === actorId);
  if (!actor) return;

  if (!actor.start) {
    toast(`请先为「${actor.name}」设置起点，再指定走位动作`, true);
    sel.value = actor.moves[beat - 1] || 'S';
    return;
  }

  // 基于第 beat-1 拍的实际位置做越界预判
  const from = lastSim.positions[beat - 1].get(actorId);
  actor.moves[beat - 1] = dir;

  // 重新推演以判定是否拦截
  const trial = simulate();
  const blocked = trial.blocked.find((b) => b.actorId === actorId && b.beat === beat);
  if (dir !== 'S' && blocked) {
    toast(`🚫 越界拦截：第 ${beat} 拍「${actor.name}」位于 ${coordText(from)} ，无法再向${DIRS[dir].label.slice(0, 1)}移动，停留原位`, true);
  }

  // 切到该拍并重新推演渲染，保持用户正在操作的下拉框上下文
  currentBeat = beat;
  setFocus(null);
  persistAndRender();
}

/* ---------------- 冲突列表 ---------------- */
function renderConflicts() {
  conflictListEl.innerHTML = '';
  const items = [];
  for (const c of lastSim.collisions) {
    items.push({
      kind: 'collision', beat: c.beat, sortKey: '1',
      text: `第 ${c.beat} 拍 · 撞格：${c.actorIds.map(actorName).join('、')} 同在 ${coordText(c.cell)}`,
      cells: [c.cell], actorIds: c.actorIds
    });
  }
  for (const s of lastSim.swaps) {
    items.push({
      kind: 'swap', beat: s.beat, sortKey: '2',
      text: `第 ${s.beat} 拍 · 互换：${actorName(s.aId)} ${coordText(s.cellA)} ⇄ ${actorName(s.bId)} ${coordText(s.cellB)}`,
      cells: [s.cellA, s.cellB], actorIds: [s.aId, s.bId]
    });
  }
  for (const b of lastSim.blocked) {
    items.push({
      kind: 'blocked', beat: b.beat, sortKey: '0',
      text: `第 ${b.beat} 拍 · 越界拦截：${actorName(b.actorId)} 在 ${coordText(b.from)} 执行「${DIRS[b.dir].label}」，停留原位`,
      cells: [b.from], actorIds: [b.actorId]
    });
  }
  items.sort((a, b) => a.beat - b.beat || a.sortKey.localeCompare(b.sortKey));

  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'conflict-empty';
    li.textContent = '✓ 全部拍次推演完成：无撞格、无互换、无越界。';
    conflictListEl.appendChild(li);
    return;
  }

  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'conflict-item';
    if (focus && focus.beat === it.beat &&
        focus.kind === it.kind &&
        focus.cells.length === it.cells.length &&
        focus.cells.every((c, i) => c.x === it.cells[i].x && c.y === it.cells[i].y)) {
      li.classList.add('current');
    }
    const tag = document.createElement('span');
    tag.className = 'ctype ' + ({ collision: '撞格', swap: '互换', blocked: '越界' }[it.kind]);
    tag.textContent = { collision: '撞格', swap: '互换', blocked: '越界' }[it.kind];
    li.appendChild(tag);
    const txt = document.createElement('span');
    txt.textContent = it.text.replace(/^第 \d+ 拍 · /, '');
    li.appendChild(txt);
    li.addEventListener('click', () => gotoConflict(it));
    li.title = '点击定位到第 ' + it.beat + ' 拍舞台位置';
    conflictListEl.appendChild(li);
  }
}

function gotoConflict(it) {
  stopPlay();
  currentBeat = it.beat;
  setFocus({
    kind: it.kind,
    beat: it.beat,
    cells: it.cells,
    actorIds: it.actorIds,
    text: it.text
  });
  updateBeatUI();
  renderStage();
  renderTimeline();
  renderConflicts();
  renderFocusBar();
}

/* ---------------- 定位信息条 ---------------- */
function setFocus(f) { focus = f; }

function renderFocusBar() {
  if (!focus || focus.beat !== currentBeat) {
    focusBar.classList.add('hidden');
    return;
  }
  focusBar.classList.remove('hidden');
  focusBar.classList.toggle('danger-focus', focus.kind === 'collision');
  focusBar.classList.toggle('swap-focus', focus.kind === 'swap');
  const names = focus.actorIds.map(actorName).join('、');
  let prefix;
  if (focus.kind === 'collision') prefix = '🎯 撞格定位';
  else if (focus.kind === 'swap') prefix = '🔁 互换定位';
  else prefix = '🚫 越界定位';
  focusBar.textContent = `${prefix}｜第 ${focus.beat} 拍｜演员：${names}｜格子：${focus.cells.map(coordText).join(' 与 ')}`;
}

/* ---------------- 节拍控制 ---------------- */
function updateBeatUI() {
  beatSlider.max = state.beats;
  beatSlider.value = currentBeat;
  beatsInput.value = state.beats;
  beatLabel.textContent = currentBeat === 0
    ? `第 0 拍 / 共 ${state.beats} 拍（起点）`
    : `第 ${currentBeat} 拍 / 共 ${state.beats} 拍`;
}

function gotoBeat(b) {
  stopPlay();
  currentBeat = Math.max(0, Math.min(state.beats, b));
  updateBeatUI();
  renderStage();
  renderTimeline();
  renderFocusBar();
}

function stopPlay() {
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  document.getElementById('playBtn').textContent = '▶';
}

function togglePlay() {
  if (playTimer) { stopPlay(); return; }
  if (currentBeat >= state.beats) currentBeat = 0;
  document.getElementById('playBtn').textContent = '⏸';
  playTimer = setInterval(() => {
    if (currentBeat >= state.beats) { stopPlay(); return; }
    currentBeat++;
    updateBeatUI();
    renderStage();
    renderTimeline();
    renderFocusBar();
  }, 800);
}

function applyBeats() {
  let n = parseInt(beatsInput.value, 10);
  if (!Number.isFinite(n)) { beatsInput.value = state.beats; return; }
  n = Math.min(MAX_BEATS, Math.max(1, n));
  state.beats = n;
  for (const a of state.actors) {
    while (a.moves.length < n) a.moves.push('S');
    if (a.moves.length > n) a.moves.length = n;
  }
  if (currentBeat > n) currentBeat = n;
  setFocus(null);
  persistAndRender();
}

/* ---------------- 演员增删 ---------------- */
function addActor() {
  const input = document.getElementById('actorName');
  const name = input.value.trim();
  const a = {
    id: uid(),
    name: name || `演员${state.actors.length + 1}`,
    start: null,
    moves: new Array(state.beats).fill('S')
  };
  state.actors.push(a);
  input.value = '';
  setFocus(null);
  persistAndRender();
  startPlacing(a.id);
}

/* ---------------- 导入 / 导出 / 重置 ---------------- */
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `stage-blocking-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = normalize(JSON.parse(reader.result));
      currentBeat = 0;
      setFocus(null);
      startPlacing(null);
      persistAndRender();
      toast(`已导入走位表：${state.actors.length} 名演员，共 ${state.beats} 拍`);
    } catch (e) {
      toast('导入失败：JSON 文件格式不正确', true);
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm('确定清空本地走位表并恢复为内置示例吗？')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = normalize(makeDemo());
  currentBeat = 0;
  setFocus(null);
  startPlacing(null);
  persistAndRender();
  toast('已重置为示例走位表');
}

/* ---------------- 总渲染 ---------------- */
function persistAndRender() {
  lastSim = simulate();
  if (currentBeat > state.beats) currentBeat = state.beats;
  scheduleSave();
  renderAll();
}

function renderAll() {
  if (!lastSim) lastSim = simulate();
  updateBeatUI();
  renderStage();
  renderActors();
  renderTimeline();
  renderConflicts();
  renderFocusBar();
}

/* ---------------- 事件绑定与启动 ---------------- */
function bindEvents() {
  document.getElementById('firstBtn').addEventListener('click', () => gotoBeat(0));
  document.getElementById('prevBtn').addEventListener('click', () => gotoBeat(currentBeat - 1));
  document.getElementById('nextBtn').addEventListener('click', () => gotoBeat(currentBeat + 1));
  document.getElementById('lastBtn').addEventListener('click', () => gotoBeat(state.beats));
  document.getElementById('playBtn').addEventListener('click', togglePlay);
  beatSlider.addEventListener('input', () => gotoBeat(parseInt(beatSlider.value, 10)));
  document.getElementById('applyBeatsBtn').addEventListener('click', applyBeats);
  beatsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyBeats(); });

  document.getElementById('addActorBtn').addEventListener('click', addActor);
  document.getElementById('actorName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addActor();
  });

  document.getElementById('exportBtn').addEventListener('click', exportJSON);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('resetBtn').addEventListener('click', resetAll);

  // 键盘方向键快速切换拍
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') gotoBeat(currentBeat - 1);
    if (e.key === 'ArrowRight') gotoBeat(currentBeat + 1);
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  });
}

buildStage();
state = loadState();
// 首次写入本地，刷新后浏览器即为当前走位表
try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
bindEvents();
renderAll();
