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
      querySelector() { return null; },
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
    console, Math, Date, JSON, Number, String, Boolean, Array, Object, Map, Set, RegExp, Error, Promise,
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
      get keepWarmOsc() { return keepWarmOsc; },
      get extraVoicePlaying() { return extraVoicePlaying; },
      EXTRA_REP_VOICE_DATA_URI,
      getLiftCfg, getAnchor1RM, workoutsSignature,
      detectMergedReps, splitCurveReps, historyMedianRom, flagSuspectReps,
      analyzeSet, ownVelocityCost, computeDailyPlan, planAltHTML,
      extraRepHint, isReferenceSetContext,
      setRepCount, setRepCountOverride, planRepsOf,
      buildSetAnalysisHTML, buildCSV,
      playExtraRepVoiceCue, speakRepVelocity, startAudioKeepWarm
    };
  `, sandbox);

  return {
    api: sandbox.__api,
    html,
    audioSessionLog,
    audioEvents,
    getLastAudioEl: () => lastAudioEl,
    getSpokenTexts: () => spokenTexts
  };
}

// Reaalidata 29.10., 11.11. ja 21.11.2026 treeneistä (tiivistettynä objektirakenteeksi)
function makeRep(v, rom, opts = {}) {
  return {
    meanVelocity: v,
    power: opts.power || 500,
    rangeOfMotionCm: rom,
    loweringVelocity: opts.low ?? null,
    propulsiveVelocity: opts.pv ?? v * 1.05,
    pauseMs: opts.pause ?? 50,
    t: opts.t ?? 0,
    ...(opts.stick !== undefined || opts.mid !== undefined ? {
      trace: {
        stick: opts.stick !== undefined ? { vmin: opts.stick, h: 45, ms: 300 } : null,
        midMin: opts.mid !== undefined ? { v: opts.mid, h: 15 } : null,
        dxMax: null,
        tilt: null,
        path: null,
        curve: opts.curve || null
      }
    } : (opts.curve ? { trace: { stick: null, midMin: null, dxMax: null, tilt: null, path: null, curve: opts.curve } } : {}))
  };
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

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n  ${err && err.stack ? err.stack : err}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} tests passed.`);
process.exit(failed ? 1 : 0);
