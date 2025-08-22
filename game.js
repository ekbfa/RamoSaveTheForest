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
      if (t?.burning) { t.burning = false; t.type = T.CLEAR; t.prevType = null; }
    }
  }

  function extinguish(t) {
    if (!t?.burning) return;
    t.burning = false;
    t.type = t.prevType || T.CLEAR;
    t.prevType = null;
    S.periodFiresOut++;
    log('🧑‍🌱🧯 Fire extinguished');
  }

  // ====== TICK / AGENTS ======
  function tick() {
    S.tick++;
    maybeStartFires();
    for (const p of S.people) actPerson(p);
    spreadFires();

    for (const t of S.grid) {
      if (!t) continue;
      if (t.type === T.FARM) {
        t.age++;
        if (t.age > 8) {
          t.degraded = 3; t.type = T.CLEAR; t.age = 0;
          log('🥀 Farm exhausted → fallow 3 periods.');
        }
      }
      if (t.type === T.REPLANT) {
        t.replantedAge++;
        if (t.replantedAge >= 2) {
          t.type = T.FOREST;
          S.money += 15;
          S.periodIncomeTreasury += 15;
          log('💨🌱→🌲 Carbon credits +15💰');
        }
      }
      if (t.degraded > 0) t.degraded--;
      t.hasGuardian = false;
    }

    burnoutFires();

    if (S.tick >= S.ticksPer) periodEnd();
    render();
  }

  function anyGuardianNear(x, y) {
    for (const [ax, ay] of n4(x, y)) {
      const t = tileAt(ax, ay); if (t?.hasGuardian) return true;
    }
    return false;
  }

  function nearestEdge(x, y) {
    const q = [[x, y]], seen = new Set([x + ',' + y]);
    while (q.length) {
      const [cx, cy] = q.shift();
      const t = tileAt(cx, cy);
      if (t && (t.type === T.FOREST || t.type === T.EDGE)) return { x: cx, y: cy };
      for (const [nx, ny] of n4(cx, cy)) {
        const k = nx + ',' + ny;
        if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    return null;
  }

  function nearestBurn(x, y) {
    const q = [[x, y]], seen = new Set([x + ',' + y]);
    while (q.length) {
      const [cx, cy] = q.shift();
      const t = tileAt(cx, cy);
      if (t?.burning) return { x: cx, y: cy };
      for (const [nx, ny] of n4(cx, cy)) {
        const k = nx + ',' + ny;
        if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    return null;
  }

  function moveToward(p, target) {
    const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
    if (Math.random() < 0.5) {
      if (inb(p.x + dx, p.y)) p.x += dx;
      else if (inb(p.x, p.y + dy)) p.y += dy;
    } else {
      if (inb(p.x, p.y + dy)) p.y += dy;
      else if (inb(p.x + dx, p.y)) p.x += dx;
    }
  }

  const findNearbyType = (x, y, type) => {
    for (const [nx, ny] of n4(x, y)) {
      const t = tileAt(nx, ny);
      if (t?.type === type) return { x: nx, y: ny };
    }
    return null;
  };

  function actPerson(p) {
    // Entrepreneurs hire
    if (p.kind === P.ENT) {
      if (Math.random() < .25) {
        const t = Math.random() < .5 ? P.FARMER : P.CHAR;
        const np = makePerson(t); np.hired = true; S.people.push(np);
        log(`🧑‍💼 hired ${P_EMO[t]}`);
      }
      p.wealth += .5;
      return;
    }

    // Guardians: fight fire, replant, patrol
    if (p.kind === P.GUARD) {
      let t = tileAt(p.x, p.y);
      if (t?.burning) { extinguish(t); return; }
      const target = nearestBurn(p.x, p.y);
      if (target) {
        moveToward(p, target);
        t = tileAt(p.x, p.y);
        if (t?.burning) { extinguish(t); return; }
        for (const [nx, ny] of n4(p.x, p.y)) {
          const nt = tileAt(nx, ny);
          if (nt?.burning) { extinguish(nt); return; }
        }
      }
      const dirs = n4(p.x, p.y);
      const [nx, ny] = dirs[Math.floor(Math.random() * dirs.length)] || [p.x, p.y];
      p.x = nx; p.y = ny;
      t = tileAt(p.x, p.y);
      if (t) {
        t.hasGuardian = true;
        if (t.type === T.CLEAR) {
          t.type = T.REPLANT; t.replantedAge = 0; S.periodReplants++;
          log('🧑‍🌱🌱 replanted');
        }
      }
      return;
    }

    // Farmers/Charcoalers move to edge and work
    const target = nearestEdge(p.x, p.y);
    if (!target) return;

    // ER scheme may skip cutting
    if (S.erActive && Math.random() < 0.3) { log('💵🧾 ER skip'); return; }

    moveToward(p, target);
    const t2 = tileAt(p.x, p.y);
    if (!t2 || t2.protected) return;

    if (t2.type === T.FOREST) { t2.type = T.EDGE; log('🪵 new edge'); return; }

    if (t2.type === T.EDGE) {
      const slowed = t2.firebreak && Math.random() < 0.7;
      if (slowed) { log('🚧 firebreak slowed'); return; }

      if (p.kind === P.FARMER) {
        const isVC = !!p.valueChain;

        // Value-chain farmers prefer intensification on CLEAR
        if (isVC) {
          const alt = findNearbyType(p.x, p.y, T.CLEAR);
          if (alt) {
            const t3 = tileAt(alt.x, alt.y);
            t3.type = T.FARM; t3.age = 0;
            p.wealth += 3; S.money += 5; S.community += 5;
            S.periodIncomeTreasury += 5; S.periodIncomeCommunity += 5;
            S.periodConsolidated++; log('👨‍🌾💎 Intensified on existing land (+5💰, +5 community)');
            return;
          }
          if (Math.random() < 0.5) { log('👨‍🌾💎 held off expansion to avoid sprawl'); return; }
        }

        // Consolidation / tenure bias to convert CLEAR instead of EDGE
        const bias = (S.consolidate || S.tenure) ? 0.6 : 0.2;
        if (Math.random() < bias) {
          const alt = findNearbyType(p.x, p.y, T.CLEAR);
          if (alt) {
            const t3 = tileAt(alt.x, alt.y);
            t3.type = T.FARM; t3.age = 0;
            p.wealth += 2; S.money += 3; S.community += 2;
            S.periodIncomeTreasury += 3; S.periodIncomeCommunity += 2;
            S.periodConsolidated++; log('👨‍🌾➡️🌾 consolidated (+3💰, +2 community)');
            return;
          }
        }

        // Expand on EDGE
        t2.type = T.FARM; t2.age = 0;
        p.wealth += 2; S.money += 4; S.community += 3;
        S.periodIncomeTreasury += 4; S.periodIncomeCommunity += 3;
        log('👨‍🌾🌾 +4💰 treasury, +3 community');
      } else if (p.kind === P.CHAR) {
        t2.type = T.CHAR;
        p.wealth += 1; S.money += 2; S.community += 1;
        S.periodIncomeTreasury += 2; S.periodIncomeCommunity += 1;
        log('🧑‍🏭🔥 +2💰 treasury, +1 community');
      }
      return;
    }

    // Guardians nearby may deter
    if (anyGuardianNear(p.x, p.y) && Math.random() < 0.4) { S.periodDeters++; log('🧑‍🌱 deterred'); }
  }

  // ====== PERIOD END ======
  function periodEnd() {
    S.tick = 0; S.period++;

    const forestShare = getForestShare();
    const foodPct = getFoodPercent();

    // births
    const births = Math.floor(S.spawnRate / 2 + Math.random() * S.spawnRate);
    for (let i = 0; i < births; i++) {
      const r = Math.random();
      const kind = r < .5 ? P.FARMER : (r < .8 ? P.CHAR : P.FARMER);
      S.people.push(makePerson(kind));
    }
    if (births > 0) log(`👶 +${births}`);

    // ER cooldown
    if (S.erActive) {
      S.erCooldown--;
      if (S.erCooldown <= 0) { S.erActive = false; log('🧾 ER ended'); }
    }

    // Protected upkeep
    const protectedCount = S.grid.filter(t => t?.protected).length;
    if (protectedCount > 0) {
      const cost = protectedCount * 1;
      S.money = Math.max(0, S.money - cost);
      log(`🛡️ Upkeep for ${protectedCount} protected tiles: -${cost}💰`);
    }

    // Social capital updates
    if (forestShare > S.lastForestShare + 0.02) { S.soc++; log('🫱 +1 (forest trending up)'); }
    if (S.periodIncomeCommunity >= 6) { S.soc++; log('🫱 +1 (community earned well)'); }
    if (S.periodReplants >= 3) { S.soc++; log('🫱 +1 (replanted ≥3 tiles)'); }
    if (S.periodDeters >= 3) { S.soc++; log('🫱 +1 (guardians deterred cutters)'); }
    if (S.periodConsolidated >= 2) { S.soc++; log('🫱 +1 (consolidated farms)'); }
    if (S.periodFiresOut >= 1) { S.soc++; log('🫱 +1 (firefighting response)'); }
    if (foodPct > S.foodPctLast + 0.02) { S.soc++; log('🫱 +1 (food security rising)'); }
    if (foodPct < 0.30) { S.soc = Math.max(0, S.soc - 1); log('🫱 -1 (food insecurity)'); }

    // failure streaks
    if (forestShare < .20) S.redForestStreak++; else S.redForestStreak = 0;
    if (foodPct < .30) S.redFoodStreak++; else S.redFoodStreak = 0;
    if (S.redForestStreak >= 3 || S.redFoodStreak >= 3) {
      alert('💀 Crisis persisted for 3 periods (Forest or Food). You lose.');
      return reset();
    }

    // morale
    S.morale = clamp(.5 + (S.money / 2000) + (forestShare - .4), .2, .95);

    // year change
    if (S.period > 4) { S.period = 1; S.year++; log('📅 New Year'); }

    // win condition
    if (S.year > 10 && forestShare > .4) {
      alert('🏆 You protected the forest and community wealth. You win!');
      return reset();
    }

    S.lastForestShare = forestShare; S.foodPctLast = foodPct;

    // history + chart
    pushHistory(forestShare * 100, foodPct * 100, S.community, S.people.length);
    drawChart();

    // reset per-period counters
    S.periodIncomeTreasury = 0;
    S.periodIncomeCommunity = 0;
    S.periodReplants = 0;
    S.periodDeters = 0;
    S.periodConsolidated = 0;
    S.periodFiresOut = 0;

    render();
    openCouncil();
  }

  // ====== COUNCIL ======
  function openCouncil() {
    S.councilUsed = {};
    document.querySelectorAll('#councilModal [data-action]').forEach(b => b.classList.remove('used'));
    el.council.classList.add('show');
    updateSummary();
    updateCouncilButtons();
  }

  const closeCouncil = () => el.council.classList.remove('show');

  function setDisabled(sel, dis) {
    const b = document.querySelector(sel);
    if (b) b.disabled = dis;
  }

  function updateCouncilButtons() {
    const canTen = S.gov >= 2 && S.soc >= 1;
    const canCon = S.tenure && S.soc >= 2 && S.gov >= 1;
    const canGuard = S.money >= 40;
    const canFB = S.money >= 25 && S.soc >= 1;
    const canER = S.money >= 20;
    const canRep = S.money >= 30;
    const canVC = S.soc >= 2 && S.money >= 25;
    const canEnt = S.money >= 20;

    setDisabled('[data-action="tenure"]', !canTen);
    setDisabled('[data-action="consolidate"]', !canCon);
    setDisabled('[data-action="guardians"]', !canGuard);
    setDisabled('[data-action="firebreaks"]', !canFB);
    setDisabled('[data-action="er"]', !canER);
    setDisabled('[data-action="replantDrive"]', !canRep);
    setDisabled('[data-action="valueChains"]', !canVC);
    setDisabled('[data-action="entShift"]', !canEnt);
  }

  function applyAction(name) {
    let ok = false;
    switch (name) {
      case 'tenure':
        if (S.gov >= 2 && S.soc >= 1 && !S.tenure) {
          S.gov -= 2; S.soc -= 1; S.tenure = true; S.soc++;
          log('📜 Tenure established (+1 🫱 support)'); ok = true;
        } else if (S.tenure) log('ℹ️ Tenure already established');
        break;

      case 'consolidate':
        if (S.tenure && S.soc >= 2 && S.gov >= 1) {
          S.soc -= 2; S.gov -= 1; S.consolidate = true;
          log('🌾 Consolidation running'); ok = true;
        }
        break;

      case 'guardians':
        if (S.money >= 40) {
          S.money -= 40; for (let i = 0; i < 3; i++) S.people.push(makePerson(P.GUARD));
          S.soc++; log('🧑‍🌱 +3 guardians (+1 🫱 jobs)'); ok = true;
        }
        break;

      case 'firebreaks':
        if (S.money >= 25 && S.soc >= 1) {
          S.money -= 25; S.soc -= 1; layAutoFirebreaks();
          log('🚧 Firebreak network'); ok = true;
        }
        break;

      case 'er':
        if (S.money >= 20) {
          S.money -= 20; S.erActive = true; S.erCooldown = 1;
          S.money += 10; S.soc++;
          log('🧾 ER credits +10💰 (+1 🫱 goodwill). Active next period.'); ok = true;
        }
        break;

      case 'replantDrive':
        if (S.money >= 30) {
          S.money -= 30; massReplant(8);
          log('🌱 Replant drive'); ok = true;
        }
        break;

      case 'valueChains':
        if (S.soc >= 2 && S.money >= 25) {
          S.soc -= 2; S.money -= 25; convertFarmersToValue(3); S.soc++;
          log('🥕 Value chains started: 3 farmers intensified (+1 🫱)'); ok = true;
        }
        break;

      case 'entShift':
        if (S.money >= 20) {
          S.money -= 20;
          const ent = S.people.find(p => p.kind === P.ENT);
          if (ent) S.people.push(makePerson(P.GUARD));
          log('🧑‍💼 → funds guardians'); ok = true;
        }
        break;
    }

    if (ok) {
      const b = document.querySelector(`[data-action="${name}"]`);
      if (b) { b.classList.add('used'); b.setAttribute('aria-pressed', 'true'); }
      S.councilUsed[name] = (S.councilUsed[name] || 0) + 1;
    } else {
      log('❗ Not enough capitals or already active');
    }

    render();
    updateSummary();
    updateCouncilButtons();
  }

  function updateSummary() {
    const forests = S.grid.filter(t => t && (t.type === T.FOREST || t.type === T.REPLANT)).length;
    const farms = S.grid.filter(t => t && t.type === T.FARM).length;
    const chars = S.grid.filter(t => t && t.type === T.CHAR).length;
    const edge = S.grid.filter(t => t && t.type === T.EDGE).length;
    const fires = S.grid.filter(t => t && t.type === T.BURN).length;

    el.summary.innerHTML =
      `<div>🧩 Edge: <span class="edge">${edge}</span> · 🌲 Forest: ${forests} · 🌾 Farms: ${farms} · 🔥 Char: ${chars} · 🔥 Fires: ${fires}</div>
       <div>👥 Pop: ${S.people.length} (👨‍🌾 ${S.people.filter(p=>p.kind===P.FARMER).length}, 🧑‍🏭 ${S.people.filter(p=>p.kind===P.CHAR).length}, 🧑‍💼 ${S.people.filter(p=>p.kind===P.ENT).length}, 🧑‍🌱 ${S.people.filter(p=>p.kind===P.GUARD).length})</div>
       <div>💼 Treasury +${S.periodIncomeTreasury} · 💰 Community +${S.periodIncomeCommunity} · 🧯 Fires out: ${S.periodFiresOut} · 🧾 ER: ${S.erActive ? 'ON' : 'off'}</div>`;
  }

  // ====== TOOLS ======
  let tool = null;
  const toolBtns = {
    firebreak: el.toolFirebreak,
    replant: el.toolReplant,
    guardian: el.toolGuardian,
    protect: el.toolProtect,
    inspect: el.toolInspect
  };

  function updateToolButtons() {
    Object.entries(toolBtns).forEach(([k, btn]) => {
      if (!btn) return;
      const on = (tool === k);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setTool(name) {
    // Guardian is immediate
    if (name === 'guardian') {
      if (S.money >= 10) {
        S.money -= 10;
        S.people.push(makePerson(P.GUARD));
        S.soc++; log('🧑‍🌱 Guardian hired (+1 🫱 jobs)');
        render();
      } else log('❗ Need 💰10');
      return;
    }
    tool = (tool === name) ? null : name;
    updateToolButtons();
    if (tool) log(`🛠️ ${tool} ready`);
  }

  function layAutoFirebreaks() {
    const y = Math.max(1, Math.min(H - 2, Math.floor(H / 2) + (Math.random() < .5 ? -2 : 2)));
    for (let x = 2; x < W - 2; x++) {
      const t = tileAt(x, y);
      t.prevTypeFB = t.type;
      t.firebreak = true;
      if (t.type !== T.VILL) t.type = T.FIRE;
    }
  }

  function massReplant(n) {
    const clears = S.grid.map((t, i) => ({ t, i })).filter(o => o.t && o.t.type === T.CLEAR);
    for (let i = 0; i < Math.min(n, clears.length); i++) {
      const pick = clears.splice(Math.floor(Math.random() * clears.length), 1)[0];
      const x = pick.i % W, y = Math.floor(pick.i / W);
      const t = tileAt(x, y);
      t.type = T.REPLANT; t.replantedAge = 0; S.periodReplants++;
    }
  }

  function convertFarmersToValue(n) {
    const farmers = S.people.filter(p => p.kind === P.FARMER && !p.valueChain);
    for (let i = 0; i < Math.min(n, farmers.length); i++) {
      farmers[i].valueChain = true; farmers[i].wealth += 2;
    }
  }

  // ====== BOARD INTERACTION ======
  el.board.addEventListener('click', (e) => {
    const cell = e.target.closest('.tile'); if (!cell) return;
    const x = +cell.dataset.x, y = +cell.dataset.y;
    const t = tileAt(x, y); if (!t) return;

    switch (tool) {
      case 'firebreak':
        if (S.money >= 1) {
          S.money -= 1;
          if (!t.firebreak) {
            t.prevTypeFB = t.type; t.firebreak = true; t.type = T.FIRE;
            log('🚧 placed (-1💰)');
          } else {
            t.firebreak = false; t.type = t.prevTypeFB || T.CLEAR; t.prevTypeFB = null;
            log('🚧 removed (restored land)');
          }
          render();
        } else log('❗ Need 💰1');
        break;

      case 'replant':
        if (t.type === T.CLEAR) {
          if (S.money >= 2) {
            S.money -= 2; t.type = T.REPLANT; t.replantedAge = 0; S.periodReplants++;
            log('🌱 planted (-2💰)'); render();
          } else log('❗ Need 💰2');
        }
        break;

      case 'protect':
        if (!t.protected) {
          if (S.soc >= 2) {
            S.soc -= 2; t.protected = true;
            log('🛡️ protected (-2🫱 upfront; 💰1/period upkeep)'); render();
          } else log('❗ Need 🫱2');
        } else {
          t.protected = false; log('🛡️ protection removed'); render();
        }
        break;

      case 'inspect':
        log(`🔎 (${x},${y}) ${t.type}${t.firebreak ? ' · 🚧' : ''}${t.protected ? ' · 🛡️' : ''}${t.degraded > 0 ? ` · fallow(${t.degraded})` : ''}${t.burning ? ' · 🔥 burning' : ''}`);
        break;
    }
  });

  // ====== CHART ======
  function pushHistory(forest, food, community, pop) {
    const cap = 80;
    HIST.forest.push(forest);
    HIST.food.push(food);
    HIST.community.push(community);
    HIST.pop.push(pop);
    for (const k of Object.keys(HIST)) {
      if (HIST[k].length > cap) HIST[k].shift();
    }
  }

  function drawChart() {
    const c = el.chart; if (!c) return;
    const ctx = c.getContext('2d');
    const Wc = c.width, Hc = c.height;
    ctx.clearRect(0, 0, Wc, Hc);
    const pad = 6; const rows = 4;
    const rowH = (Hc - pad * 2) / rows;

    const series = [
      { k: 'forest', color: '#6be675', label: 'Forest %', min: 0, max: 100 },
      { k: 'food', color: '#f8b84e', label: 'Food %', min: 0, max: 100 },
      { k: 'community', color: '#6be6b7', label: 'Community', min: 0, max: Math.max(10, Math.max(...HIST.community, 10)) },
      { k: 'pop', color: '#9fb0c1', label: 'Pop', min: 0, max: Math.max(5, Math.max(...HIST.pop, 5)) }
    ];

    ctx.font = '10px monospace';
    ctx.fillStyle = '#9fb0c1';
    ctx.strokeStyle = '#2a3347';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, Wc, Hc);

    series.forEach((s, ri) => {
      const y0 = pad + ri * rowH;
      ctx.fillStyle = '#9fb0c1';
      ctx.fillText(s.label, 6, y0 + 10);
      const data = HIST[s.k];
      if (data.length < 2) return;
      const min = s.min, max = s.max;
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = pad + (i / Math.max(1, data.length - 1)) * (Wc - pad * 2);
        const y = y0 + rowH - ((v - min) / (max - min)) * (rowH - 12) - 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = '#2a3347'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, y0 + rowH - 1); ctx.lineTo(Wc - pad, y0 + rowH - 1); ctx.stroke();
    });
  }

  // ====== EVENTS ======
  el.btnTick.onclick = () => tick();
  el.btnRun.onclick = () => { for (let i = 0; i < S.ticksPer; i++) tick(); };
  el.btnCouncil.onclick = () => openCouncil();
  el.closeCouncil.onclick = () => closeCouncil();

  document.querySelectorAll('[data-action]').forEach(b => {
    b.onclick = (e) => applyAction(e.currentTarget.dataset.action);
  });

  el.ticksPer.oninput = (e) => { S.ticksPer = +e.target.value; el.ticksLbl.textContent = S.ticksPer; };
  el.spawnRate.oninput = (e) => { S.spawnRate = +e.target.value; el.spawnLbl.textContent = S.spawnRate; };

  el.toolFirebreak.onclick = () => setTool('firebreak');
  el.toolReplant.onclick = () => setTool('replant');
  el.toolGuardian.onclick = () => setTool('guardian');
  el.toolProtect.onclick = () => setTool('protect');
  el.toolInspect.onclick = () => setTool('inspect');

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); tick(); }
    if (e.key === 'Enter') { for (let i = 0; i < S.ticksPer; i++) tick(); }
    if (e.key.toLowerCase() === 'c') { openCouncil(); }
  });

  // ====== UTIL ACTIONS ======
  function reset() {
    Object.assign(S, {
      money: 50, gov: 3, soc: 3, community: 0, morale: .65,
      year: 1, period: 1, tick: 0, ticksPer: S.ticksPer, spawnRate: S.spawnRate,
      tenure: false, consolidate: false, erActive: false, erCooldown: 0,
      lastForestShare: 1, foodPctLast: 1, redForestStreak: 0, redFoodStreak: 0,
      people: [], grid: new Array(W * H), villages: [],
      periodIncomeTreasury: 0, periodIncomeCommunity: 0,
      periodReplants: 0, periodDeters: 0, periodConsolidated: 0, periodFiresOut: 0,
      councilUsed: {}
    });
    init();
  }

  // ====== TESTS ======
  function expect(name, cond) {
    const ok = !!cond; log(`${ok ? '✅' : '❌'} <b>${name}</b>`); return ok;
  }

  function runTests() {
    const allDef = S.grid.length === W * H && S.grid.every(t => !!t);
    expect('Grid W*H and defined', allDef);

    // Value Chains action marks farmers
    const preVC = S.people.filter(p => p.kind === 'farmer' && p.valueChain).length;
    S.soc = 10; S.money = 100; applyAction('valueChains');
    const postVC = S.people.filter(p => p.kind === 'farmer' && p.valueChain).length;
    expect('Value Chains marks some farmers', postVC > preVC);

    // ER action flips state and shows pill
    const m0 = S.money; applyAction('er');
    expect('ER activates', S.erActive === true && S.money > m0 - 20);

    // Firebreak toggle restore
    const t = tileAt(2, 2); const prev = t.type;
    el.toolFirebreak.click();
    const cell = el.board.children[idx(2, 2)];
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const placed = tileAt(2, 2).type;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const restored = tileAt(2, 2).type;
    expect('Firebreak can be removed and land restored', placed === 'firebreak' && restored === prev);

    // Tool button toggle class
    const btn = el.toolReplant; btn.click();
    expect('Tool highlight turns on', btn.classList.contains('is-on'));
    btn.click();
    expect('Tool highlight turns off', !btn.classList.contains('is-on'));
  }

  // ====== SUMMARY ======
  function updateSummary() {
    const forests = S.grid.filter(t => t && (t.type === T.FOREST || t.type === T.REPLANT)).length;
    const farms = S.grid.filter(t => t && t.type === T.FARM).length;
    const chars = S.grid.filter(t => t && t.type === T.CHAR).length;
    const edge = S.grid.filter(t => t && t.type === T.EDGE).length;
    const fires = S.grid.filter(t => t && t.type === T.BURN).length;

    el.summary.innerHTML =
      `<div>🧩 Edge: <span class="edge">${edge}</span> · 🌲 Forest: ${forests} · 🌾 Farms: ${farms} · 🔥 Char: ${chars} · 🔥 Fires: ${fires}</div>
       <div>👥 Pop: ${S.people.length} (👨‍🌾 ${S.people.filter(p=>p.kind===P.FARMER).length}, 🧑‍🏭 ${S.people.filter(p=>p.kind===P.CHAR).length}, 🧑‍💼 ${S.people.filter(p=>p.kind===P.ENT).length}, 🧑‍🌱 ${S.people.filter(p=>p.kind===P.GUARD).length})</div>
       <div>💼 Treasury +${S.periodIncomeTreasury} · 💰 Community +${S.periodIncomeCommunity} · 🧯 Fires out: ${S.periodFiresOut} · 🧾 ER: ${S.erActive ? 'ON' : 'off'}</div>`;
  }

  // ====== BOOT ======
  init();
  pushHistory(getForestShare() * 100, getFoodPercent() * 100, S.community, S.people.length);
  drawChart();
  setTimeout(runTests, 0);
})();
