/* game.js — core game logic (no CSS/HTML) */
(() => {
  'use strict';

  // ====== CONFIG / CONSTANTS ======
  const W = 16, H = 12; // board size

  const T = Object.freeze({
    FOREST: 'forest', EDGE: 'edge', CLEAR: 'clear', FARM: 'farm', CHAR: 'char',
    VILL: 'vill', HUT: 'hut', REPLANT: 'replant', FIRE: 'firebreak', BURN: 'burn'
  });

  const EMO = Object.freeze({
    forest: '🌲', edge: '🪵', clear: '🟫', farm: '🌾', char: '🔥',
    vill: '🏘️', hut: '🏠', replant: '🌱', firebreak: '🚧', burn: '🔥'
  });

  const P = Object.freeze({ FARMER: 'farmer', CHAR: 'char', ENT: 'ent', GUARD: 'guard' });
  const P_EMO = Object.freeze({ farmer: '👨‍🌾', char: '🧑‍🏭', ent: '🧑‍💼', guard: '🧑‍🌱' });

  // ====== STATE ======
  const S = {
    grid: new Array(W * H),
    people: [],
    villages: [],
    money: 50, gov: 3, soc: 3,
    community: 0, morale: 0.65,
    year: 1, period: 1, tick: 0, ticksPer: 8, spawnRate: 2,
    tenure: false, consolidate: false, erActive: false, erCooldown: 0,
    lastForestShare: 1, foodPctLast: 1, redForestStreak: 0, redFoodStreak: 0,
    periodIncomeTreasury: 0, periodIncomeCommunity: 0,
    periodReplants: 0, periodDeters: 0, periodConsolidated: 0, periodFiresOut: 0,
    councilUsed: {}
  };

  const HIST = { forest: [], food: [], community: [], pop: [] };

  // ====== DOM ======
  const $ = (id) => document.getElementById(id);
  const el = {
    board: $('board'), season: $('season'), log: $('log'), summary: $('summary'), testbar: $('testbar'),
    statForest: $('statForest'), statFood: $('statFood'), statComm: $('statComm'),
    statMoney: $('statMoney'), statGov: $('statGov'), statSoc: $('statSoc'),
    statER: $('statER'), pillER: $('pillER'), pillForest: $('pillForest'), pillFood: $('pillFood'),
    council: $('councilModal'), chart: $('trend'),
    ticksPer: $('ticksPer'), ticksLbl: $('ticksLbl'),
    spawnRate: $('spawnRate'), spawnLbl: $('spawnLbl'),
    btnTick: $('btnTick'), btnRun: $('btnRun'), btnCouncil: $('btnCouncil'), closeCouncil: $('closeCouncil'),
    toolFirebreak: $('toolFirebreak'), toolReplant: $('toolReplant'), toolGuardian: $('toolGuardian'),
    toolProtect: $('toolProtect'), toolInspect: $('toolInspect'),
  };

  // set board width CSS var used by styles.css
  if (el.board) el.board.style.setProperty('--w', W);

  // ====== HELPERS ======
  const idx = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const n4 = (x, y) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => inb(a, b));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function makeTile(type) {
    return {
      type, age: 0, degraded: 0,
      firebreak: false, prevTypeFB: null,
      replantedAge: 0, x: 0, y: 0,
      hasGuardian: false, protected: false,
      burning: false, prevType: null
    };
  }

  function tileAt(x, y) {
    if (!inb(x, y)) return null;
    const i = idx(x, y);
    let t = S.grid[i];
    if (!t) {
      t = makeTile(T.FOREST);
      t.x = x; t.y = y;
      S.grid[i] = t;
    }
    return t;
  }

  function makePerson(kind) {
    const v = S.villages[Math.floor(Math.random() * S.villages.length)] || { x: Math.floor(W / 2), y: Math.floor(H / 2) };
    return { kind, x: v.x, y: v.y, hired: false, wealth: 0, valueChain: false };
  }

  function log(msg) {
    const line = document.createElement('div');
    line.innerHTML = msg;
    el.log.prepend(line);
  }

  const toggleRed = (elem, isRed) => elem?.classList.toggle('red', !!isRed);

  // ====== INIT ======
  function init() {
    // base forest
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = makeTile(T.FOREST); t.x = x; t.y = y; S.grid[idx(x, y)] = t;
    }
    // village center + huts
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2); const village = [];
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (!inb(x, y)) continue;
      const t = makeTile((x === cx && y === cy) ? T.VILL : T.CLEAR);
      t.x = x; t.y = y; S.grid[idx(x, y)] = t; village.push({ x, y });
    }
    S.villages = village;
    for (const [x, y] of n4(cx, cy)) {
      const t = tileAt(x, y);
      if (t && t.type !== T.VILL) t.type = T.HUT;
    }
    // people
    for (let i = 0; i < 8; i++) S.people.push(makePerson(P.FARMER));
    for (let i = 0; i < 6; i++) S.people.push(makePerson(P.CHAR));
    for (let i = 0; i < 2; i++) S.people.push(makePerson(P.ENT));
    render();
    log('🧭 New game started.');
  }

  // ====== RENDER ======
  function render() {
    // board tiles
    el.board.innerHTML = '';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = tileAt(x, y);
        const d = document.createElement('div');
        d.className = 'tile t-' + t.type;
        d.dataset.x = x; d.dataset.y = y;
        let emoji = EMO.clear;
        switch (t.type) {
          case T.FOREST: emoji = EMO.forest; break;
          case T.EDGE: emoji = EMO.edge; break;
          case T.CLEAR: emoji = EMO.clear; break;
          case T.FARM: emoji = EMO.farm; break;
          case T.CHAR: emoji = EMO.char; break;
          case T.VILL: emoji = EMO.vill; break;
          case T.HUT: emoji = EMO.hut; break;
          case T.REPLANT: emoji = EMO.replant; break;
          case T.FIRE: emoji = EMO.firebreak; break;
          case T.BURN: emoji = EMO.burn; break;
        }
        d.textContent = t.firebreak ? EMO.firebreak : emoji;
        if (t.protected) {
          const f = document.createElement('span');
          f.className = 'flag'; f.textContent = '🛡️';
          d.appendChild(f);
        }
        el.board.appendChild(d);
      }
    }

    // people on tiles
    for (const p of S.people) {
      const i = idx(p.x, p.y);
      const cell = el.board.children[i];
      if (!cell) continue;
      const s = document.createElement('span');
      s.textContent = P_EMO[p.kind];
      s.style.fontSize = '1.2rem';
      cell.appendChild(s);
      if (p.valueChain) {
        const b = document.createElement('span');
        b.className = 'badge'; b.textContent = '💎';
        cell.appendChild(b);
      }
    }

    // HUD
    el.statMoney.textContent = Math.floor(S.money);
    el.statGov.textContent = S.gov;
    el.statSoc.textContent = S.soc;

    const forestShare = getForestShare();
    const foodPct = getFoodPercent();
    el.statForest.textContent = (forestShare * 100).toFixed(0) + '%';
    el.statFood.textContent = (foodPct * 100).toFixed(0) + '%';
    el.statComm.textContent = Math.floor(S.community);
    el.statER.textContent = S.erActive ? 'ON' : 'off';
    if (el.pillER) el.pillER.style.opacity = S.erActive ? '1' : '0.7';
    toggleRed(el.pillForest, forestShare < .20);
    toggleRed(el.pillFood, foodPct < .30);
    el.season.textContent = `Year ${S.year} · Period ${S.period}`;

    updateSummary();
  }

  // ====== METRICS ======
  const getForestShare = () =>
    S.grid.filter(t => t && (t.type === T.FOREST || t.type === T.REPLANT)).length / (W * H);

  function getFoodPercent() {
    const pop = S.people.length;
    const farms = S.grid.filter(t => t && t.type === T.FARM).length;
    const produced = farms * 1.0;
    const need = Math.max(1, pop * 0.6);
    return clamp(produced / need, 0, 1);
  }

  // ====== FIRE SYSTEM ======
  function ignite(x, y) {
    const t = tileAt(x, y);
    if (!t || t.burning) return;
    if (t.type === T.FIRE || t.type === T.VILL || t.type === T.HUT) return;
    t.prevType = t.type;
    t.type = T.BURN; t.burning = true;
    log(`🔥 Fire started at (${x},${y})`);
  }

  function maybeStartFires() {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tileAt(x, y);
      if (!t || t.burning) continue;
      let p = 0;
      if (t.type === T.CHAR) p = 0.05;
      else if (t.type === T.EDGE) p = 0.012;
      else if (t.type === T.FARM) p = 0.008;
      else if (t.type === T.CLEAR || t.type === T.REPLANT) p = 0.006;
      else if (t.type === T.FOREST) p = 0.004;
      if (Math.random() < p) ignite(x, y);
    }
  }

  function spreadFires() {
    const burning = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tileAt(x, y); if (t?.burning) burning.push([x, y]);
    }
    for (const [x, y] of burning) {
      for (const [nx, ny] of n4(x, y)) {
        const nt = tileAt(nx, ny);
        if (!nt || nt.burning) continue;
        if (nt.type === T.FIRE || nt.protected) continue;
        const chance = (nt.type === T.FOREST || nt.type === T.REPLANT) ? 0.35
                    : (nt.type === T.EDGE || nt.type === T.FARM) ? 0.25 : 0.15;
        if (Math.random() < chance) ignite(nx, ny);
      }
    }
  }

  function burnoutFires() {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tileAt(x, y);
      if (t?.burning) { t.burning = false; t.type
