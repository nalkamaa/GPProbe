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

function loadApp(opts = {}) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'index.html must contain <script>');

  const els = new Map();
  const storage = new Map(Object.entries(opts.initialStorage || {}));
  const docListeners = new Map();
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

  function makeEl(id = '', tagName = '') {
    const cls = new Set(id === 'tabAnalysis' ? ['hidden'] : []);
    const attrs = new Map();
    const listeners = new Map();
    let htmlStr = '';
    const tagEls = new Map();
    const qCache = new Map();
    const el = {
      id, tagName: String(tagName || '').toUpperCase(),
      value: '', textContent: '', checked: false, disabled: false,
      dataset: {}, style: {}, parentNode: null,
      get innerHTML() { return htmlStr; },
      set innerHTML(v) {
        htmlStr = String(v ?? '');
        tagEls.clear();
        qCache.clear();
      },
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
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = listeners.get(type);
        if (arr) listeners.set(type, arr.filter((f) => f !== fn));
      },
      dispatch(type, evt = {}) {
        const eventObj = { target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...evt };
        const list = (listeners.get(type) || []).slice();
        const results = [];
        for (const fn of list) results.push(fn(eventObj));
        return results.some((r) => r && typeof r.then === 'function') ? Promise.all(results) : undefined;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        if (!htmlStr || !sel) return [];
        if (qCache.has(sel)) return qCache.get(sel);
        const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
        const matchedOffsets = new Set();
        const out = [];
        const tagRe = /<([a-zA-Z0-9-]+)([^>]*)>/g;
        let m;
        while ((m = tagRe.exec(htmlStr)) !== null) {
          const tName = m[1];
          const rawAttrs = m[2] || '';
          const idM = rawAttrs.match(/\bid\s*=\s*"([^"]*)"/);
          const tId = idM ? idM[1] : '';
          const clsM = rawAttrs.match(/\bclass\s*=\s*"([^"]*)"/);
          const tCls = clsM ? clsM[1].split(/\s+/).filter(Boolean) : [];
          const matchesOne = (s) => {
            if (s.startsWith('#')) return tId === s.slice(1);
            if (s.startsWith('.')) return tCls.includes(s.slice(1));
            const attrEq = s.match(/^\[([^\]=]+)=["']?([^\]"']*)["']?\]$/);
            if (attrEq) {
              const esc = attrEq[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              return new RegExp(`\\b${attrEq[1]}\\s*=\\s*["']${esc}["']`).test(rawAttrs);
            }
            const attrOnly = s.match(/^\[([^\]=]+)\]$/);
            if (attrOnly) {
              return new RegExp(`(?:^|\\s)${attrOnly[1]}(?:\\s*=|\\s|$)`).test(rawAttrs);
            }
            if (/^[a-zA-Z0-9-]+$/.test(s)) return tName.toLowerCase() === s.toLowerCase();
            return false;
          };
          if (parts.some(matchesOne) && !matchedOffsets.has(m.index)) {
            matchedOffsets.add(m.index);
            let child = tagEls.get(m.index);
            if (!child) {
              child = makeEl(tId, tName);
              const attrRe = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
              let am;
              while ((am = attrRe.exec(rawAttrs)) !== null) child.setAttribute(am[1], am[2]);
              if (/\bchecked\b/.test(rawAttrs)) child.checked = true;
              if (child.getAttribute('value') !== null) child.value = child.getAttribute('value');
              tCls.forEach((c) => child.classList.add(c));
              tagEls.set(m.index, child);
            }
            out.push(child);
          }
        }
        qCache.set(sel, out);
        return out;
      },
      appendChild(c) { if (c) c.parentNode = el; return c; },
      remove() { if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el); },
      removeChild(c) { if (c && c.parentNode === el) c.parentNode = null; return c; },
      closest() { return null; },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      select() {},
      focus() {},
      blur() {},
      click() { return el.dispatch('click'); }
    };
    return el;
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
      createElement(tag) { return makeEl('', tag); },
      addEventListener(type, fn) {
        if (!docListeners.has(type)) docListeners.set(type, []);
        docListeners.get(type).push(fn);
      },
      execCommand: undefined,
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
      get gattConnectPromise() { return gattConnectPromise; },
      get reconnectTimer() { return reconnectTimer; },
      get autoStartAfterZero() { return autoStartAfterZero; },
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
      get resumeSetDisconnectedAt() { return resumeSetDisconnectedAt; },
      set resumeSetDisconnectedAt(v) { resumeSetDisconnectedAt = v; },
      get pendingTraceMeta() { return pendingTraceMeta; },
      set pendingTraceMeta(v) { pendingTraceMeta = v; },
      get recentRawTraces() { return recentRawTraces; },
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
      readinessForDate, sessionProfile, recentProfile, e1rmTrend, weeklyVolume,
      extraRepHint, isReferenceSetContext,
      setRepCount, setRepCountOverride, setTouchAndGo, isLiveTouchAndGo, planRepsOf,
      snapshotCurrentSetMeta, commitCurrentSetToWorkouts, renderContextAndSteppers,
      renderLiveSet, renderVbtSettingsCard, openSetAnalysisSheet,
      startSetOnPin, stopSetOnPin, disconnectPin, onNotification, onDisconnected, openGattSession, rezeroPin, finishCalibrationAndActivate,
      handleTraceNotification, analyzeTrace, attachTraceToRecentSet,
      buildSetAnalysisHTML, buildVerdict, buildShortRestFinding, buildCSV,
      playExtraRepVoiceCue, speakRepVelocity, startAudioKeepWarm
    };
  `, sandbox);

  return {
    api: sandbox.__api,
    sandbox,
    html,
    els,
    storage,
    timers,
    dispatchDoc: (type, evt = {}) => {
      const list = (docListeners.get(type) || []).slice();
      for (const fn of list) fn({ target: sandbox.document, ...evt });
    },
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

  // Jos kaikki toistot ovat suspect, vBest ja e1RM jäävät nulliksi (ei drift-nopeutta)
  const allSus = api.analyzeSet([makeRep(0.741, 114)], 'Maastaveto', 115, { dateStr: '2026-11-24' });
  assert.equal(allSus.driftCount, 1);
  assert.equal(allSus.vBest, null);
  assert.equal(allSus.e1RM, null);
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

  // epleyRir laskee completedCount (3) + rirEnd (3, lopun drift-toisto vähennetty -> 6 toistoa)
  assert.equal(a5.rirEnd, 3);
  const expectedEpley3 = 0.5 * (130 * (1 + 6 / 30) + 130 * (36 / (37 - 6)));
  assert.ok(Math.abs(a5.epleyRir - expectedEpley3) < 0.15, `Expected epleyRir for 6 reps (~153.5), got ${a5.epleyRir}`);

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
  assert.equal(a5.rirEnd, 3);
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

  // Lopeta sarja ja testaa manuaalinen rezeroPin() -> [CMD_STOP, CMD_START] järjestyksessä
  await drainTimers(api.stopSetOnPin(true));
  writtenBytes.length = 0;
  await drainTimers(api.rezeroPin());
  assert.equal(api.zeroing, true);
  assert.deepEqual(writtenBytes, [api.CMD_STOP, api.CMD_START], 'rezeroPin must send [CMD_STOP, CMD_START] in order');
  assert.ok(api.bleDiagLog.some((e) => e.kind === 'rezero'));

  api.refreshBleDiagUI();
  assert.ok(els.get('bleDiagSummary').textContent.includes(String(api.bleDiagLog.length)));
  assert.ok(els.get('bleDiagList').innerHTML.includes('rezero'));
});

function buildSyntheticTracePackets(concPeaks, samplesBetween = 60) {
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
  concPeaks.forEach((pk, idx) => {
    if (idx > 0) pushQuiet(samplesBetween);
    pushConc(32, pk);
    pushEcc(24);
  });
  pushQuiet(30);
  if (samples.length < 180) pushQuiet(180 - samples.length);

  const pkts = [];
  const b1 = new ArrayBuffer(15);
  const b1dv = new DataView(b1);
  b1dv.setUint8(0, 0xb1);
  b1dv.setUint32(1, 0, true);
  b1dv.setUint32(5, Math.round((samples.length / 80) * 1000), true);
  b1dv.setUint16(9, concPeaks.length, true);
  b1dv.setUint32(11, samples.length, true);
  pkts.push(b1dv);

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
    pkts.push(dv);
  }
  return pkts;
}

test('14. BLE visibilitychange + 1200ms timer race & saveUnsavedSetBtn / clearRepsBtn reset resumeSetAfterReconnect', async () => {
  const { api, els, sandbox, timers, dispatchDoc, setNow, advanceMs } = loadApp();
  setNow(1700000000000);

  let connectCalls = 0;
  let deferredConnect = null;
  const fakeChar = {
    async startNotifications() {},
    addEventListener() {},
    removeEventListener() {},
    async writeValue() {}
  };
  api.bleDevice = {
    gatt: {
      connected: false,
      async connect() {
        connectCalls++;
        if (deferredConnect) {
          await deferredConnect.promise;
        }
        this.connected = true;
        return {
          async getPrimaryService() {
            return { async getCharacteristic() { return fakeChar; } };
          }
        };
      }
    }
  };
  const drainShort = async (maxMs = 500, untilFn = null) => {
    for (let i = 0; i < 200; i++) {
      let ran = false;
      for (const t of timers) {
        if (!t.cleared && t.ms <= maxMs) { t.cleared = true; t.fn(); ran = true; }
      }
      await Promise.resolve();
      if (untilFn && untilFn() && !timers.some((t) => !t.cleared && t.ms <= maxMs)) break;
      if (!untilFn && !ran && i > 10 && !timers.some((t) => !t.cleared && t.ms <= maxMs)) break;
    }
  };

  // A. visibilitychange laukeaa ennen 1200 ms ajastinta -> peruu ajastimen, openGattSession vain kerran, sarja jatkuu
  els.get('exerciseSelect').value = 'Maastaveto';
  els.get('weightInput').value = '130';
  els.get('targetRepsInput').value = '3';
  els.get('workoutDate').value = '2026-11-24';
  api.dataChar = fakeChar;
  api.bleDevice.gatt.connected = true;
  api.manualDisconnect = false;
  api.setActive = true;
  api.activeSetMeta = api.snapshotCurrentSetMeta();
  api.currentReps = [makeRep(0.49, 44)];

  api.bleDevice.gatt.connected = false;
  api.onDisconnected();
  assert.equal(api.resumeSetAfterReconnect, true);
  const rcTimerA = timers.find((t) => !t.cleared && t.ms === 1200);
  assert.ok(rcTimerA, 'onDisconnected must schedule 1200 ms reconnect timer');

  sandbox.document.visibilityState = 'visible';
  dispatchDoc('visibilitychange');
  assert.equal(rcTimerA.cleared, true, 'visibilitychange must cancel pending 1200 ms reconnectTimer');
  await drainShort(500, () => api.zeroing && api.gattConnectPromise === null);
  assert.equal(connectCalls, 1, 'visibilitychange + canceled timer must call gatt.connect only once');
  assert.equal(api.zeroing, true);
  assert.equal(api.autoStartAfterZero, true);

  // 3000 ms zeroTimer laukeaa -> sarja aktivoituu keskeytyksettä
  const zTimerA = timers.find((t) => !t.cleared && t.ms === 3000);
  assert.ok(zTimerA, '3000 ms calibration timer must be scheduled');
  zTimerA.cleared = true;
  zTimerA.fn();
  assert.equal(api.setActive, true, 'Set must resume after 3000 ms calibration');
  assert.equal(api.currentReps.length, 1);

  // B. 1200 ms ajastin käynnistää openGattSession():n ja visibilitychange osuu keskelle kesken olevaa connect()-kutsua
  connectCalls = 0;
  let resolveConn;
  deferredConnect = { promise: new Promise((r) => { resolveConn = r; }) };
  api.bleDevice.gatt.connected = false;
  api.onDisconnected();
  const rcTimerB = timers.find((t) => !t.cleared && t.ms === 1200);
  assert.ok(rcTimerB, 'Second disconnect must schedule 1200 ms reconnect timer');
  advanceMs(1200);
  rcTimerB.cleared = true;
  const timerPromise = rcTimerB.fn();
  await Promise.resolve();
  assert.equal(connectCalls, 1);
  assert.ok(api.gattConnectPromise, 'gattConnectPromise must be active while connecting');

  dispatchDoc('visibilitychange');
  await Promise.resolve();
  assert.equal(connectCalls, 1, 'visibilitychange during in-flight gattConnectPromise must not connect twice');

  deferredConnect = null;
  resolveConn();
  let timerDoneB = false;
  timerPromise.then(() => { timerDoneB = true; });
  await drainShort(500, () => timerDoneB);
  await timerPromise;
  assert.equal(connectCalls, 1);
  const zTimerB = timers.find((t) => !t.cleared && t.ms === 3000);
  assert.ok(zTimerB);
  zTimerB.cleared = true;
  zTimerB.fn();
  assert.equal(api.setActive, true);
  assert.equal(api.currentReps.length, 1);

  // C. #saveUnsavedSetBtn katkoksen aikana nollaa resumeSetAfterReconnect eikä kadota uusia toistoja
  api.workouts = [];
  api.currentReps = [makeRep(0.51, 43), makeRep(0.46, 43)];
  api.currentSetSaved = false;
  api.lastSavedSetRef = null;
  api.bleDevice.gatt.connected = false;
  api.onDisconnected();
  assert.equal(api.resumeSetAfterReconnect, true);
  assert.equal(api.setActive, false);

  await els.get('saveUnsavedSetBtn').dispatch('click');
  assert.equal(api.currentSetSaved, true);
  assert.equal(api.resumeSetAfterReconnect, false, '#saveUnsavedSetBtn must clear resumeSetAfterReconnect');
  assert.equal(api.resumeSetDisconnectedAt, 0);
  assert.equal(api.workouts[0].sets.length, 1);

  const rcTimerC = timers.find((t) => !t.cleared && t.ms === 1200);
  assert.ok(rcTimerC);
  rcTimerC.cleared = true;
  let timerDoneC = false;
  const pC = rcTimerC.fn().then(() => { timerDoneC = true; });
  await drainShort(500, () => timerDoneC);
  await pC;
  const zTimerC = timers.find((t) => !t.cleared && t.ms === 3000);
  if (zTimerC) { zTimerC.cleared = true; zTimerC.fn(); }
  assert.equal(api.setActive, false, 'Reconnect after manual save must NOT auto-resume saved set');

  // Uusi sarja tallennuksen jälkeen: uudet toistot tallentuvat uutena sarjana eivätkä katoa
  let startDone = false;
  const pStart = api.startSetOnPin().then(() => { startDone = true; });
  await drainShort(500, () => startDone);
  await pStart;
  assert.equal(api.setActive, true);
  const pkt2 = (a, b) => ({ target: { value: new DataView(new Uint8Array([a, b]).buffer) } });
  const pkt5 = (type, floatVal) => {
    const buf = new ArrayBuffer(5);
    const dv = new DataView(buf);
    dv.setUint8(0, type);
    dv.setFloat32(1, floatVal, true);
    return { target: { value: dv } };
  };
  advanceMs(600);
  api.onNotification(pkt2(0x01, 0x01));
  api.onNotification(pkt5(0x03, 520));
  api.onNotification(pkt5(0x05, 430));
  api.onNotification(pkt5(0x04, 1400));
  api.onNotification(pkt5(0x02, 500));
  await api.stopSetOnPin(true);
  assert.equal(api.workouts[0].sets.length, 2, 'New reps after saving unsaved set must be preserved');
  assert.equal(api.workouts[0].sets[1].reps.length, 1);

  // D. #clearRepsBtn katkoksen aikana nollaa resumeSetAfterReconnect ja pendingTraceMeta
  api.currentReps = [makeRep(0.48, 43)];
  api.currentSetSaved = false;
  api.pendingTraceMeta = { segments: 1 };
  api.setActive = true;
  api.bleDevice.gatt.connected = false;
  api.onDisconnected();
  assert.equal(api.resumeSetAfterReconnect, true);

  await els.get('clearRepsBtn').dispatch('click');
  assert.equal(api.currentReps.length, 0);
  assert.equal(api.pendingTraceMeta, null);
  assert.equal(api.resumeSetAfterReconnect, false, '#clearRepsBtn must clear resumeSetAfterReconnect');
  assert.equal(api.resumeSetDisconnectedAt, 0);

  const rcTimerD = timers.find((t) => !t.cleared && t.ms === 1200);
  assert.ok(rcTimerD);
  rcTimerD.cleared = true;
  let timerDoneD = false;
  const pD = rcTimerD.fn().then(() => { timerDoneD = true; });
  await drainShort(500, () => timerDoneD);
  await pD;
  const zTimerD = timers.find((t) => !t.cleared && t.ms === 3000);
  if (zTimerD) { zTimerD.cleared = true; zTimerD.fn(); }
  assert.equal(api.setActive, false, 'Reconnect after #clearRepsBtn must NOT auto-start empty set');
});

test('15. BLE pauseMs without 0x06 anchors to first 0x01 0x03 & partial burst excluded then filled by 80 Hz trace', () => {
  const app = loadApp();
  const { els, setNow, advanceMs } = app;
  const aApi = app.api;
  setNow(1700001000000);

  const pkt2 = (a, b) => ({ target: { value: new DataView(new Uint8Array([a, b]).buffer) } });
  const pkt5 = (type, floatVal) => {
    const buf = new ArrayBuffer(5);
    const dv = new DataView(buf);
    dv.setUint8(0, type);
    dv.setFloat32(1, floatVal, true);
    return { target: { value: dv } };
  };

  els.get('workoutDate').value = '2026-11-24';
  els.get('exerciseSelect').value = 'Maastaveto';
  els.get('weightInput').value = '130';
  els.get('targetRepsInput').value = '4';
  aApi.workouts = [];
  aApi.currentReps = [];
  aApi.currentSetSaved = false;
  aApi.activeSetMeta = aApi.snapshotCurrentSetMeta();
  aApi.setActive = true;
  aApi.setStartedAt = Date.now();
  aApi.lastBottomAt = 0;
  aApi.lastEccEndAt = 0;

  // Toisto 1 (täysi burst)
  advanceMs(500);
  aApi.onNotification(pkt2(0x01, 0x01));
  aApi.onNotification(pkt5(0x03, 520));
  aApi.onNotification(pkt5(0x05, 420));
  aApi.onNotification(pkt5(0x04, 1500));
  aApi.onNotification(pkt5(0x02, 500)); // T0+500
  assert.equal(aApi.currentReps.length, 1);

  // Ei 0x06-pakettia! Lattiavaiheen 0x01 0x03 tulee kolme kertaa -> lukittuu ensimmäiseen (T0+1100)
  advanceMs(600);
  aApi.onNotification(pkt2(0x01, 0x03)); // T0+1100 (ensimmäinen 0x01 0x03)
  advanceMs(500);
  aApi.onNotification(pkt2(0x01, 0x03)); // T0+1600 (lattiavärähtely)
  advanceMs(400);
  aApi.onNotification(pkt2(0x01, 0x03)); // T0+2000 (lattiavärähtely)
  advanceMs(200);
  aApi.onNotification(pkt2(0x01, 0x01)); // T0+2200 -> tauko = 2200 - 1100 = 1100 ms
  advanceMs(500);
  aApi.onNotification(pkt5(0x03, 490));
  aApi.onNotification(pkt5(0x05, 415));
  aApi.onNotification(pkt5(0x04, 1400));
  aApi.onNotification(pkt5(0x02, 470)); // T0+2700
  assert.equal(aApi.currentReps.length, 2);
  assert.equal(aApi.currentReps[1].pauseMs, 1100, 'pauseMs without 0x06 must anchor to first 0x01 0x03 and ignore floor jitter');

  // Toisto 3: osittainen burst (vain 0x02, romCm = 0, keinotekoisen nopea mv=0.72)
  advanceMs(1200);
  aApi.onNotification(pkt2(0x01, 0x03));
  advanceMs(800);
  aApi.onNotification(pkt2(0x01, 0x01));
  advanceMs(400);
  aApi.onNotification(pkt5(0x02, 720));
  assert.equal(aApi.currentReps.length, 3);
  assert.equal(aApi.currentReps[2].partial, true);
  assert.equal(aApi.currentReps[2].rangeOfMotionCm, 0);

  const aPartial = aApi.analyzeSet(aApi.currentReps, 'Maastaveto', 130, { dateStr: '2026-11-24' });
  assert.equal(aPartial.partialCount, 1);
  assert.equal(aPartial.perRep[2].partial, true);
  assert.equal(aPartial.perRep[2].suspect, true);
  assert.ok(aPartial.perRep[2].flags.includes('partial'));
  assert.equal(aPartial.vBest, 0.50, 'Partial rep must be excluded from vBest');
  assert.equal(aPartial.vBestIdx, 0);
  assert.ok(Math.abs(aPartial.vlFinal - 6.0) < 0.2, `VL must be computed from valid reps (0.50 -> 0.47 = 6%), got ${aPartial.vlFinal}`);
  assert.equal(aPartial.completedCount, 3, 'Partial rep counts in completedCount');
  const htmlPartial = aApi.buildSetAnalysisHTML({ exercise: 'Maastaveto', weightKg: 130, reps: aApi.currentReps }, { dateStr: '2026-11-24' });
  assert.ok(htmlPartial.includes('vajaa data'), 'Set analysis HTML must label partial rep as vajaa data');

  // 80 Hz trace täydentää osittaisen toiston rangeOfMotionCm:n ja poistaa partial-lipun
  for (const dv of buildSyntheticTracePackets([785, 738, 1130], 60)) {
    aApi.handleTraceNotification(dv);
  }
  assert.ok(aApi.currentReps[2].rangeOfMotionCm > 0, '80 Hz trace must fill rangeOfMotionCm on partial rep');
  assert.equal(aApi.currentReps[2].partial, undefined, '80 Hz trace must clear partial flag once ROM is filled');
  const aAfterTrace = aApi.analyzeSet(aApi.currentReps, 'Maastaveto', 130, { dateStr: '2026-11-24' });
  assert.equal(aAfterTrace.partialCount, 0);
});

test('16. rezeroPin() [CMD_STOP, CMD_START] order, #rezeroStatusText disconnect clear & #bleDiagCopyBtn UI', async () => {
  const { api, els, sandbox, timers } = loadApp();
  const writtenBytes = [];
  const fakeChar = {
    async startNotifications() {},
    addEventListener() {},
    removeEventListener() {},
    async writeValue(arr) { writtenBytes.push(arr[0]); }
  };
  api.bleDevice = { gatt: { connected: true, async disconnect() { this.connected = false; } } };
  api.dataChar = fakeChar;
  api.manualDisconnect = false;
  api.setActive = false;
  api.zeroing = false;
  api.bleConnecting = false;

  const drainPromise = async (p, maxMs = 500) => {
    let done = false;
    const tracked = Promise.resolve(p).then((v) => { done = true; return v; }, (e) => { done = true; throw e; });
    for (let i = 0; i < 200 && !done; i++) {
      for (const t of timers) {
        if (!t.cleared && t.ms <= maxMs) { t.cleared = true; t.fn(); }
      }
      await Promise.resolve();
    }
    return tracked;
  };

  // Klikataan #rezeroBtn -> rezeroPin() lähettää [CMD_STOP, CMD_START] järjestyksessä
  await drainPromise(els.get('rezeroBtn').dispatch('click'));
  assert.deepEqual(writtenBytes, [api.CMD_STOP, api.CMD_START]);
  assert.equal(api.zeroing, true);
  assert.equal(els.get('rezeroStatusText').classList.contains('hidden'), false);
  assert.ok(els.get('rezeroStatusText').textContent.includes('Nollataan anturia'));

  // Katkos tyhjentää #rezeroStatusText-tilatekstin
  api.onDisconnected();
  assert.equal(els.get('rezeroStatusText').classList.contains('hidden'), true);
  assert.equal(els.get('rezeroStatusText').textContent, '');

  // Sama varmistus disconnectPin():ssä
  api.dataChar = fakeChar;
  api.bleDevice.gatt.connected = true;
  api.bleConnecting = false;
  api.zeroing = false;
  await drainPromise(api.rezeroPin());
  assert.equal(els.get('rezeroStatusText').classList.contains('hidden'), false);
  await drainPromise(api.disconnectPin());
  assert.equal(els.get('rezeroStatusText').classList.contains('hidden'), true);
  assert.equal(els.get('rezeroStatusText').textContent, '');

  // #bleDiagCopyBtn UI-testi: clipboard -> execCommand fallback -> epäonnistuminen
  let copiedText = '';
  sandbox.navigator.clipboard = {
    async writeText(txt) { copiedText = txt; }
  };
  api.logBleDiag('info', 'diag-smoke-check');
  api.renderVbtSettingsCard();
  const settingsEl = els.get('anaSettingsCard');
  const copyBtn = settingsEl.querySelector('#bleDiagCopyBtn');
  const msgEl = settingsEl.querySelector('#bleDiagCopyMsg');
  assert.ok(copyBtn, 'renderVbtSettingsCard must render #bleDiagCopyBtn');

  await copyBtn.dispatch('click');
  assert.ok(copiedText.includes('diag-smoke-check'));
  assert.equal(msgEl.textContent, 'Kopioitu!');

  sandbox.navigator.clipboard = undefined;
  sandbox.document.execCommand = () => true;
  await copyBtn.dispatch('click');
  assert.equal(msgEl.textContent, 'Kopioitu!');

  sandbox.document.execCommand = () => false;
  await copyBtn.dispatch('click');
  assert.equal(msgEl.textContent, 'Kopiointi epäonnistui');
});

test('17. flagSuspectReps drift guard, drift-only set isolation, 2-of-3 drift, TnG >1.6x merged & UI toggles', async () => {
  const { api, els } = loadApp();
  const { dl1029, dl1124 } = buildDeadliftFixtures();
  api.vbtSettings.goal = 'baseStrength';
  api.workouts = [dl1029, dl1124];

  // 1. Nopea drift-toisto #2 ei liputa kelvollista 1. toistoa suspect:ksi
  const aFastDrift = api.analyzeSet([makeRep(0.36, 42), makeRep(0.74, 85)], 'Maastaveto', 140, { dateStr: '2026-11-24' });
  assert.equal(aFastDrift.perRep[0].suspect, false, 'Valid 1st rep must NOT be flagged suspect by fast 2nd drift rep');
  assert.equal(aFastDrift.perRep[1].drift, true);
  assert.equal(aFastDrift.vBest, 0.36);
  assert.equal(aFastDrift.valid.length, 1);

  // 2. Pelkkä drift-sarja ei saastuta sessionProfile / e1rmTrend / readinessForDate -laskentaa
  api.workouts = [
    {
      date: '2026-11-10',
      sets: [
        { exercise: 'Maastaveto', weightKg: 115, targetReps: 3, reps: [makeRep(0.55, 42), makeRep(0.51, 42)] },
        { exercise: 'Maastaveto', weightKg: 130, targetReps: 3, reps: [makeRep(0.45, 42), makeRep(0.41, 42)] }
      ]
    },
    {
      date: '2026-11-24',
      sets: [
        { exercise: 'Maastaveto', weightKg: 100, targetReps: 3, reps: [makeRep(0.65, 42), makeRep(0.62, 42)] },
        { exercise: 'Maastaveto', weightKg: 115, targetReps: 1, reps: [makeRep(0.85, 114)] }, // pelkkä drift
        { exercise: 'Maastaveto', weightKg: 130, targetReps: 3, reps: [makeRep(0.45, 42), makeRep(0.42, 42)] },
        { exercise: 'Maastaveto', weightKg: 150, targetReps: 1, reps: [makeRep(0.30, 40)] }
      ]
    }
  ];
  const sp = api.sessionProfile('Maastaveto', '2026-11-24');
  assert.equal(sp.points.some((p) => p.load === 115), false, 'sessionProfile must exclude drift-only set');
  const rd = api.readinessForDate('Maastaveto', '2026-11-24');
  assert.ok(rd && rd.weight === 130, `readinessForDate must skip drift-only 115 kg and match 130 kg, got ${rd && rd.weight}`);

  api.workouts = [
    { date: '2026-11-10', sets: [{ exercise: 'Maastaveto', weightKg: 130, targetReps: 3, reps: [makeRep(0.45, 42)] }] },
    { date: '2026-11-24', sets: [{ exercise: 'Maastaveto', weightKg: 115, targetReps: 1, reps: [makeRep(0.85, 114)] }] }
  ];
  const trend = api.e1rmTrend('Maastaveto');
  assert.equal(trend.some((t) => t.date === '2026-11-24'), false, 'e1rmTrend must exclude date with only drift reps');

  // 3. Kaksi drift-toistoa 3 toiston sarjassa tunnistetaan historyMedianRom:n avulla
  api.workouts = [dl1029, dl1124];
  const aTwoDrift = api.analyzeSet(
    [makeRep(0.48, 42), makeRep(0.68, 85), makeRep(0.70, 88)],
    'Maastaveto', 120, { dateStr: '2026-11-24' }
  );
  assert.equal(aTwoDrift.driftCount, 2, 'Two drift reps in 3-rep set must both be detected via historyMedianRom');
  assert.equal(aTwoDrift.valid.length, 1);
  assert.equal(aTwoDrift.vBest, 0.48);

  // 4. Eksplisiittinen touchAndGo: true luokittelee >1.6x ROM:n merged:ksi (ei driftiksi)
  const aTngMerged = api.analyzeSet(
    [makeRep(0.50, 42), makeRep(0.45, 80)],
    'Maastaveto', 120, { dateStr: '2026-11-24', touchAndGo: true }
  );
  assert.equal(aTngMerged.mergedCount, 1);
  assert.equal(aTngMerged.driftCount, 0);
  assert.equal(aTngMerged.perRep[1].merged, true);

  // 5. UI-käsittelijät #tngToggle ja [data-toggle-tng]
  els.get('workoutDate').value = '2026-11-24';
  els.get('exerciseSelect').value = 'Maastaveto';
  els.get('weightInput').value = '120';
  els.get('targetRepsInput').value = '3';
  api.currentReps = [];
  api.currentSetSaved = false;
  api.activeSetMeta = api.snapshotCurrentSetMeta();
  const tngChk = els.get('tngToggle');
  tngChk.checked = true;
  await tngChk.dispatch('change');
  assert.equal(api.activeSetMeta.touchAndGo, true, '#tngToggle change must update activeSetMeta.touchAndGo');
  tngChk.checked = false;
  await tngChk.dispatch('change');
  assert.equal(api.activeSetMeta.touchAndGo, false);

  api.openSetAnalysisSheet('2026-11-24', 2);
  const sheetBody = els.get('setAnalysisSheetBody');
  const sheetTng = sheetBody.querySelector('[data-toggle-tng]');
  assert.ok(sheetTng, 'openSetAnalysisSheet must render [data-toggle-tng] for deadlift');
  sheetTng.checked = true;
  await sheetTng.dispatch('change');
  assert.equal(api.workouts[1].sets[2].touchAndGo, true, '[data-toggle-tng] change must persist touchAndGo on set');
});

test('18. computeDailyPlan safeStopRep with drift rep & readinessForDate 65-83% tier + TnG vs dead-stop', () => {
  const { api } = loadApp();
  const { dl1029 } = buildDeadliftFixtures();
  api.vbtSettings.goal = 'baseStrength';

  // safeStopRep drift-toiston kanssa: 3 valid + 1 drift ennen VL-ylitystä? Ei vaan [valid, valid, drift, valid-over]
  // stopAfterRep = 3 (raw idx), valid.length = 3 -> vanha koodi (3 < 3 epätosi) antoi 1, uusi stopAfterCompleted = 3!
  api.workouts = [
    dl1029,
    {
      date: '2026-11-24',
      sets: [
        { exercise: 'Maastaveto', weightKg: 110, targetReps: 3, reps: [makeRep(0.60, 42), makeRep(0.58, 42), makeRep(0.56, 42)] },
        {
          exercise: 'Maastaveto', weightKg: 130, targetReps: 4,
          reps: [
            makeRep(0.49, 42),
            makeRep(0.45, 42),
            makeRep(0.52, 85), // drift rep #3
            makeRep(0.35, 42)  // valid rep #4, VL = 28.6% > 20% cutoff (stopAfterRep=3, stopAfterCompleted=3)
          ]
        }
      ]
    }
  ];
  const plan = api.computeDailyPlan('Maastaveto', '2026-11-24');
  assert.ok(plan.adjust && plan.adjust.repDropOption, 'computeDailyPlan must suggest repDropOption when VL exceeded');
  assert.equal(plan.adjust.repDropOption.reps, 3, 'safeStopRep must use stopAfterCompleted (3) instead of falling back to 1');

  // readinessForDate suosii 65–83 % (120–130 kg) yli raskaan 150 kg huipun
  api.workouts = [
    {
      date: '2026-11-10',
      sets: [
        { exercise: 'Maastaveto', weightKg: 125, targetReps: 3, reps: [makeRep(0.50, 42), makeRep(0.47, 42)] },
        { exercise: 'Maastaveto', weightKg: 150, targetReps: 1, reps: [makeRep(0.28, 36)] }
      ]
    },
    {
      date: '2026-11-24',
      sets: [
        { exercise: 'Maastaveto', weightKg: 125, targetReps: 3, reps: [makeRep(0.52, 42), makeRep(0.49, 42)] },
        { exercise: 'Maastaveto', weightKg: 150, targetReps: 1, reps: [makeRep(0.26, 36)] }
      ]
    }
  ];
  const rdTier = api.readinessForDate('Maastaveto', '2026-11-24');
  assert.ok(rdTier, 'readinessForDate must find match');
  assert.equal(rdTier.weight, 125, 'readinessForDate must prefer 65-83% tier (125 kg) over fatigued 150 kg peak');

  // TnG vs dead-stop erottelu: pelkkä TnG-historia ei vertaudu dead-stop-sarjaan
  api.workouts = [
    {
      date: '2026-11-10',
      sets: [
        { exercise: 'Maastaveto', weightKg: 125, targetReps: 3, touchAndGo: true, reps: [makeRep(0.50, 42), makeRep(0.49, 42)] }
      ]
    },
    {
      date: '2026-11-24',
      sets: [
        { exercise: 'Maastaveto', weightKg: 125, targetReps: 3, touchAndGo: false, reps: [makeRep(0.52, 42), makeRep(0.49, 42)] }
      ]
    }
  ];
  assert.equal(api.readinessForDate('Maastaveto', '2026-11-24'), null, 'TnG baseline must not match dead-stop today set');
  api.workouts[1].sets[0].touchAndGo = true;
  const rdTngMatch = api.readinessForDate('Maastaveto', '2026-11-24');
  assert.ok(rdTngMatch && rdTngMatch.weight === 125, 'TnG baseline must match TnG today set');
});

test('19. traceExtra override clear, workoutsSignature trace+override, DEFAULT_REF_MAX null, squat/bench redVl & 15 raw traces', () => {
  // 1. DEFAULT_REF_MAX ei ylikirjoita eksplisiittistä null-arvoa
  const appNull = loadApp({
    initialStorage: {
      gpath_vbt_settings_v1: JSON.stringify({ refMax: { deadlift: null, squat: null } })
    }
  });
  assert.equal(appNull.api.vbtSettings.refMax.deadlift, null, 'Explicit null refMax.deadlift must be preserved');
  assert.equal(appNull.api.vbtSettings.refMax.squat, null, 'Explicit null refMax.squat must be preserved');
  assert.deepEqual({ ...appNull.api.vbtSettings.refMax.bench }, { weight: 105, reps: 5 }, 'Missing bench refMax gets default');

  const { api, setNow } = loadApp();
  setNow(1700002000000);

  // 2. traceExtra-varoitus poistuu setRepCountOverride-korjauksella + workoutsSignature muuttuu tracesta & overridesta
  const s = {
    exercise: 'Maastaveto',
    weightKg: 130,
    targetReps: 3,
    reps: [makeRep(0.49, 44, { t: Date.now() - 4000 }), makeRep(0.45, 43, { t: Date.now() - 1000 })]
  };
  api.workouts = [{ date: '2026-11-24', sets: [s] }];
  api.lastSavedSetRef = s;
  api.currentReps = s.reps.map((r) => ({ ...r }));
  api.currentSetSaved = true;

  const sigBeforeTrace = api.workoutsSignature();
  for (const dv of buildSyntheticTracePackets([700, 650, 600], 60)) {
    api.handleTraceNotification(dv);
  }
  const sigAfterTrace = api.workoutsSignature();
  assert.notEqual(sigAfterTrace, sigBeforeTrace, 'workoutsSignature must change when trace attaches');
  assert.equal(api.lastTraceFailed, true);

  const aBeforeOvr = api.analyzeSet(s.reps, s.exercise, s.weightKg, { dateStr: '2026-11-24' });
  assert.ok(api.buildVerdict(aBeforeOvr, s.exercise, { traceMeta: s.traceMeta, count: api.setRepCount(s) }).includes('puuttuvaa'));
  assert.ok(api.buildShortRestFinding(aBeforeOvr, s.exercise, { traceMeta: s.traceMeta, count: api.setRepCount(s) }).text.includes('puuttuvaa'));
  assert.ok(api.buildSetAnalysisHTML(s, { showTraceStatus: true, allowRepDelete: true, dateStr: '2026-11-24' }).includes('puuttuvaa'));

  assert.equal(api.setRepCountOverride('2026-11-24', 0, 3), true);
  const sigAfterOvr = api.workoutsSignature();
  assert.notEqual(sigAfterOvr, sigAfterTrace, 'workoutsSignature must change on repCountOverride');
  assert.equal(api.lastTraceFailed, false, 'setRepCountOverride >= segments must clear lastTraceFailed');
  assert.equal(api.buildVerdict(aBeforeOvr, s.exercise, { traceMeta: s.traceMeta, count: api.setRepCount(s) }).includes('puuttuvaa'), false);
  const findingAfter = api.buildShortRestFinding(aBeforeOvr, s.exercise, { traceMeta: s.traceMeta, count: api.setRepCount(s) });
  assert.ok(!findingAfter || !findingAfter.text.includes('puuttuvaa'), 'buildShortRestFinding must clear traceExtra warning after repCountOverride');
  assert.equal(api.buildSetAnalysisHTML(s, { showTraceStatus: true, allowRepDelete: true, dateStr: '2026-11-24' }).includes('puuttuvaa'), false);

  // 3. Kyykky ja penkki redVl-ankkuroitu VL->RIR
  api.workouts = [];
  api.vbtSettings.goal = 'peaking';
  // Kyykky: redVl = 25, redVl*0.85 = 21.25%. VL = 18% (<21.25%, vaikka > peaking cutoff*1.1=11%) ei leikkaa RIR:ää <= 2
  const sqLowVl = api.analyzeSet([makeRep(0.65, 65), makeRep(0.59, 65), makeRep(0.533, 65)], 'Jalkakyykky', 120, { dateStr: '2026-11-24' });
  assert.ok(sqLowVl.rirEnd > 2, `Squat 18% VL (< 21.25% redVl*0.85) must not clamp RIR to <=2, got ${sqLowVl.rirEnd}`);
  // Kyykky VL = 22% (>= 21.25% ja < 25%) -> RIR = 2
  const sqMidVl = api.analyzeSet([makeRep(0.66, 65), makeRep(0.59, 65), makeRep(0.515, 65)], 'Jalkakyykky', 120, { dateStr: '2026-11-24' });
  assert.equal(sqMidVl.rirEnd, 2, `Squat 22% VL must clamp RIR to 2, got ${sqMidVl.rirEnd}`);
  // Kyykky VL = 26% (>= 25%) -> RIR <= 1
  const sqRedVl = api.analyzeSet([makeRep(0.66, 65), makeRep(0.57, 65), makeRep(0.488, 65)], 'Jalkakyykky', 120, { dateStr: '2026-11-24' });
  assert.ok(sqRedVl.rirEnd <= 1, `Squat 26% VL (>= redVl 25%) must clamp RIR to <=1, got ${sqRedVl.rirEnd}`);

  // Penkki: redVl = 28, redVl*0.85 = 23.8%. VL = 20% (<23.8%, vaikka > maxStrength cutoff*1.1=19.8%) ei leikkaa RIR:ää <= 2
  api.vbtSettings.goal = 'maxStrength';
  const bpLowVl = api.analyzeSet([makeRep(0.55, 29), makeRep(0.495, 29), makeRep(0.44, 29)], 'Penkkipunnerrus', 85, { dateStr: '2026-11-24' });
  assert.ok(bpLowVl.rirEnd > 2, `Bench 20% VL (< 23.8% redVl*0.85) must not clamp RIR to <=2, got ${bpLowVl.rirEnd}`);
  // Penkki VL = 25% (>= 23.8% ja < 28%) -> RIR = 2
  const bpMidVl = api.analyzeSet([makeRep(0.55, 29), makeRep(0.48, 29), makeRep(0.412, 29)], 'Penkkipunnerrus', 85, { dateStr: '2026-11-24' });
  assert.equal(bpMidVl.rirEnd, 2, `Bench 25% VL must clamp RIR to 2, got ${bpMidVl.rirEnd}`);
  // Penkki VL = 30% (>= 28%) -> RIR <= 1
  const bpRedVl = api.analyzeSet([makeRep(0.55, 29), makeRep(0.47, 29), makeRep(0.385, 29)], 'Penkkipunnerrus', 85, { dateStr: '2026-11-24' });
  assert.ok(bpRedVl.rirEnd <= 1, `Bench 30% VL (>= redVl 28%) must clamp RIR to <=1, got ${bpRedVl.rirEnd}`);

  // 4. recentRawTraces säilyttää >5 (15) sarjaa
  api.recentRawTraces.length = 0;
  const tracePkts = buildSyntheticTracePackets([700, 650], 60);
  for (let i = 0; i < 15; i++) {
    for (const dv of tracePkts) api.handleTraceNotification(dv);
  }
  assert.equal(api.recentRawTraces.length, 15, 'recentRawTraces must retain 15 sets (not cap at 5)');
  for (const dv of tracePkts) api.handleTraceNotification(dv);
  assert.equal(api.recentRawTraces.length, 15, 'recentRawTraces must cap at 15 sets');
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
