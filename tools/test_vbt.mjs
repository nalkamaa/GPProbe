#!/usr/bin/env node
// Regressiotestit Gpath Pin VBT -logiikalle (index.html).
// Ajo: node tools/test_vbt.mjs  (ei ulkoisia riippuvuuksia)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(REPO_ROOT, 'index.html');
const VOICE_PATH = path.join(REPO_ROOT, 'assets', 'kevytta-viela-yksi-toisto.mp3');

function loadApp() {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'index.html must contain <script>');

  const els = new Map();
  const storage = new Map();
  const audioSessionLog = [];
  const audioEvents = [];
  const timers = [];
  let clockMs = null;
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0 && clockMs !== null) super(clockMs);
      else super(...args);
    }
    static now() { return clockMs !== null ? clockMs : RealDate.now(); }
  }

  function makeEl(id = '') {
    const cls = new Set(id === 'tabAnalysis' ? ['hidden'] : []);
    return {
      id, value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
      dataset: {}, style: {},
      classList: {
        _s: cls,
        add(...c) { c.forEach((x) => this._s.add(x)); },
        remove(...c) { c.forEach((x) => this._s.delete(x)); },
        toggle(c, f) {
          if (f === undefined) { if (this._s.has(c)) this._s.delete(c); else this._s.add(c); }
          else if (f) this._s.add(c); else this._s.delete(c);
        },
        contains(c) { return this._s.has(c); }
      },
      addEventListener() {},
      querySelector(sel) {
        if (!this.innerHTML || !sel) return null;
        const idM = sel.match(/^#([\w-]+)$/);
        if (idM) return this.innerHTML.includes(`id="${idM[1]}"`) ? makeEl(idM[1]) : null;
        const attrM = sel.match(/^\[([^\]=]+)/);
        if (attrM) return this.innerHTML.includes(attrM[1]) ? makeEl() : null;
        if (/^[a-z]+$/i.test(sel)) return this.innerHTML.includes(`<${sel}`) ? makeEl(sel) : null;
        return null;
      },
      querySelectorAll() { return []; },
      appendChild() {},
      remove() {},
      closest() { return null; },
      getAttribute() { return null; },
      setAttribute() {},
      focus() {},
      click() {}
    };
  }

  let sessionType = 'ambient';
  const audioSession = {
    get type() { return sessionType; },
    set type(v) { sessionType = v; audioSessionLog.push(v); }
  };

  let lastAudioEl = null;
  class FakeAudio {
    constructor() {
      this.src = '';
      this.preload = '';
      this.playsInline = false;
      this.currentTime = 0;
      this.onended = null;
      this.onerror = null;
      lastAudioEl = this;
    }
    load() { audioEvents.push('load'); }
    pause() { audioEvents.push('pause'); }
    play() {
      audioEvents.push('play');
      return Promise.resolve();
    }
  }

  let spokenTexts = [];
  class FakeUtterance {
    constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; }
  }

  const sandbox = {
    console, Math, Date: MockDate, JSON, Number, String, Boolean, Array, Object, Map, Set, RegExp, Error, Promise,
    ArrayBuffer, DataView, Uint8Array,
    parseInt, parseFloat, isNaN, isFinite,
    setTimeout(fn, ms) { const id = timers.length + 1; timers.push({ id, fn, ms, cleared: false }); return id; },
    clearTimeout(id) { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    localStorage: {
      getItem: (k) => storage.has(k) ? storage.get(k) : null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    navigator: {
      userAgent: '',
      clipboard: { writeText: async () => {} },
      audioSession
    },
    location: { href: 'http://localhost/' },
    alert: () => {},
    confirm: () => true,
    prompt: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    Blob: class {},
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    Audio: FakeAudio,
    AudioContext: class {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      resume() { return Promise.resolve(); }
      createBuffer() { return {}; }
      createBufferSource() { return { connect() {}, start() {} }; }
      createOscillator() { return { type: 'sine', frequency: { value: 0, setValueAtTime() {} }, connect() {}, start() {}, stop() {}, disconnect() {} }; }
      createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    },
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      cancel: () => {},
      speak: (u) => { spokenTexts.push(u.text); },
      getVoices: () => []
    },
    document: {
      body: makeEl('body'),
      getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement(tag) { return makeEl(tag); },
      addEventListener() {},
      visibilityState: 'visible'
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1] + `
    this.__api = {
      get workouts() { return workouts; },
      set workouts(v) { workouts = v; },
      get vbtSettings() { return vbtSettings; },
      get setActive() { return setActive; },
      set setActive(v) { setActive = v; },
      get zeroing() { return zeroing; },
      set zeroing(v) { zeroing = v; },
      get pinStarted() { return pinStarted; },
      set pinStarted(v) { pinStarted = v; },
      get bleConnecting() { return bleConnecting; },
      set bleConnecting(v) { bleConnecting = v; },
      get manualDisconnect() { return manualDisconnect; },
      set manualDisconnect(v) { manualDisconnect = v; },
      get dataChar() { return dataChar; },
      set dataChar(v) { dataChar = v; },
      get bleDevice() { return bleDevice; },
      set bleDevice(v) { bleDevice = v; },
      get currentReps() { return currentReps; },
      set currentReps(v) { currentReps = v; },
      get currentSetSaved() { return currentSetSaved; },
      set currentSetSaved(v) { currentSetSaved = v; },
      get lastSavedSetRef() { return lastSavedSetRef; },
      set lastSavedSetRef(v) { lastSavedSetRef = v; },
      get activeSetMeta() { return activeSetMeta; },
      set activeSetMeta(v) { activeSetMeta = v; },
      get activeSetToken() { return activeSetToken; },
      set activeSetToken(v) { activeSetToken = v; },
      get setStartedAt() { return setStartedAt; },
      set setStartedAt(v) { setStartedAt = v; },
      get lastBottomAt() { return lastBottomAt; },
      set lastBottomAt(v) { lastBottomAt = v; },
      get lastEccEndAt() { return lastEccEndAt; },
      set lastEccEndAt(v) { lastEccEndAt = v; },
      get resumeSetAfterReconnect() { return resumeSetAfterReconnect; },
      set resumeSetAfterReconnect(v) { resumeSetAfterReconnect = v; },
      get lastTraceStatus() { return lastTraceStatus; },
      get lastTraceFailed() { return lastTraceFailed; },
      get keepWarmOsc() { return keepWarmOsc; },
      get extraVoicePlaying() { return extraVoicePlaying; },
      bleDiagLog, logBleDiag, refreshBleDiagUI,
      EXTRA_REP_VOICE_DATA_URI,
      DEFAULT_REF_MAX, VBT_GOALS, LIFT_ANALYSIS, TRACE_LIFT_RULES,
      CMD_START, CMD_STOP,
      getLiftKey, getLiftCfg, getAnchor1RM, workoutsSignature,
      detectMergedReps, splitCurveReps, historyMedianRom, flagSuspectReps,
      analyzeSet, ownVelocityCost, computeDailyPlan, planAltHTML,
      readinessForDate, sessionProfile, recentProfile, weeklyVolume,
      extraRepHint, isReferenceSetContext,
      setRepCount, setRepCountOverride, setTouchAndGo, isLiveTouchAndGo, planRepsOf,
      snapshotCurrentSetMeta, commitCurrentSetToWorkouts, renderContextAndSteppers,
      startSetOnPin, stopSetOnPin, onNotification, onDisconnected, openGattSession, rezeroPin, finishCalibrationAndActivate,
      handleTraceNotification, analyzeTrace, attachTraceToRecentSet,
      buildSetAnalysisHTML, buildVerdict, buildShortRestFinding, buildCSV,
      playExtraRepVoiceCue, speakRepVelocity, startAudioKeepWarm
    };
  `, sandbox);

  return {
    api: sandbox.__api,
    html,
    els,
    storage,
    timers,
    setNow: (ms) => { clockMs = ms; },
    advanceMs: (d) => { clockMs = (clockMs ?? RealDate.now()) + d; },
    audioSessionLog,
    audioEvents,
    getLastAudioEl: () => lastAudioEl,
    getSpokenTexts: () => spokenTexts
  };
}

// Reaalidata 29.10., 11.11. ja 21.11.2026 treeneistä (tiivistettynä objektirakenteeksi)
function makeRep(v, rom, opts = {}) {
  const hasTrace = opts.stick !== undefined || opts.mid !== undefined || opts.curve || opts.dxMax !== undefined || opts.tilt !== undefined || opts.path !== undefined;
  return {
    meanVelocity: v,
    power: opts.power || 500,
    rangeOfMotionCm: rom,
    loweringVelocity: opts.low ?? null,
    propulsiveVelocity: opts.pv ?? v * 1.05,
    propulsiveAcceleration: opts.pa ?? 1.5,
    pauseMs: opts.pause === undefined ? 50 : opts.pause,
    t: opts.t ?? 0,
    ...(hasTrace ? {
      trace: {
        stick: opts.stick !== undefined ? { vmin: opts.stick, h: opts.stickH ?? 45, ms: opts.stickMs ?? 300 } : null,
        midMin: opts.mid !== undefined ? { v: opts.mid, h: opts.midH ?? 15 } : null,
        dxMax: opts.dxMax ?? null,
        tilt: opts.tilt ?? null,
        path: opts.path ?? null,
        curve: opts.curve || null
      }
    } : {})
  };
}

