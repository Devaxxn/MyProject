/* ============================================================
   NEON DRIFT — dodge the fall, catch the glow.
   Solo or 2-player. Boss every 60s. Local hall of fame. PWA.
   Single-file game logic. No dependencies.
   ============================================================ */
(() => {
  'use strict';

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = 800, H = 600;

  const $ = id => document.getElementById(id);
  const el = {
    score: $('score'), score2: $('score2'), best: $('best'),
    lives: $('lives'), lives2: $('lives2'), combo: $('combo'),
    pups: $('powerups'), combo2: $('combo2'), lead: $('lead'),
    p1box: $('p1box'), p2box: $('p2box'), hudRight: $('hudRight'),
    bossWrap: $('bossWrap'), bossBar: document.querySelector('#bossBar i'), bossName: $('bossName'),
    start: $('startScreen'), over: $('gameoverScreen'),
    finalScore: $('finalScore'), finalScore2: $('finalScore2'), finalScore2Row: $('finalScore2Row'),
    finalBest: $('finalBest'), newBest: $('newBest'), winner: $('winnerLine'),
    restart: $('restartBtn'), menu: $('menuBtn'), mute: $('muteBtn'),
    lbList: $('lbList'), lbKey: $('lbKey'),
  };

  // Crisp rendering on Hi-DPI (logical coords stay 800x600)
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  // ---------- helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TAU = Math.PI * 2;

  function circleRectHit(cx, cy, r, rx, ry, rw, rh) {
    const px = clamp(cx, rx, rx + rw);
    const py = clamp(cy, ry, ry + rh);
    const dx = cx - px, dy = cy - py;
    return dx * dx + dy * dy < r * r;
  }

  // ---------- audio (all synthesized, no files) ----------
  const AudioSys = {
    ctx: null, master: null, noiseBuf: null, jingle: null,
    muted: localStorage.getItem('neonDrift.muted') === '1',
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.jingle = { beat: 0, timer: 0, playing: false, boss: false };
      const len = Math.floor(this.ctx.sampleRate * 0.4);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    setMuted(m) {
      this.muted = m;
      localStorage.setItem('neonDrift.muted', m ? '1' : '0');
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
      el.mute.textContent = m ? '🔇' : '🔊';
    },
    tone({ type = 'sine', from = 440, to = null, dur = 0.15, vol = 0.3, delay = 0 }) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(from, t0);
      if (to) o.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    },
    burst({ dur = 0.25, vol = 0.4, freq = 1000 }) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(freq, t0);
      f.frequency.exponentialRampToValueAtTime(100, t0 + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t0);
      src.stop(t0 + dur);
    },
    chain(notes, bpm = 105) {
      const step = 30 / bpm;
      for (const n of notes) this.tone({ ...n, delay: (n.at || 0) * step + (n.delay || 0) });
    },
    catch_(mult) {
      const base = 480 * Math.pow(1.14, mult - 1);
      this.tone({ type: 'square', from: base, to: base * 1.5, dur: 0.1, vol: 0.16 });
      this.tone({ type: 'sine', from: base * 2, to: base * 3, dur: 0.12, vol: 0.1, delay: 0.02 });
    },
    near() { this.tone({ type: 'sine', from: 950, to: 1400, dur: 0.05, vol: 0.05 }); },
    shoot() { this.tone({ type: 'square', from: 950, to: 620, dur: 0.06, vol: 0.1 }); },
    droneDie() {
      this.burst({ dur: 0.18, vol: 0.25, freq: 2200 });
      this.tone({ type: 'sawtooth', from: 320, to: 70, dur: 0.22, vol: 0.22 });
    },
    pRapid() {
      this.chain([
        { type: 'square', from: 523, dur: 0.07, vol: 0.12 },
        { type: 'square', from: 659, dur: 0.07, vol: 0.12, at: 1 },
        { type: 'square', from: 784, dur: 0.12, vol: 0.12, at: 2 },
      ], 380);
    },
    pNova() {
      this.tone({ type: 'sawtooth', from: 90, to: 640, dur: 0.5, vol: 0.2 });
      this.tone({ type: 'sine', from: 180, to: 1280, dur: 0.5, vol: 0.12, delay: 0.02 });
    },
    swarmAlert() {
      this.chain([
        { type: 'square', from: 392, dur: 0.08, vol: 0.1 },
        { type: 'square', from: 392, dur: 0.08, vol: 0.1, at: 2 },
        { type: 'square', from: 523, dur: 0.1, vol: 0.1, at: 4 },
      ], 150);
    },
    pGod() {
      this.tone({ type: 'sawtooth', from: 110, to: 880, dur: 0.55, vol: 0.22 });
      this.tone({ type: 'square', from: 440, to: 1760, dur: 0.4, vol: 0.1, delay: 0.05 });
      this.tone({ type: 'sine', from: 2200, to: 3300, dur: 0.5, vol: 0.08, delay: 0.15 });
    },
    hit() {
      this.burst({ dur: 0.3, vol: 0.5, freq: 900 });
      this.tone({ type: 'triangle', from: 130, to: 40, dur: 0.3, vol: 0.4 });
    },
    startJingle() {
      if (this.jingle) { this.jingle.beat = 0; this.jingle.timer = 0; this.jingle.playing = true; this.jingle.boss = false; }
    },
    stopMusic() { if (this.jingle) this.jingle.playing = false; },
    tickMusic(dt) {
      const j = this.jingle;
      if (!j || !j.playing || !this.ctx || this.muted) return;
      j.timer -= dt;
      if (j.timer > 0) return;
      const bpm = Math.min(92 + 60 * Math.min((elapsed / 75) * DIFF.ramp, 1), 152) * (j.boss ? 1.15 : 1);
      j.timer = 30 / bpm;
      const b = j.beat++ % 16;
      const root = 110 * Math.pow(2, (j.beat >> 4) % 2 ? 3 / 12 : 0);
      const scale = j.boss ? [0, 1, 5, 6, 10] : [0, 3, 7, 10, 12]; // phrygian = menace
      if (b % 4 === 0) this.tone({ type: 'square', from: root / 2, dur: 0.22, vol: 0.05 });
      if (j.boss && b % 2 === 0) this.tone({ type: 'sawtooth', from: root * 1.5, dur: 0.06, vol: 0.028 });
      const seed = (b * 7 + 3) % 11;
      if (b % 2 === 1 && seed > 3) {
        const n = scale[seed % scale.length];
        this.tone({ type: 'square', from: root * 4 * Math.pow(2, n / 12), dur: 0.09, vol: 0.035 });
      }
      if (b % 4 === 2) this.burst({ dur: 0.05, vol: 0.05, freq: 6000 });
    },
    bossWarning() {
      this.chain([
        { type: 'square', from: 196, dur: 0.11, vol: 0.12 },
        { type: 'square', from: 196, dur: 0.11, vol: 0.12, at: 2 },
        { type: 'square', from: 261.63, dur: 0.5, vol: 0.14, at: 4 },
      ], 130);
    },
    bossHurt() {
      this.tone({ type: 'square', from: 820, to: 490, dur: 0.09, vol: 0.14 });
      this.tone({ type: 'sawtooth', from: 160, to: 90, dur: 0.12, vol: 0.1, delay: 0.01 });
    },
    bossShot() {
      this.tone({ type: 'sawtooth', from: 340, to: 170, dur: 0.16, vol: 0.09 });
    },
    bossPhase() {
      this.burst({ dur: 0.35, vol: 0.35, freq: 2200 });
      this.tone({ type: 'sawtooth', from: 660, to: 110, dur: 0.4, vol: 0.2 });
    },
    bossDefeated() {
      this.chain([
        { type: 'square', from: 392, dur: 0.1, vol: 0.15 },
        { type: 'square', from: 523.25, dur: 0.1, vol: 0.15, at: 1 },
        { type: 'square', from: 659.25, dur: 0.1, vol: 0.15, at: 2 },
        { type: 'square', from: 783.99, dur: 0.1, vol: 0.15, at: 3 },
        { type: 'square', from: 1046.5, dur: 0.5, vol: 0.17, at: 4 },
      ], 170);
      this.burst({ dur: 0.6, vol: 0.4, freq: 3000 });
    },
    pShield() {
      this.chain([
        { type: 'triangle', from: 392, dur: 0.09, vol: 0.12 },
        { type: 'triangle', from: 523.25, dur: 0.09, vol: 0.12, at: 1 },
        { type: 'triangle', from: 659.25, dur: 0.14, vol: 0.12, at: 2 },
        { type: 'triangle', from: 783.99, dur: 0.2, vol: 0.12, at: 3 },
      ], 150);
    },
    pSlow() {
      this.chain([
        { type: 'sine', from: 660, to: 330, dur: 0.3, vol: 0.12 },
        { type: 'sine', from: 440, to: 220, dur: 0.35, vol: 0.1, delay: 0.05 },
      ], 120);
    },
    pMagnet() {
      this.chain([
        { type: 'sawtooth', from: 261.63, dur: 0.07, vol: 0.07 },
        { type: 'sawtooth', from: 329.63, dur: 0.07, vol: 0.07, at: 1 },
        { type: 'sawtooth', from: 392, dur: 0.07, vol: 0.07, at: 2 },
        { type: 'sawtooth', from: 523.25, dur: 0.16, vol: 0.07, at: 3 },
      ], 160);
    },
    overSweep() {
      this.stopMusic();
      this.tone({ type: 'sawtooth', from: 420, to: 55, dur: 0.9, vol: 0.25 });
      this.burst({ dur: 0.5, vol: 0.3, freq: 500 });
    },
  };

  // ---------- state ----------
  const S = { START: 0, PLAYING: 1, DYING: 2, OVER: 3 };
  let state = S.START;

  // ---------- mode & difficulty ----------
  const MODES = { solo: 1, duo: 2 };
  let modeKey = localStorage.getItem('neonDrift.mode');
  if (!MODES[modeKey]) modeKey = 'solo';

  const DIFFS = {
    chill:     { name: 'CHILL',     mult: 1,   lives: 4, ramp: 0.75, spawnEvery: 1.2, speed: 0.82, powerups: 1.5 },
    normal:    { name: 'NORMAL',    mult: 1.5, lives: 3, ramp: 1,    spawnEvery: 1,   speed: 1,    powerups: 1 },
    nightmare: { name: 'NIGHTMARE', mult: 2.5, lives: 2, ramp: 1.3,  spawnEvery: 0.7, speed: 1.22, powerups: 0.45 },
  };
  let diffKey = localStorage.getItem('neonDrift.diff');
  if (!DIFFS[diffKey]) diffKey = 'normal';
  let DIFF = DIFFS[diffKey];

  const lbKeyFor = () => modeKey + ':' + diffKey;
  const lbAll = () => JSON.parse(localStorage.getItem('neonDrift.lb') || '{}');

  // ---------- players ----------
  const P_COLORS = ['#4df3ff', '#ff5ce1'];
  const P_DARK = ['#0891b2', '#b3229a'];
  const makePlayer = i => ({
    idx: i,
    x: i === 0 ? W * 0.3 : W * 0.7,
    y: H - 70, w: 34, h: 22, speed: 470,
    targetX: null, inv: 0, dead: false,
    score: 0, combo: 1, comboTimer: 0, lives: DIFF.lives,
    active: { shield: 0, slow: 0, magnet: 0, rapid: 0, nova: 0, god: 0 },
    fireT: 0,
    trail: [],
  });
  let players = [makePlayer(0)];
  const alive = () => players.filter(p => !p.dead);
  const topScore = () => Math.max(...players.map(p => p.score));

  // ---------- world ----------
  const COMBO_MAX = 5;
  let hazards = [], orbs = [], particles = [], floaters = [], stars = [], pups = [], bullets = [], drones = [], pshots = [], minis = [];
  let elapsed = 0, spawnTimer = 0.6, orbTimer = 0.5, pupTimer = 6, gridOff = 0, shake = 0, dyingT = 0;
  let timeScale = 1;

  // ---------- boss ----------
  const BOSS = {
    r: 46,
    hpMax: 9,
    interval: 60,
    warnFor: 3,
    colors: ['#ff3860', '#ff5ce1', '#ff9f43'],
    names: ['SENTINEL PRIME', 'VOID WEAVER', 'OMEGA CORE'],
  };
  let boss = null;            // active boss
  let bossWarn = 0;           // warning countdown
  let nextBossAt = BOSS.interval; // world-time of next spawn

  const PUPS = {
    shield: { color: '#7dff9e', label: 'SHLD', dur: 6,  max: 12, capBonus: 80 },
    slow:   { color: '#b366ff', label: 'SLOW', dur: 5,  max: 10, capBonus: 80 },
    magnet: { color: '#ff9f43', label: 'MAGN', dur: 7,  max: 14, capBonus: 80 },
    rapid:  { color: '#4df3ff', label: 'RPD',  dur: 7,  max: 14, capBonus: 80 },
    nova:   { color: '#ffd166', label: 'NOVA', dur: 0,  max: 0,  capBonus: 0  }, // instant burst
    god:    { color: '#ffffff', label: 'GOD',  dur: 6,  max: 12, capBonus: 0  }, // OVERDRIVE — hidden drop
  };
  // single source of truth: drives both real drops and the start-screen rate chips
  const PUP_BAG = ['shield', 'rapid', 'magnet', 'rapid', 'slow', 'nova', 'magnet', 'rapid', 'god'];
  let pupChain = { kind: null, n: 0, t: 0 }; // 3 same-kind pickups within 5s -> OVERDRIVE

  // ---------- drones (shooter enemies) ----------
  const DRONE = { r: 13, fireEvery: 1.7, max: 3, every: 11 };
  let droneTimer = 14;
  function spawnDrone() {
    drones.push({
      x: rand(60, W - 60), y: -30, ty: rand(80, 190),
      hp: 3, r: DRONE.r, fireT: rand(0.9, 1.6), t: rand(0, TAU),
      drift: Math.random() < 0.5 ? 1 : -1, flash: 0,
    });
  }

  // ---------- V-formation sweeps ----------
  const FORM = { size: 5, gap: 46, drop: 34, speed: 150, every: 24, hp: 4, bonus: 40 };
  let form = null;        // active formation anchor { x, dir, t, entered }
  let formTimer = 20;
  function spawnFormation() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    form = { x: dir === 1 ? -80 : W + 80, dir, t: 0, entered: false };
    for (let i = 0; i < FORM.size; i++) {
      drones.push({
        x: form.x, y: -40 - i * 8, slot: i, form: true,
        hp: FORM.hp, r: DRONE.r, fireT: 0.6 + i * 0.35, t: rand(0, TAU), flash: 0,
      });
    }
    floater(W / 2, 190, '!! V-WAVE INCOMING !!', '#ff9f43', 18);
    AudioSys.bossWarning();
  }

  // ---------- mini-drone swarms (kamikaze homing) ----------
  const SWARM = { every: 30, count: 7, hp: 1, spd: 120, bonus: 15, r: 8, life: 8 };
  let swarmTimer = 30;
  function spawnSwarm() {
    for (let i = 0; i < SWARM.count; i++) {
      minis.push({
        x: rand(30, W - 30), y: rand(-160, -20),
        vx: rand(-30, 30), vy: rand(80, 130),
        hp: SWARM.hp, r: SWARM.r, t: rand(0, TAU), flash: 0, life: SWARM.life,
      });
    }
    floater(W / 2, 230, 'SWARM INCOMING', '#ff5c7a', 16);
    AudioSys.swarmAlert();
  }

  function updateMinis(wdt, dt) {
    for (const m of minis) {
      const al = alive();
      const tgt = al.length ? al.reduce((a, b) => Math.abs(a.x - m.x) < Math.abs(b.x - m.x) ? a : b) : null;
      const spd = SWARM.spd + Math.min(elapsed * 0.8, 70);
      if (tgt) {
        const dx = tgt.x - m.x, dy = tgt.y - m.y;
        const dist = Math.hypot(dx, dy) || 1;
        m.vx += (dx / dist * spd - m.vx) * Math.min(dt * 2.4, 1);
        m.vy += (dy / dist * spd - m.vy) * Math.min(dt * 2.4, 1);
      }
      m.x += m.vx * wdt; m.y += m.vy * wdt;
      m.t += wdt;
      m.flash = Math.max(0, m.flash - dt * 5);
      m.life -= dt;
      if (m.life <= 0) m.dead = true; // gives up and dives past
      for (const p of alive()) {
        if (p.inv <= 0 && p.active.god <= 0 && Math.hypot(p.x - m.x, p.y - m.y) < m.r + 14) {
          m.dead = true;
          if (p.active.shield > 0) {
            p.active.shield = 0;
            burst(m.x, m.y, '#7dff9e', 14, 180);
            floater(p.x, p.y - 30, 'BLOCKED', '#7dff9e', 12);
          } else applyHit(p, m);
          break;
        }
      }
    }
    minis = minis.filter(m => !m.dead && m.y < H + 30 && m.x > -30 && m.x < W + 30);
  }

  for (let i = 0; i < 70; i++) {
    stars.push({ x: rand(0, W), y: rand(0, H), r: rand(0.5, 1.8), spd: rand(12, 45), tw: rand(0, TAU) });
  }

  // ---------- tuning ----------
  const hazardSpeed = () => (150 + Math.min(elapsed * 5 * DIFF.ramp, 270)) * DIFF.speed;
  const spawnInterval = () => Math.max(0.3 * DIFF.ramp, DIFF.spawnEvery * (0.95 - elapsed * 0.011 * DIFF.ramp));

  function pickHazardType() {
    const roll = Math.random();
    if (elapsed > 25 && roll < 0.16) return 'comet';
    if (elapsed > 12 && roll < 0.42) return 'drifter';
    return 'faller';
  }

  function spawnHazard() {
    const type = pickHazardType();
    const h = {
      type,
      x: rand(28, W - 28), y: -34, prevY: -34,
      r: type === 'comet' ? rand(9, 12) : rand(11, 17),
      vy: hazardSpeed() * rand(0.9, 1.15),
      phase: rand(0, TAU),
      scored: false,
    };
    if (type === 'drifter') h.vy *= 0.72;
    if (type === 'comet') h.vy *= 1.85;
    hazards.push(h);
  }

  function spawnOrb() {
    orbs.push({ x: rand(30, W - 30), y: -20, r: 10, vy: Math.min(120 + elapsed * 2 * DIFF.ramp, 260), phase: rand(0, TAU) });
  }

  function spawnPup() {
    const kind = PUP_BAG[Math.floor(Math.random() * PUP_BAG.length)];
    pups.push({ kind, x: rand(36, W - 36), y: -18, r: 13, vy: 105 * DIFF.speed, phase: rand(0, TAU) });
  }

  function spawnBoss() {
    const cycle = Math.floor((nextBossAt - BOSS.interval) / BOSS.interval); // 0-based
    boss = {
      x: W / 2, y: -80, ty: 130,
      r: BOSS.r,
      hp: BOSS.hpMax + cycle * 3,
      hpMax: BOSS.hpMax + cycle * 3,
      phase: 0,
      t: 0,
      fireT: 2.2,
      life: 25, // departs if not defeated
      leaving: false,
      dir: Math.random() < 0.5 ? 1 : -1,
      name: BOSS.names[cycle % BOSS.names.length],
      hitFlash: 0,
    };
    el.bossName.textContent = boss.name;
    el.bossWrap.classList.remove('hidden');
    if (AudioSys.jingle) AudioSys.jingle.boss = true;
  }

  function killBoss() {
    const bonus = Math.round(250 * DIFF.mult * (1 + (boss.hpMax - BOSS.hpMax) / 9));
    for (const p of alive()) p.score += bonus;
    hudScores();
    floater(boss.x, boss.y, 'BOSS DOWN +' + bonus, '#7dff9e', 22);
    for (let i = 0; i < 70; i++) {
      const a = rand(0, TAU), s = rand(60, 340);
      particles.push({
        x: boss.x, y: boss.y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.5, 1.2), max: 1.2, size: rand(2, 5),
        color: ['#ff3860', '#ff5ce1', '#ffd166', '#7dff9e'][i % 4],
      });
    }
    for (let i = 0; i < 7; i++) { // celebration orb shower
      orbs.push({ x: rand(40, W - 40), y: rand(-260, -30), r: 10, vy: rand(100, 170), phase: rand(0, TAU) });
    }
    shake = 20;
    AudioSys.bossDefeated();
    boss = null;
    el.bossWrap.classList.add('hidden');
    if (AudioSys.jingle) AudioSys.jingle.boss = false;
    nextBossAt = elapsed + BOSS.interval;
  }

  // ---------- juice ----------
  function burst(x, y, color, n, speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(speed * 0.3, speed);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: rand(0.35, 0.8), max: 0.8, size: rand(1.5, 4), color,
      });
    }
  }

  function floater(x, y, text, color, size = 16) {
    floaters.push({ x, y, text, color, size, life: 1 });
  }

  // ---------- HUD ----------
  function hudScores() { el.score.textContent = players[0].score; if (players[1]) el.score2.textContent = players[1].score; }
  function hudBest() { el.best.textContent = lbAll()[lbKeyFor()]?.[0]?.score || 0; }
  function hudLives() {
    el.lives.innerHTML = Array.from({ length: DIFF.lives }, (_, i) =>
      `<span class="heart ${i < players[0].lives ? 'on' : 'off'}">\u2665</span>`).join('');
    if (players[1]) {
      el.lives2.innerHTML = Array.from({ length: DIFF.lives }, (_, i) =>
        `<span class="heart ${i < players[1].lives ? 'on' : 'off'}">\u2665</span>`).join('');
    }
  }
  function hudPups() {
    el.pups.innerHTML = '';
    for (const k of Object.keys(PUPS)) {
      let t = 0;
      for (const p of alive()) t = Math.max(t, p.active[k]); // show the strongest active
      if (t <= 0) continue;
      const d = document.createElement('div');
      d.className = 'pbadge' + (t < 1.6 ? ' low' : '');
      d.style.setProperty('--c', PUPS[k].color);
      d.textContent = PUPS[k].label;
      const bar = document.createElement('i');
      bar.style.width = Math.min(t / PUPS[k].dur * 100, 100) + '%';
      d.appendChild(bar);
      el.pups.appendChild(d);
    }
  }
  // ---------- competition HUD ----------
  let lastChip = [0, 0];
  function hudCombo() {
    const duo = players.length > 1;
    if (duo && (state === S.PLAYING || state === S.DYING)) {
      // per-player combo chips
      for (let i = 0; i < 2; i++) {
        const p = players[i];
        const chip = i === 0 ? el.combo : el.combo2;
        if (p.combo > 1) {
          chip.textContent = 'P' + (i + 1) + ' \u00d7' + p.combo;
          chip.className = 'combo-chip p' + (i + 1) +
            (p.combo >= COMBO_MAX ? ' spike' : '') +
            (p.comboTimer < 1.2 ? ' fading' : '');
          if (p.combo > lastChip[i]) { void chip.offsetWidth; chip.classList.add('pop'); }
        } else {
          chip.className = 'combo-chip hidden';
        }
        lastChip[i] = p.combo;
      }
      // live lead indicator
      const a = players[0].score, b = players[1].score;
      if (a === b) {
        el.lead.textContent = 'TIED ' + a;
        el.lead.className = 'lead tied';
      } else {
        const leader = a > b ? 0 : 1;
        el.lead.textContent = 'P' + (leader + 1) + ' +' + Math.abs(a - b);
        el.lead.className = 'lead p' + (leader + 1);
      }
    } else {
      const p = players[0];
      if (p.combo > 1 && state !== S.OVER) {
        el.combo.textContent = '\u00d7' + p.combo;
        el.combo.className = 'combo-chip p1' + (p.combo >= COMBO_MAX ? ' spike' : '');
        void el.combo.offsetWidth;
        el.combo.classList.add('pop');
      } else {
        el.combo.className = 'combo-chip hidden';
      }
      el.combo2.className = 'combo-chip hidden';
      el.lead.className = 'lead hidden';
    }
    hudPups();
  }
  function hudBoss() {
    if (boss) el.bossBar.style.width = (boss.hp / boss.hpMax * 100) + '%';
  }

  // ---------- power-ups ----------
  function activatePup(p, kind) {
    const cfg = PUPS[kind];
    if (kind === 'god') { grantGod(p); hudPups(); return; }
    // stacking: refresh to full, then stack remaining time up to the cap
    if (p.active[kind] > 0) p.active[kind] = Math.min(cfg.max, p.active[kind] + cfg.dur * 0.75);
    else p.active[kind] = cfg.dur;
    if (p.active[kind] >= cfg.max) { // at cap: instant score dividend
      const bonus = Math.round(cfg.capBonus * DIFF.mult);
      p.score += bonus; hudScores();
      floater(p.x, p.y - 62, 'MAXED +' + bonus, cfg.color, 14);
    }
    // chain counter: 3 same-kind pickups within 5s triggers OVERDRIVE
    const now = performance.now() / 1000;
    if (pupChain.kind === kind && now - pupChain.t < 5) pupChain.n++;
    else pupChain = { kind, n: 1, t: now };
    if (pupChain.n >= 3 && p.active.god <= 0) {
      pupChain = { kind: null, n: 0, t: 0 };
      grantGod(p);
    }
    hudPups();
    burst(p.x, p.y - 10, cfg.color, 18, 200);
    floater(p.x, p.y - 40, kind.toUpperCase() + '!', cfg.color, 16);
    if (kind === 'shield') AudioSys.pShield();
    if (kind === 'slow') AudioSys.pSlow();
    if (kind === 'magnet') AudioSys.pMagnet();
    if (kind === 'rapid') AudioSys.pRapid();
    if (kind === 'nova') AudioSys.pNova();
    if (kind === 'nova') fireNova(p);
  }

  function grantGod(p) {
    p.active.god = Math.min(PUPS.god.max, (p.active.god || 0) + PUPS.god.dur * 0.75); // god stacks too
    p.inv = Math.max(p.inv, 0.8);
    burst(p.x, p.y, '#ffffff', 46, 340);
    burst(p.x, p.y, '#ffd166', 24, 240);
    shake = Math.max(shake, 10);
    floater(p.x, p.y - 56, 'OVERDRIVE!', '#ffffff', 20);
    AudioSys.pGod();
  }

  function fireNova(p) {
    for (let i = 0; i < 5; i++) {
      pshots.push({ x: p.x + (i - 2) * 7, y: p.y - 18, vx: (i - 2) * 34, vy: -580, r: 4, life: 2, c: '#ffd166' });
    }
  }

  function playerShoot(p) {
    pshots.push({ x: p.x, y: p.y - 16, vx: 0, vy: -560, r: 3.5, life: 2, c: P_COLORS[p.idx] });
    if (p.active.god > 0) { // OVERDRIVE: every shot carries a nova fan
      pshots.push({ x: p.x - 8, y: p.y - 12, vx: -110, vy: -540, r: 3.5, life: 2, c: '#ffd166' });
      pshots.push({ x: p.x + 8, y: p.y - 12, vx: 110, vy: -540, r: 3.5, life: 2, c: '#ffd166' });
    }
    AudioSys.shoot();
  }

  function updatePShots(wdt, dt) {
    for (const b of pshots) {
      b.x += b.vx * wdt; b.y += b.vy * wdt; b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      for (const d of drones) {
        if (!d.dead && Math.hypot(d.x - b.x, d.y - b.y) < d.r + b.r) {
          b.dead = true; d.hp -= 1; d.flash = 1;
          burst(b.x, b.y, '#4df3ff', 6, 120);
          if (d.hp <= 0) {
            d.dead = true;
            const bonus = Math.round((d.form ? FORM.bonus : 25) * DIFF.mult);
            const shooter = alive().sort((a, q) => Math.abs(a.x - d.x) - Math.abs(q.x - d.x))[0] || players[0];
            shooter.score += bonus; hudScores();
            floater(d.x, d.y, '+' + bonus, '#4df3ff', 14);
            burst(d.x, d.y, '#ff3860', 26, 220);
            burst(d.x, d.y, '#ffd166', 12, 170);
            AudioSys.droneDie();
          }
          break;
        }
      }
      if (b.dead) continue;
      for (const m of minis) {
        if (!m.dead && Math.hypot(m.x - b.x, m.y - b.y) < m.r + b.r) {
          b.dead = true; m.hp -= 1; m.flash = 1;
          burst(b.x, b.y, '#ff5c7a', 6, 120);
          if (m.hp <= 0) {
            m.dead = true;
            const bonus = Math.round(SWARM.bonus * DIFF.mult);
            const shooter = alive().sort((a, q) => Math.abs(a.x - d0x(m)) - Math.abs(q.x - d0x(m)))[0] || players[0];
            shooter.score += bonus; hudScores();
            floater(m.x, m.y, '+' + bonus, '#ff5c7a', 12);
            burst(m.x, m.y, '#ff5c7a', 16, 180);
            AudioSys.droneDie();
          }
          break;
        }
      }
      if (b.dead) continue;
      if (boss && !boss.leaving && Math.hypot(boss.x - b.x, boss.y - b.y) < boss.r + b.r) {
        b.dead = true;
        burst(b.x, b.y, '#4df3ff', 6, 140);
        bossHit(1, b.x, b.y);
      }
    }
    pshots = pshots.filter(b => !b.dead && b.y > -30 && b.y < H + 30);
  }

  function updateDrones(wdt, dt) {
    if (form) {
      form.t += wdt;
      if (!form.entered) {
        form.x += form.dir * FORM.speed * wdt;
        if ((form.dir === 1 && form.x > W / 2) || (form.dir === -1 && form.x < W / 2)) form.entered = true;
      } else {
        form.x = W / 2 + Math.sin(form.t * 0.55) * (W / 2 - 110) * form.dir;
      }
    }
    for (const d of drones) {
      if (d.form && form) {
        const i = d.slot;
        const k = i <= 2 ? i : 5 - i;        // 0,1,2,1,0 — V depth
        const s = i <= 2 ? 1 : -1;           // wings left/right
        d.x = form.x + s * k * FORM.gap;
        const ty = 60 + k * FORM.drop;       // apex (k=2) sits lowest — a proper V
        d.y = Math.min(d.y + 95 * wdt, ty);  // descend to slot, then hold formation
        d.t += wdt;
        d.flash = Math.max(0, d.flash - dt * 5);
        d.fireT -= wdt;
        if (d.fireT <= 0 && d.y > 30) {
          d.fireT = rand(1.1, 2.2);
          const al = alive();
          const tgt = al[Math.floor(Math.random() * al.length)];
          if (tgt) {
            const dx = tgt.x - d.x, dy = tgt.y - d.y;
            const dist = Math.hypot(dx, dy) || 1;
            const spd = 170 + Math.min(elapsed * 1.2, 120);
            bullets.push({ x: d.x, y: d.y + 12, vx: dx / dist * spd, vy: dy / dist * spd, r: 4.5, life: 6 });
            AudioSys.bossShot();
          }
        }
        continue;
      }
      if (d.y < d.ty) d.y += 95 * wdt;
      else {
        d.x += d.drift * 60 * wdt;
        if (d.x < 40 || d.x > W - 40) d.drift *= -1;
        d.x = clamp(d.x, 40, W - 40);
      }
      d.t += wdt;
      d.flash = Math.max(0, d.flash - dt * 5);
      d.fireT -= wdt;
      if (d.fireT <= 0 && d.y >= d.ty - 10) {
        d.fireT = Math.max(0.8, DRONE.fireEvery - elapsed * 0.004);
        const al = alive();
        const tgt = al[Math.floor(Math.random() * al.length)];
        if (tgt) {
          const dx = tgt.x - d.x, dy = tgt.y - d.y;
          const dist = Math.hypot(dx, dy) || 1;
          const spd = 170 + Math.min(elapsed * 1.2, 120);
          bullets.push({ x: d.x, y: d.y + 12, vx: dx / dist * spd, vy: dy / dist * spd, r: 4.5, life: 6 });
          AudioSys.bossShot();
        }
      }
    }
    if (form && !drones.some(d => d.form && !d.dead)) { form = null; floater(W / 2, 200, 'V-WAVE CLEARED', '#7dff9e', 15); }
    drones = drones.filter(d => !d.dead && d.y < H + 40);
  }

  // ---------- leaderboard ----------
  function renderLeaderboard(highlightScore) {
    const list = lbAll()[lbKeyFor()] || [];
    el.lbKey.textContent = (modeKey === 'duo' ? '2P' : 'SOLO') + ' · ' + DIFF.name;
    el.lbList.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="lb-meta">no runs yet — set the first record</span>';
      el.lbList.appendChild(li);
      return;
    }
    list.forEach((e, i) => {
      const li = document.createElement('li');
      if (i === 0) li.classList.add('top');
      if (highlightScore != null && e.score === highlightScore) li.classList.add('top');
      const when = e.ts ? ' · ' + new Date(e.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : e.date ? ' · ' + e.date : '';
      li.innerHTML = `<span>${i + 1}. ${e.mode === 'duo' ? '2P' : 'SOLO'}${when}</span><b>${e.score}</b>`;
      el.lbList.appendChild(li);
    });
  }

  function saveScore() {
    const all = lbAll();
    const key = lbKeyFor();
    const list = all[key] || [];
    const score = topScore();
    // keep only the top-5 across all runs (scores > 0)
    if (score <= 0 || (list.length >= 5 && score <= list[list.length - 1].score)) return false;
    const entry = {
      score,
      mode: modeKey,
      ts: Date.now(), // real timestamp; displayed as local date + time
      date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), // legacy fallback
    };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    all[key] = list.slice(0, 5);
    localStorage.setItem('neonDrift.lb', JSON.stringify(all));
    return all[key][0].score === score;
  }

  // ---------- flow ----------
  function start() {
    AudioSys.init();
    AudioSys.resume();
    hazards = []; orbs = []; particles = []; floaters = []; pups = []; bullets = []; drones = []; pshots = []; minis = [];
    form = null; formTimer = 20; swarmTimer = 30;
    droneTimer = 14;
    players = Array.from({ length: MODES[modeKey] }, (_, i) => makePlayer(i));
    elapsed = 0; spawnTimer = 0.6; orbTimer = 0.5; pupTimer = 6; shake = 0; dyingT = 0;
    timeScale = 1;
    boss = null; bossWarn = 0; nextBossAt = BOSS.interval;
    el.p1box.classList.remove('hidden');
    el.hudRight.classList.toggle('hidden', modeKey === 'duo');
    el.p2box.classList.toggle('hidden', modeKey !== 'duo');
    el.bossWrap.classList.add('hidden');
    sticks.move = null; sticks.fire = null; // release touch sticks between runs
    el.start.classList.add('hidden');
    el.over.classList.add('hidden');
    el.newBest.classList.add('hidden');
    el.winner.classList.add('hidden');
    el.finalScore2Row.classList.add('hidden');
    hudScores(); hudBest(); hudLives(); hudCombo();
    state = S.PLAYING;
    AudioSys.startJingle();
  }

  function applyHit(p, h) {
    if (p.active.god > 0) { // OVERDRIVE: phase through harm
      burst(h.x, h.y, '#ffffff', 12, 160);
      floater(p.x, p.y - 34, 'PHASED', '#ffffff', 13);
      AudioSys.tone({ type: 'sine', from: 1200, to: 1800, dur: 0.12, vol: 0.12 });
      return;
    }
    if (p.active.shield > 0) {
      p.active.shield = 0;
      burst(p.x, p.y, '#7dff9e', 30, 240);
      shake = Math.max(shake, 7);
      floater(p.x, p.y - 34, 'SHIELD DOWN', '#7dff9e', 14);
      AudioSys.tone({ type: 'triangle', from: 700, to: 180, dur: 0.3, vol: 0.22 });
      return;
    }
    burst(h.x, h.y, '#ff3860', 26, 220);
    burst(p.x, p.y, P_COLORS[p.idx], 14, 180);
    shake = 14;
    p.combo = 1; p.comboTimer = 0;
    p.lives--; hudLives(); hudCombo();
    AudioSys.hit();
    if (p.lives <= 0) {
      p.dead = true;
      burst(p.x, p.y, '#ff3860', 60, 320);
      burst(p.x, p.y, '#ffd166', 30, 240);
      shake = 22;
      p.targetX = null;
      if (!alive().length) {
        state = S.DYING;
        dyingT = 1.0;
        AudioSys.overSweep();
      } else if (players.length > 1) {
        floater(p.x, p.y - 50, 'P' + (p.idx + 1) + ' DOWN', '#ff3860', 18);
      }
    } else {
      p.inv = 1.6;
    }
  }

  function showGameOver() {
    state = S.OVER;
    const bests = lbAll();
    const key = lbKeyFor();
    const list = bests[key] || [];
    const prevTop = list.length ? list[0].score : 0;
    const finalTop = topScore();
    const isNewBest = finalTop > prevTop;
    el.finalScore.textContent = players[0].score;
    if (players[1]) {
      el.finalScore2.textContent = players[1].score;
      el.finalScore2Row.classList.remove('hidden');
    }
    saveScore(); // saves whenever the run makes the top-5 (not just record-breakers)
    hudBest();
    el.finalBest.textContent = lbAll()[key]?.[0]?.score || 0;
    el.newBest.classList.toggle('hidden', !isNewBest);
    if (players.length > 1) {
      const [a, b] = players;
      if (a.score > b.score) { el.winner.textContent = 'P1 WINS!'; el.winner.classList.remove('hidden'); }
      else if (b.score > a.score) { el.winner.textContent = 'P2 WINS!'; el.winner.classList.remove('hidden'); }
      else { el.winner.textContent = 'DEAD HEAT'; el.winner.classList.remove('hidden'); }
    }
    renderLeaderboard(isNewBest ? finalTop : null);
    hudCombo(); // refresh chips/lead so nothing stale lingers on the game-over screen
    el.over.classList.remove('hidden');
  }

  function toMenu() {
    state = S.START;
    el.over.classList.add('hidden');
    el.start.classList.remove('hidden');
    el.bossWrap.classList.add('hidden');
    hudCombo(); // clear leftover combo chips / lead indicator
    hazards = []; orbs = []; pups = []; bullets = [];
    boss = null; bossWarn = 0;
  }

  // ---------- boss update ----------
  function updateBoss(wdt, dt) {
    if (bossWarn > 0) {
      bossWarn -= dt;
      if (bossWarn <= 0) spawnBoss();
      return;
    }
    if (!boss) {
      if (elapsed >= nextBossAt - BOSS.warnFor && bossWarn <= 0 && nextBossAt > 0) {
        bossWarn = BOSS.warnFor;
        floater(W / 2, 160, '!! BOSS APPROACHING !!', '#ff5ce1', 20);
        AudioSys.bossWarning();
      }
      return;
    }

    if (boss.leaving) {
      boss.y -= 130 * wdt;
      if (boss.y < -boss.r - 20) {
        boss = null;
        el.bossWrap.classList.add('hidden');
        if (AudioSys.jingle) AudioSys.jingle.boss = false;
        nextBossAt = elapsed + BOSS.interval;
      }
      return;
    }

    boss.life -= wdt;
    if (boss.life <= 0) {
      boss.leaving = true;
      floater(W / 2, 150, 'BOSS RETREATS', '#8fa8cf', 16);
      return;
    }

    boss.t += wdt;
    boss.hitFlash = Math.max(0, boss.hitFlash - dt * 4);
    // entry then sine patrol
    if (boss.y < boss.ty) boss.y += 90 * wdt;
    else boss.x = W / 2 + Math.sin(boss.t * 0.7) * (W / 2 - boss.r - 30) * boss.dir;

    // aimed bullets (faster + more frequent in later phases)
    boss.fireT -= wdt;
    if (boss.fireT <= 0 && boss.y >= boss.ty - 20 && !boss.leaving) {
      boss.fireT = Math.max(0.9, 2.2 - boss.phase * 0.5);
      const targets = alive();
      if (targets.length) {
        const tgt = targets[Math.floor(Math.random() * targets.length)];
        const dx = tgt.x - boss.x, dy = tgt.y - boss.y;
        const d = Math.hypot(dx, dy) || 1;
        const spd = 130 + boss.phase * 35 + DIFF.ramp * 20;
        bullets.push({ x: boss.x, y: boss.y + boss.r * 0.6, vx: dx / d * spd, vy: dy / d * spd, r: 5, life: 6 });
        AudioSys.bossShot();
      }
    }

    // boss vs players (touch damage)
    for (const p of alive()) {
      if (p.inv <= 0 && p.active.shield <= 0 &&
          Math.hypot(p.x - boss.x, p.y - boss.y) < boss.r + 16) {
        applyHit(p, boss);
      }
    }
  }

  function updateBullets(wdt, dt) {
    for (const b of bullets) {
      b.x += b.vx * wdt;
      b.y += b.vy * wdt;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      for (const p of alive()) {
        if (p.inv <= 0 && p.active.god <= 0 && Math.hypot(p.x - b.x, p.y - b.y) < b.r + 14) {
          b.dead = true;
          if (p.active.shield > 0) {
            p.active.shield = 0;
            burst(b.x, b.y, '#7dff9e', 16, 200);
            floater(p.x, p.y - 30, 'BLOCKED', '#7dff9e', 13);
            AudioSys.tone({ type: 'triangle', from: 700, to: 180, dur: 0.25, vol: 0.2 });
          } else {
            applyHit(p, b);
          }
          break;
        }
      }
    }
    bullets = bullets.filter(b => !b.dead && b.y < H + 30 && b.y > -30 && b.x > -30 && b.x < W + 30);
  }

  // ---------- update ----------
  function update(dt) {
    gridOff = (gridOff + 60 * dt) % 80;
    for (const s of stars) {
      s.y += s.spd * dt;
      if (s.y > H + 2) { s.y = -2; s.x = rand(0, W); }
    }
    shake = Math.max(0, shake - 46 * dt);

    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 220 * dt; p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
    for (const f of floaters) { f.y -= 42 * dt; f.life -= dt * 1.15; }
    floaters = floaters.filter(f => f.life > 0);

    if (state === S.DYING) {
      dyingT -= dt;
      moveHazards(dt, false);
      if (dyingT <= 0) showGameOver();
      return;
    }
    if (state !== S.PLAYING) return;

    // slow-mo bends world time, not player time
    const anySlow = alive().some(p => p.active.slow > 0);
    timeScale += ((anySlow ? 0.4 : 1) - timeScale) * Math.min(dt * 8, 1);
    elapsed += dt * timeScale;
    const wdt = dt * timeScale;

    // --- players ---
    for (const p of players) {
      if (p.dead) continue;
      if (p.inv > 0) p.inv -= dt;
      for (const k of Object.keys(p.active)) {
        if (p.active[k] > 0) {
          p.active[k] -= dt;
          if (p.active[k] <= 0) {
            p.active[k] = 0;
            if (k === 'shield') floater(p.x, p.y - 34, 'SHIELD EXPIRED', '#7dff9e', 12);
          }
        }
      }
      const kr = keyState(p);
      if (p.targetX != null) {
        p.x += clamp(p.targetX - p.x, -p.speed * dt, p.speed * dt);
        // analog trim: drag offset adds fine control on the touch move-stick (duo P2)
        if (p.idx === 1 && players.length === 2 && sticks.move) {
          p.x += clamp(sticks.move.cx - sticks.move.ox, -30, 30) * dt * 3.5;
        }
      } else {
        const dir = (kr.right ? 1 : 0) - (kr.left ? 1 : 0);
        p.x += dir * p.speed * dt;
      }
      p.x = clamp(p.x, 24, W - 24);
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 16) p.trail.shift();
      // firing (W/Space for P1, ArrowUp for P2)
      p.fireT -= dt;
      if (p.fireT <= 0 && keyState(p).fire) {
        p.fireT = p.active.rapid > 0 ? 0.09 : p.active.nova > 0 ? 0.14 : 0.26;
        playerShoot(p);
      }
    }
    hudPups();

    // --- spawning ---
    spawnTimer -= wdt;
    if (spawnTimer <= 0) { spawnHazard(); spawnTimer = spawnInterval() * rand(0.75, 1.25); }
    orbTimer -= wdt;
    if (orbTimer <= 0) { spawnOrb(); orbTimer = rand(0.9, 1.5); }
    pupTimer -= wdt;
    if (pupTimer <= 0) { spawnPup(); pupTimer = rand(9, 16) * DIFF.powerups; }
    droneTimer -= wdt;
    if (droneTimer <= 0 && !form && drones.length < DRONE.max) { spawnDrone(); droneTimer = DRONE.every * rand(0.8, 1.2); }
    if (!form) {
      formTimer -= wdt;
      if (formTimer <= 0) { spawnFormation(); formTimer = FORM.every * rand(0.9, 1.2); }
    }
    swarmTimer -= wdt;
    if (swarmTimer <= 0) { spawnSwarm(); swarmTimer = SWARM.every * rand(0.85, 1.2); }
    updateMinis(wdt, dt);

    // --- combo decay ---
    for (const p of players) {
      if (!p.dead && p.combo > 1) {
        p.comboTimer -= dt;
        if (p.comboTimer <= 0) { p.combo = 1; }
      }
    }

    // --- orbs ---
    for (const o of orbs) {
      o.phase += wdt * 3;
      o.y += o.vy * wdt;
      let caughtBy = null;
      let bestD = Infinity;
      for (const p of alive()) {
        const magnetR = p.active.magnet > 0 ? 220 : 80;
        const pull = p.active.magnet > 0 ? 460 : 240;
        const dx = p.x - o.x, dy = p.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d < magnetR && d > 1) {
          o.x += (dx / d) * pull * dt;
          o.y += (dy / d) * pull * dt;
        }
        if (d < o.r + 22 && d < bestD) { bestD = d; caughtBy = p; }
      }
      if (caughtBy) {
        o.dead = true;
        const p = caughtBy;
        const gained = Math.round(10 * p.combo * DIFF.mult);
        p.score += gained; hudScores();
        floater(o.x, o.y - 14, (players.length > 1 ? 'P' + (p.idx + 1) + ' ' : '') + '+' + gained + (p.combo > 1 ? ' \u00d7' + p.combo : ''), '#ffd166', p.combo > 2 ? 18 : 15);
        burst(o.x, o.y, '#ffd166', 14, 150);
        AudioSys.catch_(p.combo);
        if (p.combo < COMBO_MAX) p.combo++;
        else if (Math.random() < 0.25) floater(o.x, o.y - 36, 'MAX COMBO!', '#4df3ff', 15);
        p.comboTimer = 4;
        hudCombo();
      } else if (o.y - o.r > H) {
        o.dead = true;
        // combo breaks for whoever was closest & magnetized it (cheap heuristic: nearest alive)
        const near = alive().sort((a, b) => Math.abs(a.x - o.x) - Math.abs(b.x - o.x))[0];
        if (near && near.combo > 1) {
          near.combo = 1;
          hudCombo();
          floater(near.x, near.y - 46, 'COMBO LOST', '#ff3860', 13);
        }
      } else if (boss && !boss.leaving && Math.hypot(o.x - boss.x, o.y - boss.y) < boss.r + o.r) {
        // the boss feeds on light — an orb slamming into it deals damage
        o.dead = true;
        burst(o.x, o.y, '#ff5ce1', 10, 160);
        bossHit(1, o.x, o.y);
      }
    }
    orbs = orbs.filter(o => !o.dead && o.y < H + 40);

    // --- power-up drops ---
    for (const p of pups) {
      p.phase += wdt * 2.5;
      p.y += p.vy * wdt;
      p.x += Math.sin(p.phase) * 24 * wdt;
      for (const pl of alive()) {
        if (Math.hypot(pl.x - p.x, pl.y - p.y) < p.r + 20) {
          p.dead = true;
          activatePup(pl, p.kind);
          break;
        }
      }
    }
    pups = pups.filter(p => !p.dead && p.y < H + 40);

    // --- boss cycle ---
    updateBoss(wdt, dt);
    updateBullets(wdt, dt);
    updateDrones(wdt, dt);
    updatePShots(wdt, dt);

    moveHazards(wdt, true);
  }

  function bossHit(amount, x, y) {
    if (!boss) return;
    boss.hp -= amount;
    boss.hitFlash = 1;
    burst(x, y, '#ff5ce1', 12, 180);
    shake = Math.max(shake, 6);
    hudBoss();
    const phaseSize = boss.hpMax / 3;
    const newPhase = Math.min(2, Math.floor((boss.hpMax - boss.hp) / phaseSize));
    if (newPhase > boss.phase) {
      boss.phase = newPhase;
      floater(boss.x, boss.y - boss.r - 16, 'PHASE ' + (boss.phase + 1) + '!', '#ff5ce1', 18);
      shake = 12;
      AudioSys.bossPhase();
    } else {
      AudioSys.bossHurt();
    }
    if (boss.hp <= 0) killBoss();
  }

  function moveHazards(dt, liveCollisions) {
    for (const h of hazards) {
      h.prevY = h.y;
      h.y += h.vy * dt;
      if (h.type === 'drifter') h.x += Math.sin(elapsed * 2.2 + h.phase) * 70 * dt;
      if (h.type === 'comet' && Math.random() < 0.5) {
        particles.push({
          x: h.x + rand(-3, 3), y: h.y - h.r, vx: rand(-15, 15), vy: rand(-60, -20),
          life: 0.3, max: 0.3, size: rand(1, 2.5), color: '#ff9f43',
        });
      }

      if (liveCollisions) {
        for (const p of alive()) {
          if (p.inv <= 0 && p.active.shield <= 0 &&
              circleRectHit(h.x, h.y, h.r * 0.85, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h)) {
            h.scored = true;
            applyHit(p, h);
            break;
          }
        }
      }

      if (liveCollisions && !h.scored) {
        for (const p of alive()) {
          if (h.prevY < p.y && h.y >= p.y) {
            h.scored = true;
            const dx = Math.abs(h.x - p.x);
            if (dx < h.r + 46) {
              p.score += 5; hudScores();
              floater(p.x + (h.x > p.x ? 34 : -34), p.y - 26, (players.length > 1 ? 'P' + (p.idx + 1) + ' ' : '') + 'NEAR +5', '#4df3ff', 13);
              AudioSys.near();
            }
            break;
          }
        }
      }
    }
    hazards = hazards.filter(h => h.y - h.r < H + 40);
  }

  // ---------- draw ----------
  function drawGrid() {
    ctx.strokeStyle = 'rgba(77, 243, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(77, 243, 255, 0.075)';
    ctx.beginPath();
    for (let y = -80 + gridOff; y <= H; y += 80) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  function drawStars() {
    for (const s of stars) {
      const a = 0.25 + 0.35 * Math.abs(Math.sin(s.tw + performance.now() / 900));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#9fd8ff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer(p) {
    if (p.dead) return;
    const color = P_COLORS[p.idx], dark = P_DARK[p.idx];
    for (let i = 0; i < p.trail.length; i++) {
      const t = i / p.trail.length;
      ctx.globalAlpha = t * 0.22;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.trail[i].x, p.trail[i].y, 2 + t * 7, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const blink = p.inv > 0 && Math.floor(p.inv * 10) % 2 === 0;
    ctx.save();
    if (blink) ctx.globalAlpha = 0.35;

    const fl = rand(7, 15);
    ctx.fillStyle = color;
    ctx.globalAlpha *= 0.85;
    ctx.beginPath();
    ctx.moveTo(p.x - 5, p.y + p.h / 2);
    ctx.lineTo(p.x + 5, p.y + p.h / 2);
    ctx.lineTo(p.x, p.y + p.h / 2 + fl);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = blink ? 0.35 : 1;

    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = p.idx === 0 ? '#bffcff' : '#ffd9f6';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - p.h / 2 - 4);
    ctx.lineTo(p.x - p.w / 2, p.y + p.h / 2);
    ctx.lineTo(p.x + p.w / 2, p.y + p.h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 2);
    ctx.lineTo(p.x - 7, p.y + p.h / 2 - 2);
    ctx.lineTo(p.x + 7, p.y + p.h / 2 - 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (p.inv > 0) {
      ctx.strokeStyle = 'rgba(77, 243, 255, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 27, 0, TAU);
      ctx.stroke();
    }
    if (p.active.god > 0) { // OVERDRIVE aura: layered white halo + tri-wave rings
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const ph = performance.now() / 300 + i * 2.09;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 - i * 0.09})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 20 + ((ph % TAU) / TAU) * 22, 0, TAU);
        ctx.stroke();
      }
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 22;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 26, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (p.active.shield > 0) {
      const a = 0.35 + 0.25 * Math.sin(performance.now() / 120);
      ctx.strokeStyle = `rgba(125, 255, 158, ${a})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24, 0, TAU);
      ctx.stroke();
    }
  }

  function drawOrbs() {
    for (const o of orbs) {
      const pulse = 1 + Math.sin(o.phase) * 0.15;
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r * pulse, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff7e0';
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r * 0.45 * pulse, 0, TAU);
      ctx.fill();
    }
  }

  function drawBoss() {
    if (!boss) return;
    const c = BOSS.colors[boss.phase];
    const flash = boss.hitFlash;
    ctx.save();
    ctx.translate(boss.x, boss.y);
    // outer ring
    ctx.shadowColor = c;
    ctx.shadowBlur = 24 + flash * 30;
    ctx.strokeStyle = c;
    ctx.lineWidth = 3 + flash * 3;
    ctx.beginPath();
    ctx.arc(0, 0, boss.r, 0, TAU);
    ctx.stroke();
    // core
    ctx.fillStyle = flash > 0.3 ? '#ffffff' : 'rgba(5, 8, 18, 0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, boss.r * 0.72, 0, TAU);
    ctx.fill();
    // rotating spikes
    ctx.strokeStyle = c;
    ctx.lineWidth = 4;
    for (let i = 0; i < 3 + boss.phase; i++) {
      const a = boss.t * 1.2 + i * TAU / (3 + boss.phase);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * boss.r * 0.72, Math.sin(a) * boss.r * 0.72);
      ctx.lineTo(Math.cos(a) * (boss.r + 10), Math.sin(a) * (boss.r + 10));
      ctx.stroke();
    }
    // eye
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, 8 + Math.sin(boss.t * 4) * 2, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  function drawBullets() {
    for (const b of bullets) {
      ctx.shadowColor = '#ff3860';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ff3860';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffdde4';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.4, 0, TAU);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawDrones() {
    for (const d of drones) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(Math.sin(d.t * 5) * 0.08);
      const dc = d.form ? '#ff9f43' : '#ff3860';
      ctx.shadowColor = dc;
      ctx.shadowBlur = d.form ? 18 : 14;
      ctx.fillStyle = d.flash > 0.3 ? '#ffffff' : dc;
      ctx.beginPath();
      ctx.moveTo(0, d.r);
      ctx.lineTo(-d.r, -d.r * 0.55);
      ctx.lineTo(0, -d.r * 0.15);
      ctx.lineTo(d.r, -d.r * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffdde4';
      ctx.beginPath();
      ctx.arc(0, d.r * 0.35, 2.5, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.shadowBlur = 0;
    }
  }

  function drawMinis() {
    for (const m of minis) {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.t * 6);
      ctx.shadowColor = '#ff5c7a';
      ctx.shadowBlur = 12;
      ctx.fillStyle = m.flash > 0.3 ? '#ffffff' : '#ff5c7a';
      ctx.beginPath();
      ctx.moveTo(0, m.r);
      ctx.lineTo(-m.r * 0.85, -m.r * 0.6);
      ctx.lineTo(m.r * 0.85, -m.r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffe1e8';
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.shadowBlur = 0;
    }
  }

  function drawPShots() {
    for (const b of pshots) {
      ctx.shadowColor = b.c;
      ctx.shadowBlur = 10;
      ctx.fillStyle = b.c;
      ctx.beginPath();
      ctx.roundRect(b.x - 1.5, b.y - 9, 3, 12, 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function drawHazards() {
    for (const h of hazards) {
      if (h.type === 'faller') {
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.rotate(h.y * 0.02);
        ctx.shadowColor = '#ff3860';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#ff3860';
        ctx.beginPath();
        ctx.moveTo(0, -h.r); ctx.lineTo(h.r, 0); ctx.lineTo(0, h.r); ctx.lineTo(-h.r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (h.type === 'drifter') {
        ctx.shadowColor = '#b366ff';
        ctx.shadowBlur = 14;
        ctx.strokeStyle = '#b366ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * 0.45, 0, TAU);
        ctx.fillStyle = '#b366ff';
        ctx.fill();
      } else {
        const grad = ctx.createLinearGradient(h.x, h.y - h.r * 5, h.x, h.y);
        grad.addColorStop(0, 'rgba(255, 159, 67, 0)');
        grad.addColorStop(1, '#ff9f43');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(h.x - h.r * 0.7, h.y - h.r * 5);
        ctx.lineTo(h.x + h.r * 0.7, h.y - h.r * 5);
        ctx.lineTo(h.x, h.y);
        ctx.closePath();
        ctx.fill();
        ctx.shadowColor = '#ff9f43';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#ffd8a8';
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, TAU);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
  }

  function drawPups() {
    for (const p of pups) {
      const c = PUPS[p.kind].color;
      const pulse = 1 + Math.sin(p.phase) * 0.12;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.sin(p.phase * 0.7) * 0.2);
      ctx.shadowColor = c;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(5, 8, 18, 0.85)';
      ctx.beginPath();
      const s = p.r * pulse;
      ctx.roundRect(-s, -s, s * 2, s * 2, 5);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = c;
      ctx.font = '700 11px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(PUPS[p.kind].label.slice(0, 2), 0, 1);
      ctx.restore();
    }
  }

  function drawSticks() { // twin-stick hints for touch play (solo only)
    if (state !== S.PLAYING || players.length !== 1) return;
    const my = H - 84;
    if (!sticks.move && !sticks.fire && elapsed < 10) { // faint ghost hints on first seconds
      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = '#4df3ff'; ctx.lineWidth = 2;
      for (const hx of [W * 0.22, W * 0.78]) {
        ctx.beginPath(); ctx.arc(hx, my, 42, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(hx, my, 6, 0, TAU); ctx.fillStyle = '#4df3ff'; ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (sticks.move) {
      const s = sticks.move;
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = '#4df3ff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s.ox, s.oy, 42, 0, TAU); ctx.stroke();
      const dx = clamp(s.cx - s.ox, -42, 42), dy = clamp(s.cy - s.oy, -42, 42);
      ctx.fillStyle = '#4df3ff';
      ctx.beginPath(); ctx.arc(s.ox + dx, s.oy + dy, 15, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (sticks.fire) {
      ctx.globalAlpha = 0.3 + Math.sin(performance.now() / 90) * 0.08;
      ctx.strokeStyle = '#ff9f43'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(W * 0.78, my, 42, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(p.life / p.max, 0);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters() {
    ctx.textAlign = 'center';
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(f.life, 0);
      ctx.font = '700 ' + f.size + 'px ui-monospace, Consolas, monospace';
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawGrid();
    drawStars();
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawPups();
    drawOrbs();
    drawHazards();
    drawDrones();
    drawMinis();
    drawBoss();
    drawBullets();
    drawPShots();
    for (const p of players) drawPlayer(p);
    drawSticks();
    drawParticles();
    drawFloaters();
    ctx.restore();
  }

  // ---------- input ----------
  const keys = [
    { left: false, right: false, fire: false }, // P1: A/D move, W fires
    { left: false, right: false, fire: false }, // P2: arrows move, ArrowUp fires
  ];
  function keyState(p) {
    const fire = keys[p.idx] ? keys[p.idx].fire : false;
    if (p.targetX != null) return { left: false, right: false, fire };
    if (players.length === 1) {
      return { left: keys[0].left || keys[1].left, right: keys[0].right || keys[1].right, fire: keys[0].fire || keys[1].fire };
    }
    return keys[p.idx];
  }

  window.addEventListener('keydown', e => {
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' '].includes(k)) e.preventDefault();
    AudioSys.init();
    AudioSys.resume();
    if (state === S.START) {
      if (k === '1') { setDiff('chill'); return; }
      if (k === '2') { setDiff('normal'); return; }
      if (k === '3') { setDiff('nightmare'); return; }
      if (k === 's' || k === 'S') { setMode(modeKey === 'solo' ? 'duo' : 'solo'); return; }
    }
    if (k === 'a' || k === 'A') { keys[0].left = true; players[0].targetX = null; }
    if (k === 'd' || k === 'D') { keys[0].right = true; players[0].targetX = null; }
    if (k === 'ArrowLeft') { keys[1].left = true; if (players[1]) players[1].targetX = null; }
    if (k === 'ArrowRight') { keys[1].right = true; if (players[1]) players[1].targetX = null; }
    if (k === 'w' || k === 'W') keys[0].fire = true;
    if (k === 'ArrowUp') keys[1].fire = true;
    if (k === 'm' || k === 'M') AudioSys.setMuted(!AudioSys.muted);
    if (k === ' ') {
      if (state === S.START || state === S.OVER) start();
    }
    if ((k === 'r' || k === 'R') && state !== S.START) start();
  });

  window.addEventListener('keyup', e => {
    const k = e.key;
    if (k === 'a' || k === 'A') keys[0].left = false;
    if (k === 'd' || k === 'D') keys[0].right = false;
    if (k === 'ArrowLeft') keys[1].left = false;
    if (k === 'ArrowRight') keys[1].right = false;
    if (k === 'w' || k === 'W') keys[0].fire = false;
    if (k === 'ArrowUp') keys[1].fire = false;
  });

  function pointerX(e) {
    const rect = canvas.getBoundingClientRect();
    return clamp((e.clientX - rect.left) * (W / rect.width), 24, W - 24);
  }

  // ---------- twin-stick touch (left half = steer, right half = fire) ----------
  const sticks = { move: null, fire: null }; // move: {id, ox, oy, cx, cy} — fire: {id}
  function canvasXY(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
  }
  function releaseStick(e) {
    if (sticks.move && sticks.move.id === e.pointerId) { sticks.move = null; if (players[0]) players[0].targetX = null; }
    if (sticks.fire && sticks.fire.id === e.pointerId) { sticks.fire = null; keys[0].fire = false; }
    if (e.pointerType === 'mouse') keys[0].fire = false; // mouse fire release
  }
  canvas.addEventListener('pointerdown', e => {
    AudioSys.init();
    AudioSys.resume();
    if (state !== S.PLAYING || !players[0]) return;
    const pt = canvasXY(e);
    if (e.pointerType === 'mouse') {
      players[0].targetX = pointerX(e);
      keys[0].fire = true;
    } else if (pt.x < W / 2) {
      sticks.move = { id: e.pointerId, ox: pt.x, oy: pt.y, cx: pt.x, cy: pt.y }; // move stick
      players[0].targetX = pt.x;
    } else {
      sticks.fire = { id: e.pointerId };                                        // fire stick (tap or hold)
      keys[0].fire = true;
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') {
      if (state === S.PLAYING && players[0]) players[0].targetX = pointerX(e);
      return;
    }
    if (sticks.move && sticks.move.id === e.pointerId && players[0]) {
      const pt = canvasXY(e);
      sticks.move.cx = pt.x; sticks.move.cy = pt.y;
      players[0].targetX = clamp(pt.x, 24, W - 24); // ship tracks the finger
    }
  });
  window.addEventListener('pointerup', releaseStick);
  window.addEventListener('pointercancel', releaseStick);
  canvas.addEventListener('contextmenu', e => e.preventDefault()); // long-press guard

  el.start.addEventListener('pointerdown', () => start());
  el.restart.addEventListener('click', () => { start(); el.restart.blur(); });
  el.menu.addEventListener('click', () => { toMenu(); el.menu.blur(); });
  el.mute.addEventListener('click', () => {
    AudioSys.init();
    AudioSys.setMuted(!AudioSys.muted);
    el.mute.blur();
  });

  // ---------- mode & difficulty UI ----------
  const diffBtns = Array.from(document.querySelectorAll('.diff'));
  const modeBtns = Array.from(document.querySelectorAll('.mode'));
  function syncUI() {
    for (const b of diffBtns) b.classList.toggle('active', b.dataset.diff === diffKey);
    for (const b of modeBtns) b.classList.toggle('active', b.dataset.mode === modeKey);
    el.best.textContent = lbAll()[lbKeyFor()]?.[0]?.score || 0;
  }
  function setDiff(key) {
    if (!DIFFS[key]) return;
    diffKey = key;
    DIFF = DIFFS[key];
    localStorage.setItem('neonDrift.diff', key);
    syncUI();
    AudioSys.init();
    AudioSys.tone({ type: 'square', from: key === 'nightmare' ? 330 : key === 'chill' ? 440 : 392, to: 660, dur: 0.08, vol: 0.08 });
  }
  function setMode(key) {
    if (!MODES[key]) return;
    modeKey = key;
    localStorage.setItem('neonDrift.mode', key);
    syncUI();
    AudioSys.init();
    AudioSys.tone({ type: 'square', from: key === 'duo' ? 523 : 392, to: 784, dur: 0.09, vol: 0.09 });
  }
  for (const b of diffBtns) b.addEventListener('click', () => setDiff(b.dataset.diff));
  for (const b of modeBtns) b.addEventListener('click', () => setMode(b.dataset.mode));

  // ---------- boot ----------
  // deep links (PWA shortcuts): ?mode=duo&diff=nightmare
  try {
    const qp = new URLSearchParams(location.search);
    if (DIFFS[qp.get('diff')]) {
      diffKey = qp.get('diff');
      DIFF = DIFFS[diffKey];
      localStorage.setItem('neonDrift.diff', diffKey);
    }
    if (MODES[qp.get('mode')]) {
      modeKey = qp.get('mode');
      localStorage.setItem('neonDrift.mode', modeKey);
    }
  } catch { /* ignore malformed params */ }
  el.mute.textContent = AudioSys.muted ? '🔇' : '🔊';
  syncUI();

  // start-screen drop-rate chips — derived from the actual PUP_BAG weights
  {
    const counts = {};
    for (const k of PUP_BAG) counts[k] = (counts[k] || 0) + 1;
    const total = PUP_BAG.length;
    const rates = document.getElementById('pupRates');
    for (const k of Object.keys(counts)) {
      const chip = document.createElement('span');
      chip.className = 'rate-chip';
      chip.style.setProperty('--c', PUPS[k].color);
      const pct = Math.round(counts[k] / total * 100);
      chip.innerHTML = `${PUPS[k].label} <i>${pct}%</i>`;
      chip.title = counts[k] === 1 && k === 'god'
        ? 'rare drop — or chain 3 same-kind pickups within 5s'
        : 'drop chance per power-up crate';
      rates.appendChild(chip);
    }
  }

  // PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline play unavailable; game still runs */ });
    });
  }

  // install button (shows when the browser allows PWA install)
  let deferredInstall = null;
  const installBtn = document.getElementById('installBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    installBtn?.classList.remove('hidden');
  });
  installBtn?.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    try {
      const { outcome } = await deferredInstall.userChoice;
      if (outcome === 'accepted') installBtn.classList.add('hidden');
    } catch { /* userChoice can reject in some browsers */ }
    deferredInstall = null;
  });
  window.addEventListener('appinstalled', () => installBtn?.classList.add('hidden'));

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (state === S.PLAYING || state === S.DYING) AudioSys.tickMusic(dt);
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // tiny debug/verification hook
  window.__neon = {
    get state() { return state; },
    get mode() { return modeKey; },
    get diff() { return diffKey; },
    get scores() { return players.map(p => p.score); },
    get lives() { return players.map(p => p.lives); },
    get best() { return lbAll()[lbKeyFor()]?.[0]?.score || 0; },
    get powerups() { return players.map(p => ({ ...p.active })); },
    get music() { return AudioSys.jingle ? { playing: AudioSys.jingle.playing, beat: AudioSys.jingle.beat, boss: AudioSys.jingle.boss } : null; },
    get bossState() { return boss ? { hp: boss.hp, hpMax: boss.hpMax, phase: boss.phase, x: Math.round(boss.x), y: Math.round(boss.y) } : (bossWarn > 0 ? 'warning' : null); },
    get bossRaw() { return boss ? { t: String(boss.t), x: String(boss.x), y: String(boss.y), fireT: String(boss.fireT), life: String(boss.life), leaving: boss.leaving, dir: String(boss.dir) } : null; },
    get nextBossIn() { return Math.max(0, nextBossAt - elapsed); },
    get bullets() { return bullets.length; },
    get px() { return players.map(p => Math.round(p.x)); },
    lb: lbAll,
    start,
    setDiff,
    setMode,
    toMenu,
    grant(kind, idx = 0) { const p = players[idx]; if (state === S.PLAYING && p && PUPS[kind]) activatePup(p, kind); },
    setFire(idx = 0, on = true) { keys[idx].fire = !!on; },
    spawnDroneNow() { if (state === S.PLAYING) spawnDrone(); },
    get droneInfo() { return drones.map(d => ({ x: Math.round(d.x), y: Math.round(d.y), hp: d.hp, form: !!d.form })); },
    get shotCount() { return pshots.length; },
    get miniInfo() { return minis.map(m => ({ x: Math.round(m.x), y: Math.round(m.y) })); },
    spawnFormationNow() { if (state === S.PLAYING && !form) spawnFormation(); },
    spawnSwarmNow() { if (state === S.PLAYING) spawnSwarm(); },
    get formState() { return form ? { x: Math.round(form.x), dir: form.dir, entered: form.entered } : null; },
    step(dt = 0.016) { if (state === S.PLAYING || state === S.DYING) update(dt); }, // deterministic test hook (rAF-independent)
    setInv(idx = 0, t = 999) { if (players[idx]) players[idx].inv = t; },
    get stickState() { return { move: sticks.move?.id ?? null, fire: sticks.fire?.id ?? null, fireDown: keys[0].fire }; },
    hit(idx = 0) { const p = players[idx]; if (state === S.PLAYING && p && !p.dead) applyHit(p, { x: p.x, y: p.y }); },
    spawnBossNow() { if (state === S.PLAYING && !boss) { bossWarn = 0.01; } },
    hitBoss(n = 1) { if (boss) bossHit(n, boss.x, boss.y); },
  };
})();