function makePath(devCm) {
  if (devCm === null || devCm === undefined) return null;
  const x = devCm === 0 ? 0 : devCm * Math.sqrt(21 / 20);
  return Array.from({ length: 21 }, (_, k) => [k === 0 ? 0 : x, k * 2]);
}

function buildDeadliftFixtures() {
  const ts = (d, h) => new Date(`${d}T${h}`).getTime();
  const dl1029 = {
    date: '2026-10-29',
    sets: [
      { exercise: 'Maastaveto', weightKg: 60, targetReps: 5, reps: [
        makeRep(0.107, 31.1, { pause: null, t: ts('2026-10-29', '19:26:46') }),
        makeRep(0.832, 87.2, { low: 0.493, pause: null, t: ts('2026-10-29', '19:26:50') }),
        makeRep(0.937, 57.3, { low: 0.616, pause: null, t: ts('2026-10-29', '19:26:54') }),
        makeRep(0.732, 36.6, { low: 0.615, pause: null, t: ts('2026-10-29', '19:26:58') }),
        makeRep(0.793, 86.7, { low: 0.558, pause: null, t: ts('2026-10-29', '19:27:02') })
      ] },
      { exercise: 'Maastaveto', weightKg: 60, targetReps: 5, reps: [
        makeRep(0.827, 45.5, { low: 0.569, pause: null, t: ts('2026-10-29', '19:27:40') }),
        makeRep(0.829, 91.4, { low: 0.567, pause: null, t: ts('2026-10-29', '19:27:44') }),
        makeRep(0.799, 84.2, { low: 0.551, pause: null, t: ts('2026-10-29', '19:27:48') }),
        makeRep(0.941, 93.1, { low: 0.541, pause: null, t: ts('2026-10-29', '19:27:52') }),
        makeRep(0.591, 59.2, { low: 0.523, pause: null, t: ts('2026-10-29', '19:27:56') })
      ] },
      { exercise: 'Maastaveto', weightKg: 60, targetReps: 5, reps: [
        makeRep(0.883, 51.6, { low: 0.544, pause: null, t: ts('2026-10-29', '19:29:25') }),
        makeRep(0.789, 34.6, { low: 0.647, pause: null, t: ts('2026-10-29', '19:29:29') }),
        makeRep(0.811, 72.1, { low: 0.528, pause: null, t: ts('2026-10-29', '19:29:33') }),
        makeRep(0.703, 72.1, { low: 0.451, pause: null, t: ts('2026-10-29', '19:29:37') }),
        makeRep(0.812, 41.8, { pause: null, t: ts('2026-10-29', '19:29:41') })
      ] },
      { exercise: 'Maastaveto', weightKg: 80, targetReps: 3, reps: [
        makeRep(0.797, 60.3, { low: 0.604, pause: null, t: ts('2026-10-29', '19:31:29') }),
        makeRep(0.653, 71.8, { low: 0.602, pause: null, t: ts('2026-10-29', '19:31:33') }),
        makeRep(0.665, 72.3, { low: 0.495, pause: null, t: ts('2026-10-29', '19:31:37') })
      ] },
      { exercise: 'Maastaveto', weightKg: 100, targetReps: 3, reps: [
        makeRep(0.717, 52.0, { low: 0.469, pause: null, t: ts('2026-10-29', '19:35:00') }),
        makeRep(0.625, 83.7, { low: 0.530, pause: null, t: ts('2026-10-29', '19:35:04') }),
        makeRep(0.449, 52.8, { pause: null, t: ts('2026-10-29', '19:35:08') })
      ] },
      { exercise: 'Maastaveto', weightKg: 120, targetReps: 3, reps: [
        makeRep(0.539, 43.9, { low: 0.443, pause: null, t: ts('2026-10-29', '19:40:11') }),
        makeRep(0.485, 34.0, { low: 0.502, pause: null, t: ts('2026-10-29', '19:40:15') }),
        makeRep(0.543, 43.5, { pause: null, t: ts('2026-10-29', '19:40:19') })
      ] },
      { exercise: 'Maastaveto', weightKg: 140, targetReps: 3, reps: [
        makeRep(0.432, 41.6, { low: 0.546, pause: null, t: ts('2026-10-29', '19:45:00') }),
        makeRep(0.341, 71.0, { pause: null, t: ts('2026-10-29', '19:45:04') })
      ] },
      { exercise: 'Maastaveto', weightKg: 160, targetReps: 1, reps: [
        makeRep(0.238, 37.5, { pause: null, t: ts('2026-10-29', '19:52:06') })
      ] }
    ]
  };

  const dl1124 = {
    date: '2026-11-24',
    sets: [
      { exercise: 'Maastaveto', weightKg: 100, targetReps: 3, time: '18:21:54', reps: [
        makeRep(0.679, 53.5, { low: 0.643, pv: 0.713, pa: 2.618, pause: null, mid: 0.825, dxMax: 12.8, tilt: 1.7, path: makePath(0.9), t: ts('2026-11-24', '18:21:54') }),
        makeRep(0.698, 81.7, { low: 0.708, pv: 0.666, pa: 2.994, pause: 56, stick: 0.304, stickH: 3.9, stickMs: 38, mid: 0.451, dxMax: 47.2, tilt: 1.2, t: ts('2026-11-24', '18:21:58') }),
        makeRep(0.660, 46.5, { pv: 0.684, pa: 3.080, pause: 359, mid: 0.773, dxMax: 13.8, tilt: 0.5, path: makePath(0.0), t: ts('2026-11-24', '18:22:02') })
      ] },
      { exercise: 'Maastaveto', weightKg: 115, targetReps: 2, time: '18:24:33', reps: [
        makeRep(0.563, 40.1, { low: 0.533, pv: 0.577, pa: 2.109, pause: null, mid: 0.628, t: ts('2026-11-24', '18:24:33') }),
        makeRep(0.741, 114.0, { pv: 0.720, pa: 2.358, pause: 59, stick: 0.470, stickH: 33.5, stickMs: 225, mid: 0.470, t: ts('2026-11-24', '18:24:37') })
      ] },
      { exercise: 'Maastaveto', weightKg: 120, targetReps: 3, time: '18:26:53', reps: [
        makeRep(0.567, 46.2, { low: 0.454, pv: 0.570, pa: 1.854, pause: null, mid: 0.657, dxMax: 16.8, tilt: 0.7, path: makePath(0.0), t: ts('2026-11-24', '18:26:53') }),
        makeRep(0.558, 82.8, { low: 0.548, pv: 0.528, pa: 2.109, pause: 59, stick: 0.297, stickH: 19.3, stickMs: 375, mid: 0.297, dxMax: -62.5, tilt: 1.6, t: ts('2026-11-24', '18:26:57') }),
        makeRep(0.466, 38.5, { pv: 0.460, pa: 1.710, pause: 657, t: ts('2026-11-24', '18:27:01') })
      ] },
      { exercise: 'Maastaveto', weightKg: 130, targetReps: 3, time: '18:29:17', reps: [
        makeRep(0.463, 41.0, { low: 0.475, pv: 0.483, pa: 1.444, pause: null, mid: 0.512, dxMax: 17.2, tilt: 0.9, path: makePath(0.0), t: ts('2026-11-24', '18:29:17') }),
        makeRep(0.426, 43.2, { low: 0.518, pv: 0.465, pa: 1.628, pause: 751, mid: 0.520, dxMax: 16.7, tilt: 1.7, path: makePath(0.3), t: ts('2026-11-24', '18:29:21') }),
        makeRep(0.358, 35.4, { pv: 0.390, pa: 1.266, pause: 1016, mid: 0.421, dxMax: 8.0, tilt: 0.1, path: makePath(6.4), t: ts('2026-11-24', '18:29:25') })
      ] },
      { exercise: 'Maastaveto', weightKg: 130, targetReps: 3, time: '18:31:35', reps: [
        makeRep(0.490, 46.6, { low: 0.420, pv: 0.505, pa: 1.734, pause: null, mid: 0.572, t: ts('2026-11-24', '18:31:35') }),
        makeRep(0.423, 37.6, { low: 0.462, pv: 0.429, pa: 1.564, pause: 660, mid: 0.511, t: ts('2026-11-24', '18:31:39') }),
        makeRep(0.384, 67.7, { pv: 0.387, pa: 1.689, pause: 68, stick: 0.145, stickH: 11.9, stickMs: 463, mid: 0.234, t: ts('2026-11-24', '18:31:43') })
      ] },
      { exercise: 'Maastaveto', weightKg: 150, targetReps: 1, time: '18:35:00', reps: [
        makeRep(0.291, 34.2, { pv: 0.349, pa: 1.134, pause: null, t: ts('2026-11-24', '18:35:00') })
      ] },
      { exercise: 'Maastaveto', weightKg: 140, targetReps: 3, time: '18:38:50', reps: [
        makeRep(0.328, 32.9, { pv: 0.386, pa: 1.460, pause: null, mid: 0.368, dxMax: 23.0, tilt: 0.8, path: makePath(0.0), t: ts('2026-11-24', '18:38:50') })
      ] },
      { exercise: 'Maastaveto', weightKg: 130, targetReps: 3, time: '18:42:38', reps: [
        makeRep(0.451, 41.2, { low: 0.561, pv: 0.476, pa: 1.567, pause: null, mid: 0.542, dxMax: 17.4, tilt: 0.6, path: makePath(0.0), t: ts('2026-11-24', '18:42:38') })
      ] }
    ]
  };
  return { dl1029, dl1124 };
}

function buildFixtures() {
  const ts = (d, h) => new Date(`${d}T${h}`).getTime();
  const w1029 = {
    date: '2026-10-29',
    sets: [
      { exercise: 'Jalkakyykky', weightKg: 140, targetReps: 3, reps: [
        makeRep(0.420, 40.4, { t: ts('2026-10-29', '19:47:50') }),
        makeRep(0.265, 51.8, { t: ts('2026-10-29', '19:47:54') }),
        makeRep(0.255, 54.9, { t: ts('2026-10-29', '19:47:58') })
      ] },
      { exercise: 'Jalkakyykky', weightKg: 160, targetReps: 1, reps: [
        makeRep(0.247, 36.1, { t: ts('2026-10-29', '19:50:39') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 90, targetReps: 3, reps: [
        makeRep(0.484, 26.0, { t: ts('2026-10-29', '20:04:22') }),
        makeRep(0.448, 25.8, { t: ts('2026-10-29', '20:04:25') }),
        makeRep(0.397, 26.9, { t: ts('2026-10-29', '20:04:28') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 100, targetReps: 3, reps: [
        makeRep(0.389, 27.8, { t: ts('2026-10-29', '20:07:51') }),
        makeRep(0.331, 28.6, { t: ts('2026-10-29', '20:07:54') }),
        makeRep(0.276, 29.3, { t: ts('2026-10-29', '20:07:58') })
      ] }
    ]
  };

  const w1111 = {
    date: '2026-11-11',
    sets: [
      { exercise: 'Jalkakyykky', weightKg: 80, targetReps: 5, reps: [
        makeRep(0.768, 66.3, { mid: 0.918, t: ts('2026-11-11', '18:41:16') }),
        makeRep(0.805, 66.4, { mid: 0.937, t: ts('2026-11-11', '18:41:20') }),
        makeRep(0.815, 66.3, { mid: 0.945, t: ts('2026-11-11', '18:41:24') }),
        makeRep(0.823, 66.9, { mid: 0.954, t: ts('2026-11-11', '18:41:28') }),
        makeRep(0.794, 67.5, { stick: 0.930, t: ts('2026-11-11', '18:41:32') })
      ] },
      { exercise: 'Jalkakyykky', weightKg: 100, targetReps: 5, reps: [
        makeRep(0.703, 68.6, { mid: 0.881, t: ts('2026-11-11', '18:45:12') }),
        makeRep(0.685, 60.8, { t: ts('2026-11-11', '18:45:16') }),
        makeRep(0.704, 60.8, { stick: 0.796, t: ts('2026-11-11', '18:45:20') }),
        makeRep(0.720, 62.1, { stick: 0.790, t: ts('2026-11-11', '18:45:24') }),
        makeRep(0.727, 64.6, { stick: 0.759, t: ts('2026-11-11', '18:45:28') })
      ] },
      { exercise: 'Jalkakyykky', weightKg: 125, targetReps: 3, reps: [
        makeRep(0.612, 71.2, { stick: 0.640, t: ts('2026-11-11', '18:49:56') }),
        makeRep(0.581, 66.9, { t: ts('2026-11-11', '18:50:00') }),
        makeRep(0.531, 68.5, { t: ts('2026-11-11', '18:50:04') })
      ] },
      { exercise: 'Jalkakyykky', weightKg: 135, targetReps: 3, reps: [
        makeRep(0.514, 68.3, { stick: 0.469, t: ts('2026-11-11', '18:52:53') }),
        makeRep(0.472, 65.6, { stick: 0.391, t: ts('2026-11-11', '18:52:57') }),
        makeRep(0.473, 67.5, { stick: 0.357, t: ts('2026-11-11', '18:53:01') })
      ] },
      { exercise: 'Jalkakyykky', weightKg: 135, targetReps: 3, reps: [
        makeRep(0.494, 69.3, { stick: 0.414, t: ts('2026-11-11', '18:55:59') }),
        makeRep(0.438, 63.7, { stick: 0.337, t: ts('2026-11-11', '18:56:03') }),
        makeRep(0.422, 66.1, { stick: 0.295, t: ts('2026-11-11', '18:56:07') })
      ] },
      { exercise: 'Jalkakyykky', weightKg: 135, targetReps: 3, reps: [
        makeRep(0.494, 66.2, { stick: 0.423, t: ts('2026-11-11', '18:59:53') }),
        makeRep(0.463, 64.9, { stick: 0.357, t: ts('2026-11-11', '18:59:57') }),
        makeRep(0.400, 65.6, { stick: 0.234, t: ts('2026-11-11', '19:00:01') })
      ] },
      { exercise: 'Jalkakyykky', weightKg: 135, targetReps: 3, reps: [
        makeRep(0.558, 73.3, { stick: 0.492, t: ts('2026-11-11', '19:04:01') }),
        makeRep(0.504, 73.1, { stick: 0.383, t: ts('2026-11-11', '19:04:05') }),
        makeRep(0.384, 68.8, { stick: 0.240, t: ts('2026-11-11', '19:04:09') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 85, targetReps: 5, reps: [
        makeRep(0.466, 28.0, { mid: 0.575, t: ts('2026-11-11', '19:17:47') }),
        makeRep(0.424, 27.6, { mid: 0.522, t: ts('2026-11-11', '19:17:50') }),
        makeRep(0.376, 27.8, { mid: 0.541, t: ts('2026-11-11', '19:17:53') }),
        makeRep(0.414, 27.5, { mid: 0.488, t: ts('2026-11-11', '19:17:56') }),
        makeRep(0.406, 29.5, { mid: 0.451, t: ts('2026-11-11', '19:17:59') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 95, targetReps: 5, reps: [
        makeRep(0.478, 29.4, { mid: 0.550, t: ts('2026-11-11', '19:21:44') }),
        makeRep(0.416, 31.2, { mid: 0.427, t: ts('2026-11-11', '19:21:47') }),
        makeRep(0.400, 29.0, { mid: 0.371, t: ts('2026-11-11', '19:21:50') }),
        makeRep(0.347, 30.9, { mid: 0.285, t: ts('2026-11-11', '19:21:53') }),
        makeRep(0.253, 31.7, { mid: 0.167, t: ts('2026-11-11', '19:21:56') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 90, targetReps: 3, reps: [
        makeRep(0.476, 26.2, { mid: 0.577, t: ts('2026-11-11', '19:24:24') }),
        makeRep(0.451, 26.0, { mid: 0.503, t: ts('2026-11-11', '19:24:27') }),
        makeRep(0.407, 27.5, { mid: 0.444, t: ts('2026-11-11', '19:24:30') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 90, targetReps: 3, reps: [
        makeRep(0.497, 26.8, { mid: 0.605, t: ts('2026-11-11', '19:28:01') }),
        makeRep(0.444, 27.2, { mid: 0.496, t: ts('2026-11-11', '19:28:04') }),
        makeRep(0.421, 31.7, { mid: 0.483, t: ts('2026-11-11', '19:28:07') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 95, targetReps: 3, reps: [
        makeRep(0.433, 29.8, { mid: 0.473, t: ts('2026-11-11', '19:31:27') }),
        makeRep(0.417, 30.8, { mid: 0.417, t: ts('2026-11-11', '19:31:30') }),
        makeRep(0.311, 31.2, { mid: 0.275, t: ts('2026-11-11', '19:31:33') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 95, targetReps: 3, reps: [
        makeRep(0.408, 28.1, { mid: 0.440, t: ts('2026-11-11', '19:35:45') }),
        makeRep(0.357, 26.8, { mid: 0.353, t: ts('2026-11-11', '19:35:48') }),
        makeRep(0.266, 28.4, { mid: 0.255, t: ts('2026-11-11', '19:35:51') })
      ] }
    ]
  };

  const w1121 = {
    date: '2026-11-21',
    sets: [
      { exercise: 'Jalkakyykky', weightKg: 110, targetReps: 3, reps: [
        makeRep(0.648, 66.5, { stick: 0.730, t: ts('2026-11-21', '13:48:58') }),
        makeRep(0.622, 60.7, { stick: 0.666, t: ts('2026-11-21', '13:49:02') }),
        makeRep(0.617, 61.0, { stick: 0.621, t: ts('2026-11-21', '13:49:06') })
      ] },
      { exercise: 'Jalkakyykky', weightKg: 127.5, targetReps: 3, reps: [
        makeRep(0.535, 66.9, { stick: 0.552, t: ts('2026-11-21', '13:53:00') }),
        makeRep(0.512, 63.4, { stick: 0.462, t: ts('2026-11-21', '13:53:04') }),
        makeRep(0.491, 66.4, { stick: 0.410, t: ts('2026-11-21', '13:53:08') })
      ] },
      { exercise: 'Jalkakyykky', weightKg: 127.5, targetReps: 3, reps: [
        makeRep(0.538, 69.4, { stick: 0.539, t: ts('2026-11-21', '13:56:04') }),
        makeRep(0.558, 70.5, { stick: 0.514, t: ts('2026-11-21', '13:56:08') }),
        makeRep(0.516, 74.3, { stick: 0.408, t: ts('2026-11-21', '13:56:12') })
      ] },
      { exercise: 'Jalkakyykky', weightKg: 127.5, targetReps: 3, reps: [
        makeRep(0.497, 63.4, { stick: 0.431, t: ts('2026-11-21', '14:00:35') }),
        makeRep(0.503, 61.7, { stick: 0.445, t: ts('2026-11-21', '14:00:39') }),
        makeRep(0.454, 63.0, { stick: 0.324, t: ts('2026-11-21', '14:00:43') })
      ] },
      { exercise: 'Jalkakyykky', weightKg: 122.5, targetReps: 3, reps: [
        makeRep(0.551, 67.6, { stick: 0.534, t: ts('2026-11-21', '14:07:46') }),
        makeRep(0.496, 63.4, { stick: 0.428, t: ts('2026-11-21', '14:07:50') }),
        makeRep(0.512, 64.7, { stick: 0.406, t: ts('2026-11-21', '14:07:54') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 60, targetReps: 5, reps: [
        makeRep(0.562, 26.0, { mid: 0.623, t: ts('2026-11-21', '14:18:57') }),
        makeRep(0.476, 26.8, { mid: 0.761, t: ts('2026-11-21', '14:19:00') }),
        makeRep(0.644, 26.6, { mid: 0.765, t: ts('2026-11-21', '14:19:03') }),
        makeRep(0.518, 29.9, { mid: 0.756, t: ts('2026-11-21', '14:19:06') }),
        makeRep(0.472, 34.3, { mid: 0.808, t: ts('2026-11-21', '14:19:09') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 77.5, targetReps: 5, reps: [
        makeRep(0.506, 29.8, { mid: 0.614, t: ts('2026-11-21', '14:21:22') }),
        makeRep(0.200, 50.7, { mid: 0.118, t: ts('2026-11-21', '14:21:26') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 90, targetReps: 3, reps: [
        makeRep(0.458, 26.4, { mid: 0.553, t: ts('2026-11-21', '14:24:26') }),
        makeRep(0.480, 28.9, { mid: 0.534, t: ts('2026-11-21', '14:24:29') }),
        makeRep(0.435, 30.0, { mid: 0.433, t: ts('2026-11-21', '14:24:32') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 87.5, targetReps: 3, reps: [
        makeRep(0.483, 29.6, { mid: 0.600, t: ts('2026-11-21', '14:27:07') }),
        makeRep(0.463, 29.0, { mid: 0.555, t: ts('2026-11-21', '14:27:10') }),
        makeRep(0.434, 29.9, { mid: 0.465, t: ts('2026-11-21', '14:27:13') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 87.5, targetReps: 3, reps: [
        makeRep(0.507, 30.4, { mid: 0.634, t: ts('2026-11-21', '14:29:34') }),
        makeRep(0.488, 29.4, { mid: 0.573, t: ts('2026-11-21', '14:29:37') }),
        makeRep(0.461, 30.6, { mid: 0.505, t: ts('2026-11-21', '14:29:40') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 87.5, targetReps: 3, reps: [
        makeRep(0.500, 28.2, { mid: 0.627, t: ts('2026-11-21', '14:32:35') }),
        makeRep(0.481, 26.5, { mid: 0.568, t: ts('2026-11-21', '14:32:38') }),
        makeRep(0.443, 27.8, { mid: 0.490, t: ts('2026-11-21', '14:32:41') })
      ] },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 87.5, targetReps: 3, reps: [
        makeRep(0.474, 29.7, { mid: 0.607, t: ts('2026-11-21', '14:36:13') }),
        makeRep(0.447, 30.2, { mid: 0.534, t: ts('2026-11-21', '14:36:16') }),
        makeRep(0.407, 31.1, { mid: 0.479, t: ts('2026-11-21', '14:36:19') })
      ] }
    ]
  };

  return { w1029, w1111, w1121 };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('1. Merged-rep detection: zero false positives for fresh user (n=1,2,3 squat & generic)', () => {
  const { api } = loadApp();
  const { w1121 } = buildFixtures();
  api.workouts = [];
  for (const k of [1, 2, 3]) {
    const a = api.analyzeSet(w1121.sets[0].reps.slice(0, k), 'Jalkakyykky', 110, { dateStr: '2026-11-21' });
    assert.equal(a.mergedCount, 0, `Fresh squat rep ${k} should not be flagged merged`);
    assert.equal(a.valid.length, k);
  }
  const generic = api.analyzeSet([makeRep(0.55, 48), makeRep(0.52, 47)], 'Pystypunnerrus', 50, { dateStr: '2026-11-21' });
  assert.equal(generic.mergedCount, 0, 'Generic exercise normal ROM must not be flagged merged');
});

test('2. Merged-rep detection: Bench Set #7 detected both with and without history', () => {
  const { api } = loadApp();
  const { w1029, w1111, w1121 } = buildFixtures();
  const s7 = w1121.sets[6];

  // Ilman historiaa (n=2 keskinäinen vertailu)
  api.workouts = [];
  const aNoHist = api.analyzeSet(s7.reps, s7.exercise, s7.weightKg, { dateStr: '2026-11-21' });
  assert.equal(aNoHist.mergedCount, 1);
  assert.equal(aNoHist.mergedReps[0].refSrc, 'set');
  assert.equal(aNoHist.mergedReps[0].est, 2);
  assert.equal(aNoHist.valid.length, 1);

  // Historian kanssa (refSrc='history', own velocity cost)
  api.workouts = [w1029, w1111, w1121];
  api.vbtSettings.goal = 'baseStrength';
  const aHist = api.analyzeSet(s7.reps, s7.exercise, s7.weightKg, { dateStr: '2026-11-21' });
  assert.equal(aHist.mergedCount, 1);
  assert.equal(aHist.mergedReps[0].refSrc, 'history');
  assert.equal(aHist.costSource, 'own');
  assert.equal(aHist.score, 100);
  assert.ok(aHist.e1RM > 115 && aHist.e1RM < 125, `Unexpected Set #7 e1RM: ${aHist.e1RM}`);
});

test('3. Merged-rep detection: n=1 without history uses trace.curve split only', () => {
  const { api } = loadApp();
  api.workouts = [];
  // 40 Hz käyrä kahdella selkeällä huipulla (>= 8 cm kumpikin) ja välidipillä <= 0.05 m/s
  const curve = [];
  let pos = 0;
  for (let i = 0; i < 40; i++) {
    const v = i < 16 ? Math.sin((i / 15) * Math.PI) * 500 : (i < 22 ? 20 : Math.sin(((i - 22) / 17) * Math.PI) * 480);
    pos += (v / 1000) * (1 / 40) * 100;
    curve.push([+pos.toFixed(1), Math.round(v)]);
  }
  const a = api.analyzeSet([makeRep(0.25, 65, { curve })], 'Sotilaspenkkipunnerrus', 77.5, { dateStr: '2026-11-21' });
  assert.equal(a.mergedCount, 1);
  assert.equal(a.mergedReps[0].estSrc, 'trace');
  assert.equal(a.mergedReps[0].est, 2);
});

test('4. ownVelocityCost filters todayObs by +-7.5% 1RM & avoids mid-session false missedReps', () => {
  const { api } = loadApp();
  const { w1029, w1111, w1121 } = buildFixtures();
  api.vbtSettings.goal = 'baseStrength';
  api.workouts = [w1029, w1111, w1121];

  const sqCost = api.ownVelocityCost('Jalkakyykky', '2026-11-21', 80, 2);
  assert.equal(sqCost.scope, 'today');
  assert.equal(sqCost.n, 4, 'Squat 110 kg (70%) ref set should be excluded from 80% todayObs');
  assert.ok(sqCost.cost > 0.025, `Expected ~0.032 without 110kg ref set, got ${sqCost.cost}`);

  for (const ex of ['Jalkakyykky', 'Sotilaspenkkipunnerrus']) {
    const plan = api.computeDailyPlan(ex, '2026-11-21');
    assert.equal(plan.stage, 'plan');
    assert.equal(plan.reps, 3, `${ex} reps should stay 3 at end of 2026-11-21`);
    assert.equal(plan.remainingSets, 0, `${ex} remainingSets should be 0`);
    assert.equal(plan.adjust, null, `${ex} should have no false fatigue adjust`);
  }
});

test('5. Rep progression: 2026-11-25 squat progresses reps, bench falls back to load (no stall)', () => {
  const { api } = loadApp();
  const { w1029, w1111, w1121 } = buildFixtures();
  api.vbtSettings.goal = 'baseStrength';
  api.workouts = [w1029, w1111, w1121, {
    date: '2026-11-25',
    sets: [
      { exercise: 'Jalkakyykky', weightKg: 110, targetReps: 3, reps: w1121.sets[0].reps },
      { exercise: 'Sotilaspenkkipunnerrus', weightKg: 77.5, targetReps: 3, reps: [w1121.sets[6].reps[0]] }
    ]
  }];

  const sq = api.computeDailyPlan('Jalkakyykky', '2026-11-25');
  assert.equal(sq.progression.mode, 'reps');
  assert.equal(sq.load, 127.5);
  assert.equal(sq.reps, 4);
  assert.ok(sq.alt && sq.alt.kind === 'load' && sq.alt.load === 132.5);
  const altHtml = api.planAltHTML(sq, { withButtons: true });
  assert.ok(altHtml.includes(`${sq.alt.sets} × ${sq.alt.reps} @ ${sq.alt.load} kg`));
  assert.ok(altHtml.includes(`data-plan-apply="${sq.alt.load}|${sq.alt.reps}"`));

  const bp = api.computeDailyPlan('Sotilaspenkkipunnerrus', '2026-11-25');
  assert.equal(bp.progression.mode, 'load', 'Bench must fall back to load progression when +1 rep exceeds VL cap');
  assert.equal(bp.load, 90);
  assert.equal(bp.reps, 3);
  assert.equal(bp.alt, null);

  // Peaking must never offer rep progression alternative
  api.vbtSettings.goal = 'peaking';
  const sqPeak = api.computeDailyPlan('Jalkakyykky', '2026-11-25');
  assert.ok(!sqPeak.alt || sqPeak.alt.kind !== 'reps', 'Peaking must not propose rep progression alt');
});

test('6. "+1 toisto ok" skips ref set, uses valid.length, and voice cue toggles audioSession', () => {
  const { api, audioSessionLog, audioEvents, getLastAudioEl, getSpokenTexts } = loadApp();
  const { w1029, w1111, w1121 } = buildFixtures();
  api.vbtSettings.goal = 'baseStrength';

  // Viitesarja-tilanne (ei vielä aiempaa viitesarjaa tänään)
  api.workouts = [w1029, w1111];
  assert.equal(api.isReferenceSetContext('Jalkakyykky', '2026-11-21'), true);
  const aRef = api.analyzeSet(w1121.sets[0].reps, 'Jalkakyykky', 110, { dateStr: '2026-11-21' });
  assert.equal(api.extraRepHint(aRef, 3, 3, { isRef: true }), null);

  // Kelvollinen työsarja (#10 penkki 87.5 kg x 3)
  api.workouts = [w1029, w1111, w1121];
  const aWork = api.analyzeSet(w1121.sets[9].reps, 'Sotilaspenkkipunnerrus', 87.5, { dateStr: '2026-11-21' });
  assert.ok(api.extraRepHint(aWork, 3, 3), 'Clean bench work set #10 should allow +1 rep');

  // Epäilyttävä telineestä otto (1 suspect + 2 valid) ei saa täyttää targetReps=3
  const withUnrack = [makeRep(0.18, 28), makeRep(0.50, 29), makeRep(0.49, 29)];
  const aSus = api.analyzeSet(withUnrack, 'Sotilaspenkkipunnerrus', 87.5, { dateStr: '2026-11-21' });
  assert.equal(aSus.valid.length, 2);
  assert.equal(api.extraRepHint(aSus, 3, 3), null);

  // Upotettu MP3 täsmää levytiedostoon
  const m = api.EXTRA_REP_VOICE_DATA_URI.match(/^data:audio\/mpeg;base64,(.+)$/);
  assert.ok(m, 'EXTRA_REP_VOICE_DATA_URI must be base64 MP3');
  const embedded = Buffer.from(m[1], 'base64');
  const onDisk = fs.readFileSync(VOICE_PATH);
  assert.ok(embedded.equals(onDisk), 'Embedded MP3 must match assets/kevytta-viela-yksi-toisto.mp3');

  // Äänikehotteen audioSession-siirtymä: transient-solo -> play -> ended -> ambient + keepWarm palautuu
  api.setActive = true;
  api.startAudioKeepWarm();
  assert.ok(api.keepWarmOsc, 'keepWarmOsc should start');
  audioSessionLog.length = 0;
  audioEvents.length = 0;

  api.playExtraRepVoiceCue();
  assert.equal(api.extraVoicePlaying, true);
  assert.equal(api.keepWarmOsc, null, 'keepWarmOsc must pause during solo voice cue');
  assert.equal(audioSessionLog[0], 'transient-solo');
  assert.ok(audioEvents.includes('play'));

  // speakRepVelocity ei saa puhua päälle kesken kehotteen
  api.vbtSettings.voiceVelocity = true;
  api.speakRepVelocity(0.50);
  assert.equal(getSpokenTexts().length, 0);

  // Toiston päättyessä palataan ambient-tilaan ja keepWarm käynnistyy uudelleen
  getLastAudioEl().onended();
  assert.equal(api.extraVoicePlaying, false);
  assert.equal(audioSessionLog[audioSessionLog.length - 1], 'ambient');
  assert.ok(api.keepWarmOsc, 'keepWarmOsc must resume after voice cue ends while setActive');
});

test('7. B1 determinism, setRepCountOverride, getAnchor1RM, buildSetAnalysisHTML & cache key', () => {
  const { api } = loadApp();
  const { w1029, w1111, w1121 } = buildFixtures();
  api.vbtSettings.goal = 'baseStrength';
  api.workouts = [w1029, w1111, w1121];

  const aBefore = api.analyzeSet(w1121.sets[6].reps, 'Sotilaspenkkipunnerrus', 77.5, { dateStr: '2026-11-21' });
  const romBefore = api.historyMedianRom('bench', '2026-11-21');

  // Lisätään tulevaisuuden treeni (2026-11-28) -> 2026-11-21 tulokset eivät saa muuttua
  api.workouts = [w1029, w1111, w1121, {
    date: '2026-11-28',
    sets: Array.from({ length: 4 }, () => ({
      exercise: 'Sotilaspenkkipunnerrus', weightKg: 90, targetReps: 3,
      reps: [makeRep(0.50, 42), makeRep(0.38, 42), makeRep(0.26, 42)]
    }))
  }];
  const aAfter = api.analyzeSet(w1121.sets[6].reps, 'Sotilaspenkkipunnerrus', 77.5, { dateStr: '2026-11-21' });
  const romAfter = api.historyMedianRom('bench', '2026-11-21');
  assert.equal(aAfter.cost, aBefore.cost);
  assert.equal(aAfter.rirEnd, aBefore.rirEnd);
  assert.equal(romAfter, romBefore);

  // setRepCountOverride säilyttää korjauksen arvoon s.reps.length jos sarjassa on merged-toisto
  api.workouts = [w1029, w1111, JSON.parse(JSON.stringify(w1121))];
  api.setRepCountOverride('2026-11-21', 6, 2);
  assert.equal(api.workouts[2].sets[6].repCountOverride, 2);
  assert.equal(api.setRepCount(api.workouts[2].sets[6]), 2);

  // buildSetAnalysisHTML laskee keskinopeuden ja ROM:n vain kelvollisista toistoista (Set #7: 0.51 m/s, 30 cm)
  const html = api.buildSetAnalysisHTML(api.workouts[2].sets[6], { dateStr: '2026-11-21' });
  assert.ok(html.includes('0.51 m/s'), 'avgVel should come from valid rep (0.506 -> 0.51)');
  assert.ok(html.includes('30 cm'), 'avgRom should come from valid rep (29.8 -> 30)');

  // getAnchor1RM ei saa laskea merged/suspect-toistoja mukaan
  api.workouts = [{
    date: '2026-11-21',
    sets: [{
      exercise: 'Sotilaspenkkipunnerrus', weightKg: 105, targetReps: 5,
      reps: [makeRep(0.45, 29), makeRep(0.44, 29), makeRep(0.43, 29), makeRep(0.42, 29), makeRep(0.41, 29), makeRep(0.18, 55)]
    }]
  }];
  // Ilman suspect-suodatusta 6x105 = 124.0 kg; suodatettuna 5x105 = 120.3 kg (= oletusankkuri)
  assert.ok(api.getAnchor1RM('Sotilaspenkkipunnerrus') < 121, 'getAnchor1RM must exclude merged/suspect rep');

  // workoutsSignature muuttuu asetusten vaihtuessa
  const sig1 = api.workoutsSignature();
  api.vbtSettings.goal = 'peaking';
  const sig2 = api.workoutsSignature();
  assert.notEqual(sig1, sig2, 'workoutsSignature must include goal');
});

test('8. Manual-only deadlift TnG & vBest fallback never picks suspect/drift rep', () => {
  const { api } = loadApp();
  const { dl1029, dl1124 } = buildDeadliftFixtures();
  api.vbtSettings.goal = 'baseStrength';
  api.workouts = [dl1029, dl1124];

  // Set #3 (120 kg): pauset [59 ms (drift), 657 ms] < 800 ms -> oletuksena SILTI tng=false
  const s3 = dl1124.sets[2];
  const a3Default = api.analyzeSet(s3.reps, s3.exercise, s3.weightKg, { dateStr: '2026-11-24' });
  assert.equal(a3Default.tng, false, 'Deadlift must default to dead-stop (tng=false) even with <800 ms pauses');
  assert.equal(a3Default.vBest, 0.567);
  assert.equal(a3Default.vBestIdx, 0);
  assert.ok(Math.abs(a3Default.vlFinal - 17.813) < 0.2, `Expected ~17.8% VL on Set #3, got ${a3Default.vlFinal}`);

  // Kun opts.touchAndGo === true -> tng=true, 1. toisto ohitetaan
  const a3Tng = api.analyzeSet(s3.reps, s3.exercise, s3.weightKg, { dateStr: '2026-11-24', touchAndGo: true });
  assert.equal(a3Tng.tng, true);
  assert.equal(a3Tng.perRep[0].vl, null);
  assert.equal(a3Tng.vBest, 0.466);
  assert.equal(a3Tng.vBestIdx, 2);

  // Ei-maastavedossa opts.touchAndGo ei aktivoi TnG:tä
  const sqTng = api.analyzeSet([makeRep(0.60, 65), makeRep(0.55, 65)], 'Jalkakyykky', 110, { dateStr: '2026-11-24', touchAndGo: true });
  assert.equal(sqTng.tng, false);

  // vBest fallback Set #2 (115 kg: r1=0.563/40.1cm, r2=0.741/114.0cm drift):
  // Vaikka tng=true ohittaa r1:n pääsilmukassa, fallback valitsee kelvollisen r1:n (0.563), EI drift/suspect r2:ta (0.741)
  const s2 = dl1124.sets[1];
  const a2Tng = api.analyzeSet(s2.reps, s2.exercise, s2.weightKg, { dateStr: '2026-11-24', touchAndGo: true });
  assert.equal(a2Tng.vBest, 0.563, 'Fallback must pick non-suspect rep over drift/suspect rep');
  assert.equal(a2Tng.vBestIdx, 0);

  // Jos kaikki toistot ovat suspect, fallback käyttää silti Math.max(...vs)
  const allSus = api.analyzeSet([makeRep(0.741, 114)], 'Maastaveto', 115, { dateStr: '2026-11-24' });
  assert.equal(allSus.driftCount, 1);
  assert.equal(allSus.vBest, 0.741);
});

test('9. Deadlift drift vs merged: excluded from velocity/e1RM, counted in reps/volume/anchor/plan', () => {
  const { api } = loadApp();
  const { dl1029, dl1124 } = buildDeadliftFixtures();
  api.vbtSettings.goal = 'baseStrength';
  api.workouts = [dl1029, dl1124];

  // historyMedianRom suodattaa >1.6x drift-lämmittelyt pois
  const medRom = api.historyMedianRom('deadlift', '2026-11-24');
  assert.ok(medRom > 35 && medRom < 50, `Expected trimmed deadlift median ROM ~42-47 cm, got ${medRom}`);

  // Set #5 (130 kg: r1=0.490/46.6, r2=0.423/37.6, r3=0.384/67.7 drift)
  const s5 = dl1124.sets[4];
  const a5 = api.analyzeSet(s5.reps, s5.exercise, s5.weightKg, { dateStr: '2026-11-24' });
  assert.equal(a5.driftCount, 1);
  assert.equal(a5.mergedCount, 0);
  assert.equal(a5.valid.length, 2);
  assert.equal(a5.completedCount, 3);
  assert.deepEqual([...a5.perRep[2].flags], ['drift']);
  assert.equal(a5.perRep[2].suspect, true);
  assert.equal(a5.perRep[2].drift, true);
  assert.equal(a5.perRep[2].merged, false);
  assert.equal(a5.vBest, 0.490);
  assert.ok(Math.abs(a5.vlFinal - 13.673) < 0.2, `Expected ~13.7% VL (r1->r2), got ${a5.vlFinal}`);

  // epleyRir laskee completedCount (3) + rirEnd (ei valid.length 2 + rirEnd)
  assert.equal(a5.rirEnd, 4);
  const expectedEpley3 = 0.5 * (130 * (1 + 7 / 30) + 130 * (36 / (37 - 7)));
  assert.ok(Math.abs(a5.epleyRir - expectedEpley3) < 0.15, `Expected epleyRir for 7 reps (~158.0), got ${a5.epleyRir}`);

  // planRepsOf & weeklyVolume laskevat drift-toistot mukaan (Set #1 lämmittely pois, Set #3=3 ja Set #5=3 -> 6)
  assert.equal(api.planRepsOf({ set: s5, a: a5 }), 3);
  api.workouts = [dl1029, { date: '2026-11-24', sets: [dl1124.sets[0], dl1124.sets[2], dl1124.sets[4]] }];
  const wv = api.weeklyVolume('Maastaveto', '2026-11-23');
  assert.equal(wv.reps, 6);
  assert.equal(wv.sets, 2);

  // extraRepHint käyttää completedCount (3 >= target 3) kun viimeinen toisto on valid ja keskellä on drift-toisto
  api.workouts = [dl1029, { date: '2026-11-24', sets: [dl1124.sets[2]] }]; // 120 kg ref set
  const lightWork = [makeRep(0.58, 41), makeRep(0.56, 85), makeRep(0.55, 41)];
  const aLight = api.analyzeSet(lightWork, 'Maastaveto', 120, { dateStr: '2026-11-24' });
  assert.equal(aLight.valid.length, 2);
  assert.equal(aLight.driftCount, 1);
  assert.equal(aLight.completedCount, 3);
  assert.ok(api.extraRepHint(aLight, 3, 3, { isRef: false }), 'extraRepHint should count drift rep in completedCount');

  // getAnchor1RM laskee maastavedon drift-toiston validCountiin (5x155 = 177.6 > 4x155 = 172.2)
  api.vbtSettings.refMax.deadlift = { weight: 100, reps: 1 };
  api.workouts = [{
    date: '2026-11-24',
    sets: [{
      exercise: 'Maastaveto', weightKg: 155, targetReps: 5,
      reps: [makeRep(0.34, 42), makeRep(0.33, 42), makeRep(0.32, 82), makeRep(0.31, 42), makeRep(0.30, 42)]
    }]
  }];
  assert.ok(api.getAnchor1RM('Maastaveto') > 177, `getAnchor1RM must include deadlift drift rep, got ${api.getAnchor1RM('Maastaveto')}`);

  // Aito 2-huippuinen käyrä maastavedossa luokitellaan edelleen 'merged'-lipulla
  const curve = [];
  let pos = 0;
  for (let i = 0; i < 40; i++) {
    const v = i < 16 ? Math.sin((i / 15) * Math.PI) * 500 : (i < 22 ? 20 : Math.sin(((i - 22) / 17) * Math.PI) * 480);
    pos += (v / 1000) * (1 / 40) * 100;
    curve.push([+pos.toFixed(1), Math.round(v)]);
  }
  const aTrueMerged = api.analyzeSet([makeRep(0.30, 82, { curve })], 'Maastaveto', 120, { dateStr: '2026-11-24' });
  assert.equal(aTrueMerged.mergedCount, 1);
  assert.equal(aTrueMerged.driftCount, 0);
  assert.equal(aTrueMerged.completedCount, 0);
  assert.deepEqual([...aTrueMerged.perRep[0].flags], ['merged']);

  // buildCSV säilyttää 44 saraketta ja tulostaa drift-lipun sekä tng=0/1 oikein
  api.workouts = [dl1029, { date: '2026-11-24', sets: [{ ...s5, touchAndGo: false }] }];
  const csvRows = api.buildCSV().split('\n');
  assert.equal(csvRows[0].split(',').length, 44, 'CSV header must remain 44 columns');
  const dl24Rows = csvRows.filter((r) => r.startsWith('2026-11-24,'));
  assert.equal(dl24Rows.length, 3);
  const s5r3Cols = dl24Rows[2].split(',');
  assert.equal(s5r3Cols[31], '0', 'set_touch_and_go should be 0 when dead-stop');
  assert.equal(s5r3Cols[34], 'drift', 'rep_flags should emit drift');

  api.workouts = [dl1029, { date: '2026-11-24', sets: [{ ...s5, touchAndGo: true }] }];
  const s5r3TngCols = api.buildCSV().split('\n').filter((r) => r.startsWith('2026-11-24,'))[2].split(',');
  assert.equal(s5r3TngCols[31], '1', 'set_touch_and_go should be 1 when touchAndGo=true');

  // buildSetAnalysisHTML näyttää IMU-ajautuman ja manuaalisen TnG-valinnan maastavedolle
  const htmlAna = api.buildSetAnalysisHTML(s5, { allowRepDelete: true, dateStr: '2026-11-24' });
  assert.ok(htmlAna.includes('IMU-ajautuma'));
  assert.ok(htmlAna.includes('data-toggle-tng="1"'));
});

test('10. Deadlift constants (VL 20%, redVl 25%, dxMax null, refMax 170 kg) & redVl-anchored VL->RIR', () => {
  const { api } = loadApp();
  const { dl1029, dl1124 } = buildDeadliftFixtures();

  assert.equal(api.VBT_GOALS.baseStrength.vl.deadlift, 20);
  assert.equal(api.VBT_GOALS.maxStrength.vl.deadlift, 15);
  assert.equal(api.LIFT_ANALYSIS.deadlift.redVl, 25);
  assert.equal(api.TRACE_LIFT_RULES.deadlift.dxMax, null);
  assert.deepEqual({ ...api.DEFAULT_REF_MAX.deadlift }, { weight: 170, reps: 1 });
  assert.equal(api.getAnchor1RM('Maastaveto'), 170);

  api.vbtSettings.goal = 'baseStrength';
  api.workouts = [dl1029, dl1124];
  const prof = api.recentProfile('Maastaveto', '2026-11-24');

  // Set #7 (140 kg x 1, dxMax=23.0): ei 'dx'-lippua ja quality='good'
  const a7 = api.analyzeSet(dl1124.sets[6].reps, 'Maastaveto', 140, { profile: prof, dateStr: '2026-11-24' });
  assert.deepEqual([...a7.perRep[0].flags], []);
  assert.equal(a7.perRep[0].quality, 'good');

  // Kyykyssä dxMax=6.0 on yhä käytössä
  const sq = api.analyzeSet([makeRep(0.55, 65, { dxMax: 8.0, path: makePath(0) })], 'Jalkakyykky', 120, { dateStr: '2026-11-24' });
  assert.ok(sq.perRep[0].flags.includes('dx'));

  // Set #3 (120 kg, VL=17.8% < redVl*0.85=21.25%): RIR ei leikkaudu 3:een, score=100
  const a3 = api.analyzeSet(dl1124.sets[2].reps, 'Maastaveto', 120, { profile: prof, dateStr: '2026-11-24' });
  assert.equal(a3.rirEnd, 6);
  assert.equal(a3.score, 100);

  // Set #4 (130 kg, VL=22.7% välillä [21.25%, 25%)): RIR=2 (ei 1), laatu != bad, score=82
  const a4 = api.analyzeSet(dl1124.sets[3].reps, 'Maastaveto', 130, { profile: prof, dateStr: '2026-11-24' });
  assert.equal(a4.rirEnd, 2);
  assert.notEqual(a4.perRep[2].quality, 'bad');
  assert.equal(a4.score, 82);

  // Peaking (cutoffPct=5%): VL=12.3% on alle redVl*0.85 (21.25%), joten RIR ei leikkaudu vanhan cutoff*0.70=3.5% mukaan 3:een
  api.vbtSettings.goal = 'peaking';
  const aPeak = api.analyzeSet([makeRep(0.57, 42), makeRep(0.50, 42)], 'Maastaveto', 120, { dateStr: '2026-11-24' });
  assert.ok(aPeak.rirEnd > 3, `Peaking 12% VL must not clamp RIR to <=3, got ${aPeak.rirEnd}`);
});

test('11. readinessForDate compares fresh ascending 120 kg (+4.4% GREEN) instead of back-off 140 kg', () => {
  const { api } = loadApp();
  const { dl1029, dl1124 } = buildDeadliftFixtures();
  api.vbtSettings.goal = 'baseStrength';
  api.workouts = [dl1029, dl1124];

  const rd = api.readinessForDate('Maastaveto', '2026-11-24');
  assert.ok(rd, 'readinessForDate must return match');
  assert.equal(rd.weight, 120);
  assert.equal(rd.today, 0.567);
  assert.equal(rd.baseline, 0.543);
  assert.ok(Math.abs(rd.deltaPct - 4.42) < 0.1, `Expected +4.42% readiness, got ${rd.deltaPct}`);

  // Myös aiemman treenin back-off-sarja (150 kg -> 135 kg) suodattuu pois vertailusta
  api.workouts = [
    {
      date: '2026-11-10',
      sets: [
        { exercise: 'Maastaveto', weightKg: 150, targetReps: 1, reps: [makeRep(0.28, 36)] },
        { exercise: 'Maastaveto', weightKg: 135, targetReps: 3, reps: [makeRep(0.32, 38)] }
      ]
    },
    {
      date: '2026-11-24',
      sets: [
        { exercise: 'Maastaveto', weightKg: 135, targetReps: 3, reps: [makeRep(0.43, 41)] }
      ]
    }
  ];
  assert.equal(api.readinessForDate('Maastaveto', '2026-11-24'), null, 'Prior post-drop back-off set must not be used for readiness');
});

test('12. Full 2026-10-29 + 2026-11-24 deadlift replay & computeDailyPlan checkpoints', () => {
  const { api } = loadApp();
  const { dl1029, dl1124 } = buildDeadliftFixtures();
  api.vbtSettings.goal = 'baseStrength';
  api.workouts = [dl1029, dl1124];

  const sp = api.sessionProfile('Maastaveto', '2026-11-24');
  assert.equal(sp.valid, true);
  assert.ok(sp.r2 > 0.90, `Expected sessionProfile r^2 > 0.90, got ${sp.r2}`);
  assert.ok(sp.e1RM >= 165 && sp.e1RM <= 172, `Expected e1RM ~168.4, got ${sp.e1RM}`);

  const prof = api.recentProfile('Maastaveto', '2026-11-24');
  const a3 = api.analyzeSet(dl1124.sets[2].reps, 'Maastaveto', 120, { profile: prof, dateStr: '2026-11-24' });
  const a4 = api.analyzeSet(dl1124.sets[3].reps, 'Maastaveto', 130, { profile: prof, dateStr: '2026-11-24' });
  const a5 = api.analyzeSet(dl1124.sets[4].reps, 'Maastaveto', 130, { profile: prof, dateStr: '2026-11-24' });

  assert.equal(a3.score, 100);
  assert.equal(a3.rirEnd, 6);
  assert.ok(a3.e1RM > 165 && a3.e1RM < 170);

  assert.equal(a4.score, 82);
  assert.equal(a4.rirEnd, 2);
  assert.ok(a4.perRep[2].flags.includes('tech') && !a4.perRep[2].flags.includes('dx'));

  assert.equal(a5.score, 100);
  assert.equal(a5.rirEnd, 4);
  assert.ok(a5.e1RM > 166 && a5.e1RM < 171);

  const planAt = (nSets, override78 = false) => {
    const w = JSON.parse(JSON.stringify(dl1124));
    w.sets = w.sets.slice(0, nSets);
    if (override78) {
      if (w.sets[6]) w.sets[6].repCountOverride = 3;
      if (w.sets[7]) w.sets[7].repCountOverride = 3;
    }
    api.workouts = [dl1029, w];
    return api.computeDailyPlan('Maastaveto', '2026-11-24');
  };

  const p2 = planAt(2);
  assert.equal(p2.stage, 'plan');
  assert.equal(p2.load, 120);
  assert.equal(p2.reps, 4);
  assert.equal(p2.progression.mode, 'reps');
  assert.equal(p2.alt.load, 125);

  const p3 = planAt(3);
  assert.equal(p3.load, 125);
  assert.equal(p3.reps, 3);
  assert.equal(p3.sets, 4);
  assert.equal(p3.adjust, null);

  const p4 = planAt(4);
  assert.equal(p4.load, 130);
  assert.equal(p4.reps, 3);
  assert.equal(p4.sets, 4);
  assert.equal(p4.doneSets, 1);
  assert.equal(p4.doneReps, 3);

  const pFullRaw = planAt(8, false);
  assert.equal(pFullRaw.doneSets, 5);
  assert.equal(pFullRaw.doneReps, 9);
  assert.equal(pFullRaw.remainingSets, 1);
  assert.equal(pFullRaw.remainingReps, 3);

  const pFullOvr = planAt(8, true);
  assert.equal(pFullOvr.doneSets, 5);
  assert.equal(pFullOvr.doneReps, 13);
  assert.equal(pFullOvr.remainingSets, 0);
  assert.equal(pFullOvr.remainingReps, 0);
  assert.equal(pFullOvr.adjust, null);
});

test('13. BLE pauseMs jitter guard, partial burst, reconnect resume, rezero, 80 Hz trace & TnG persistence', async () => {
  const { api, els, storage, timers, setNow, advanceMs } = loadApp();
  setNow(1700000000000);

  const pkt2 = (a, b) => ({ target: { value: new DataView(new Uint8Array([a, b]).buffer) } });
  const pkt5 = (type, floatVal) => {
    const buf = new ArrayBuffer(5);
    const dv = new DataView(buf);
    dv.setUint8(0, type);
    dv.setFloat32(1, floatVal, true);
    return { target: { value: dv } };
  };
  const drainTimers = async (promise, maxMs = 500) => {
    let done = false;
    const tracked = promise.then((v) => { done = true; return v; }, (e) => { done = true; throw e; });
    for (let i = 0; i < 60 && !done; i++) {
      for (const t of timers) {
        if (!t.cleared && t.ms <= maxMs) { t.cleared = true; t.fn(); }
      }
      await Promise.resolve();
    }
    return tracked;
  };

  // A. touchAndGo UI & tallennus
  api.renderContextAndSteppers();
  const exSel = els.get('exerciseSelect');
  const wInp = els.get('weightInput');
  const rInp = els.get('targetRepsInput');
  const dInp = els.get('workoutDate');
  const tngChk = els.get('tngToggle');
  const tngRow = els.get('tngToggleRow');

  dInp.value = '2026-11-24';
  exSel.value = 'Maastaveto';
  wInp.value = '130';
  rInp.value = '3';
  tngChk.checked = true;
  api.renderContextAndSteppers();
  assert.equal(tngRow.classList.contains('hidden'), false, '#tngToggleRow visible for deadlift');
  assert.equal(api.snapshotCurrentSetMeta().touchAndGo, true);

  exSel.value = 'Jalkakyykky';
  api.renderContextAndSteppers();
  assert.equal(tngRow.classList.contains('hidden'), true, '#tngToggleRow hidden for squat');
  assert.equal(tngChk.checked, false, '#tngToggle unchecked when switching away from deadlift');

  // Takaisin maastavetoon & TnG päälle -> commit + setTouchAndGo
  exSel.value = 'Maastaveto';
  tngChk.checked = true;
  api.renderContextAndSteppers();
  api.activeSetMeta = api.snapshotCurrentSetMeta();
  api.currentReps = [makeRep(0.49, 44, { pause: null }), makeRep(0.45, 44, { pause: 650 })];
  api.currentSetSaved = false;
  assert.equal(api.commitCurrentSetToWorkouts(), true);
  assert.equal(api.workouts[0].sets[0].touchAndGo, true);
  assert.ok(JSON.parse(storage.get('gpath_workouts_v1'))[0].sets[0].touchAndGo === true);

  const sigOn = api.workoutsSignature();
  assert.equal(api.setTouchAndGo('2026-11-24', 0, false), true);
  assert.equal(api.workouts[0].sets[0].touchAndGo, undefined);
  assert.notEqual(api.workoutsSignature(), sigOn, 'workoutsSignature must reflect touchAndGo change');

  // B. Live BLE pauseMs jitter-suoja + osittainen pakettiryhmä
  api.workouts = [];
  api.currentReps = [];
  api.currentSetSaved = false;
  api.lastSavedSetRef = null;
  tngChk.checked = false;
  api.activeSetMeta = api.snapshotCurrentSetMeta();
  api.setActive = true;
  api.setStartedAt = Date.now();
  api.lastBottomAt = 0;
  api.lastEccEndAt = 0;

  // Sarjan alussa (<1500 ms) pelkkä 0x02 ilman 0x03/0x04/0x05 suodatetaan haamuna
  advanceMs(300);
  api.onNotification(pkt5(0x02, 480));
  assert.equal(api.currentReps.length, 0);
  assert.equal(api.bleDiagLog[api.bleDiagLog.length - 1].kind, 'ghost-filtered');

  // Täysi Rep 1
  advanceMs(500);
  api.onNotification(pkt2(0x01, 0x01));
  api.onNotification(pkt5(0x03, 500));
  api.onNotification(pkt5(0x05, 420));
  api.onNotification(pkt5(0x04, 1500));
  api.onNotification(pkt5(0x02, 490));
  assert.equal(api.currentReps.length, 1);

  // Lasku päättyy (0x06) -> toistuvat 0x01 0x03 -värähtelyt lattialla EIVÄT saa nollata taukokelloa
  advanceMs(1000);
  api.onNotification(pkt5(0x06, 450)); // lastEccEndAt = T0+1800
  advanceMs(100);
  api.onNotification(pkt2(0x01, 0x03)); // T0+1900 (ensimmäinen lepopaketti)
  advanceMs(500);
  api.onNotification(pkt2(0x01, 0x03)); // T0+2400 (lattiavärähtely)
  advanceMs(600);
  api.onNotification(pkt2(0x01, 0x03)); // T0+3000 (lattiavärähtely)
  advanceMs(100);
  api.onNotification(pkt2(0x01, 0x01)); // T0+3100 -> todellinen tauko 3100 - 1800 = 1300 ms
  // Rep 2: osittainen paketti (vain 0x02, ilman 0x03/0x04/0x05) hyväksytään >1500 ms ikkunan jälkeen!
  advanceMs(500);
  api.onNotification(pkt5(0x02, 430));
  assert.equal(api.currentReps.length, 2, 'Partial burst on Rep 2 must be accepted');
  assert.equal(api.currentReps[1].pauseMs, 1300, 'pauseMs must anchor to lastEccEndAt, ignoring floor jitter');
  assert.equal(api.currentReps[1].rangeOfMotionCm, 0);
  assert.ok(api.bleDiagLog.some((e) => e.kind === 'partial-accepted'));

  // C. 80 Hz trace (0xB1 + 0xA4): korvaa pauseMs ja varoittaa ylimääräisestä segmentistä (+1 puuttuva)
  const samples = [];
  const pushQuiet = (n) => { for (let i = 0; i < n; i++) samples.push([12500, 0, 0, 0, 0, 0, 2048, 0, 0]); };
  const pushConc = (n, peak) => {
    for (let i = 0; i < n; i++) {
      const v = Math.round(Math.sin(((i + 0.5) / n) * Math.PI) * peak);
      samples.push([12500, 0, 0, 0, 0, 0, 2048, 0, v]);
    }
  };
  const pushEcc = (n) => {
    for (let i = 0; i < n; i++) {
      const v = -Math.round(Math.sin(((i + 0.5) / n) * Math.PI) * 500);
      samples.push([12500, 0, 0, 0, 0, 0, 2048, 0, v]);
    }
  };
  pushQuiet(30);
  pushConc(32, 700);
  pushEcc(24);
  pushQuiet(80); // ~1000 ms dead-stop pause before Rep 2
  pushConc(32, 650);
  pushEcc(24);
  pushQuiet(48); // ~600 ms pause before Rep 3 (missed live)
  pushConc(32, 600);
  pushQuiet(20); // total 322 samples

  const b1 = new ArrayBuffer(15);
  const b1dv = new DataView(b1);
  b1dv.setUint8(0, 0xb1);
  b1dv.setUint32(1, 0, true);
  b1dv.setUint32(5, 4000, true);
  b1dv.setUint16(9, 3, true);
  b1dv.setUint32(11, samples.length, true);
  api.handleTraceNotification(b1dv);

  const perPkt = 23;
  const totalPkts = Math.ceil(samples.length / perPkt);
  for (let p = 0; p < totalPkts; p++) {
    const chunk = samples.slice(p * perPkt, (p + 1) * perPkt);
    const buf = new ArrayBuffer(6 + chunk.length * 34);
    const dv = new DataView(buf);
    dv.setUint8(0, 0xa4);
    dv.setUint16(1, p, true);
    dv.setUint16(3, totalPkts, true);
    dv.setUint8(5, chunk.length);
    chunk.forEach((row, idx) => {
      const o = 6 + idx * 34;
      dv.setUint16(o, row[0], true);
      for (let c = 0; c < 8; c++) dv.setInt32(o + 2 + c * 4, row[c + 1], true);
    });
    api.handleTraceNotification(dv);
  }
  assert.equal(api.lastTraceFailed, true, 'Trace mismatch (3 segments vs 2 reps) must flag lastTraceFailed');
  assert.ok(api.lastTraceStatus.includes('3 nostoa') && api.lastTraceStatus.includes('+1 puuttuvaa'));
  assert.ok(api.currentReps[1].pauseMs >= 800 && api.currentReps[1].pauseMs <= 1350, `Expected trace pauseMs ~1000 ms, got ${api.currentReps[1].pauseMs}`);
  assert.ok(api.bleDiagLog.some((e) => e.kind === 'trace-mismatch'));

  const aLive = api.analyzeSet(api.currentReps, 'Maastaveto', 130, { dateStr: '2026-11-24' });
  const verdict = api.buildVerdict(aLive, 'Maastaveto', { traceMeta: { segments: 3, extraReps: 1 }, count: 2 });
  assert.ok(verdict.includes('3 nostoa') && verdict.includes('+1 puuttuvaa'));
  const finding = api.buildShortRestFinding(aLive, 'Maastaveto', { traceMeta: { segments: 3, extraReps: 1 }, count: 2 });
  assert.ok(finding && finding.text.includes('+1 puuttuvaa'));

  // D. Katkenneen BLE-yhteyden automaattinen sarjan jatkaminen + rezeroPin() + diagnostiikka-UI
  const writtenBytes = [];
  const fakeChar = {
    async startNotifications() {},
    addEventListener() {},
    removeEventListener() {},
    async writeValue(arr) { writtenBytes.push(arr[0]); }
  };
  api.bleDevice = {
    gatt: {
      connected: true,
      async connect() {
        return {
          async getPrimaryService() {
            return { async getCharacteristic() { return fakeChar; } };
          }
        };
      }
    }
  };
  api.dataChar = fakeChar;
  api.manualDisconnect = false;
  api.setActive = true;
  api.onDisconnected();
  assert.equal(api.resumeSetAfterReconnect, true);
  assert.equal(api.setActive, false);
  assert.ok(api.bleDiagLog.some((e) => e.kind === 'disconnect'));

  advanceMs(5000);
  await drainTimers(api.openGattSession());
  assert.equal(api.zeroing, true);
  assert.equal(api.resumeSetAfterReconnect, false);
  assert.ok(api.bleDiagLog.some((e) => e.kind === 'reconnect-resumed'));

  // Kalibroinnin valmistuttua sarja jatkuu vanhoilla toistoilla & activeSetMeta säilyy
  api.finishCalibrationAndActivate(api.activeSetToken);
  assert.equal(api.setActive, true);
  assert.equal(api.currentReps.length, 2);
  assert.equal(api.activeSetMeta.weightKg, 130);

  // Lopeta sarja ja testaa manuaalinen rezeroPin() -> 0x04 + 0x03
  await drainTimers(api.stopSetOnPin(true));
  writtenBytes.length = 0;
  await drainTimers(api.rezeroPin());
  assert.equal(api.zeroing, true);
  assert.ok(writtenBytes.includes(api.CMD_STOP), 'rezeroPin must send CMD_STOP (0x04)');
  assert.ok(writtenBytes.includes(api.CMD_START), 'rezeroPin must send CMD_START (0x03)');
  assert.ok(api.bleDiagLog.some((e) => e.kind === 'rezero'));

  api.refreshBleDiagUI();
  assert.ok(els.get('bleDiagSummary').textContent.includes(String(api.bleDiagLog.length)));
  assert.ok(els.get('bleDiagList').innerHTML.includes('rezero'));
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n  ${err && err.stack ? err.stack : err}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} tests passed.`);
process.exit(failed ? 1 : 0);
