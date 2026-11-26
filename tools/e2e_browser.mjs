#!/usr/bin/env node
// Standalone, zero-dependency headless Chrome + CDP E2E browser test for Gpath Pin VBT client.
// Run: node tools/e2e_browser.mjs
// Optional env:
//   E2E_SCREENSHOT_DIR=<dir>  Directory to store PNG screenshots (outside repo)
//   CHROME_PATH=<path>        Explicit path to Chrome/Edge binary

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR
  ? path.resolve(process.env.E2E_SCREENSHOT_DIR)
  : path.join(os.tmpdir(), `gpath-e2e-screenshots-${Date.now()}`);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`No Chrome/Edge binary found. Checked:\n${candidates.join('\n')}`);
}

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
        const abs = path.resolve(rootDir, rel);
        if (!abs.startsWith(rootDir)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(abs).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
        fs.createReadStream(abs).pipe(res);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function launchChrome(chromePath, userDataDir) {
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--window-size=430,932',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ];
  const proc = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsBrowserUrl = await new Promise((resolve, reject) => {
    let stderrBuf = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for Chrome DevTools URL. stderr:\n${stderrBuf}`));
    }, 15000);
    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf8');
      const m = stderrBuf.match(/DevTools listening on (ws:\/\/[^\s\r\n]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited prematurely (${code}). stderr:\n${stderrBuf}`));
    });
  });

  const u = new URL(wsBrowserUrl);
  const targetsRes = await fetch(`http://${u.host}/json/list`);
  const targets = await targetsRes.json();
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    throw new Error(`No page target found in /json/list: ${JSON.stringify(targets)}`);
  }
  return { proc, pageWsUrl: pageTarget.webSocketDebuggerUrl };
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', (e) => reject(new Error(`CDP WebSocket error: ${e.message || e}`)), { once: true });
    });
    this.ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(`CDP ${p.method}: ${msg.error.message} (${msg.error.code})`));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        const arr = this.listeners.get(msg.method) || [];
        for (const fn of arr) fn(msg.params);
      }
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = true) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Runtime exception';
      throw new Error(`Page eval failed: ${desc}`);
    }
    return res.result ? res.result.value : undefined;
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeoutMs = 8000, intervalMs = 25, desc = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const val = await fn();
      if (val) return val;
    } catch (e) {
      lastErr = e;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${desc}${lastErr ? `: ${lastErr.message}` : ''}`);
}

function buildInjectedMockScript() {
  return `(() => {
    const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
    const CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b2688';

    const confirms = [];
    const alerts = [];
    const pageErrors = [];
    const consoleErrors = [];
    const writtenBytes = [];
    const charListeners = new Map();
    const devListeners = new Map();

    window.confirm = (msg) => { confirms.push(String(msg)); return true; };
    window.alert = (msg) => { alerts.push(String(msg)); };
    window.addEventListener('error', (e) => { pageErrors.push(e.message || String(e.error || e)); });
    window.addEventListener('unhandledrejection', (e) => { pageErrors.push(String(e.reason)); });

    let autoReply83 = true;
    let reply83DelayMs = 40;
    let paired = false;

    function fireDevice(type, evt = {}) {
      const list = (devListeners.get(type) || []).slice();
      for (const fn of list) fn({ target: mockDevice, ...evt });
    }

    function emitBytes(bytes) {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      const list = (charListeners.get('characteristicvaluechanged') || []).slice();
      for (const fn of list) {
        fn({ target: { value: dv } });
      }
    }

    function emitFloatPacket(type, floatVal) {
      const buf = new ArrayBuffer(5);
      const dv = new DataView(buf);
      dv.setUint8(0, type);
      dv.setFloat32(1, floatVal, true);
      emitBytes(new Uint8Array(buf));
    }

    const mockChar = {
      uuid: CHAR_UUID,
      async startNotifications() {},
      addEventListener(type, fn) {
        if (!charListeners.has(type)) charListeners.set(type, []);
        if (!charListeners.get(type).includes(fn)) charListeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = charListeners.get(type);
        if (arr) charListeners.set(type, arr.filter((f) => f !== fn));
      },
      async writeValue(arr) {
        const u8 = arr instanceof Uint8Array ? arr : new Uint8Array(arr.buffer || arr);
        const b = u8[0];
        writtenBytes.push(b);
        if (b === 0x06) {
          setTimeout(() => emitBytes([0x86]), 5);
        } else if (b === 0x01) {
          setTimeout(() => emitFloatPacket(0x81, 84.5), 5);
        } else if (b === 0x03 && autoReply83) {
          setTimeout(() => emitBytes([0x83]), reply83DelayMs);
        } else if (b === 0x04) {
          setTimeout(() => emitBytes([0x84]), 5);
        } else if (b === 0x05) {
          setTimeout(() => emitBytes([0x85]), 5);
        }
      },
      async writeValueWithResponse(arr) {
        return this.writeValue(arr);
      }
    };

    const mockService = {
      uuid: SERVICE_UUID,
      async getCharacteristic(uuid) {
        if (String(uuid).toLowerCase() !== CHAR_UUID) throw new Error('Unknown characteristic: ' + uuid);
        return mockChar;
      }
    };

    const mockServer = {
      connected: false,
      async connect() {
        this.connected = true;
        return this;
      },
      disconnect() {
        if (this.connected) {
          this.connected = false;
          fireDevice('gattserverdisconnected');
        }
      },
      async getPrimaryService(uuid) {
        if (String(uuid).toLowerCase() !== SERVICE_UUID) throw new Error('Unknown service: ' + uuid);
        return mockService;
      }
    };

    const mockDevice = {
      id: 'gpath-mock-1',
      name: 'GPATH_Sensor',
      gatt: mockServer,
      addEventListener(type, fn) {
        if (!devListeners.has(type)) devListeners.set(type, []);
        if (!devListeners.get(type).includes(fn)) devListeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = devListeners.get(type);
        if (arr) devListeners.set(type, arr.filter((f) => f !== fn));
      }
    };

    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        async requestDevice() {
          paired = true;
          return mockDevice;
        },
        async getDevices() {
          return paired ? [mockDevice] : [];
        }
      }
    });

    function buildTracePackets(segments, opts = {}) {
      const quietStart = opts.quietStart ?? 30;
      const quietEnd = opts.quietEnd ?? 30;
      const defaultBetween = opts.samplesBetween ?? 50;
      const samples = [];
      const pushQuiet = (n) => {
        for (let i = 0; i < n; i++) samples.push([12500, 0, 0, 0, 0, 0, 2048, 0, 0]);
      };
      const pushConc = (n, peakMmS) => {
        const durSec = n * 0.0125;
        for (let i = 0; i < n; i++) {
          const ph = ((i + 0.5) / n) * Math.PI;
          const v = Math.round(Math.sin(ph) * peakMmS);
          const a = Math.round(Math.cos(ph) * peakMmS * Math.PI / durSec);
          samples.push([12500, 0, 0, 0, 0, 0, 2048, a, v]);
        }
      };
      const pushEcc = (n, peakMmS) => {
        for (let i = 0; i < n; i++) {
          const ph = ((i + 0.5) / n) * Math.PI;
          const v = -Math.round(Math.sin(ph) * peakMmS);
          samples.push([12500, 0, 0, 0, 0, 0, 2048, 0, v]);
        }
      };

      pushQuiet(quietStart);
      segments.forEach((seg, idx) => {
        if (idx > 0) pushQuiet(seg.quietBefore ?? defaultBetween);
        const concN = seg.concSamples ?? 64;
        // ROM_cm = 0.79577 * concN * (peakMmS / 1000) -> peakMmS = romCm / (0.00079577 * concN)
        // MV_m_s  = 0.63662 * (peakMmS / 1000)
        let peakMmS = seg.peakMmS;
        if (!peakMmS && seg.mv) {
          peakMmS = Math.round((seg.mv / 0.63661977) * 1000);
        }
        pushConc(concN, peakMmS || 785);
        if ((seg.eccSamples ?? 40) > 0) {
          pushEcc(seg.eccSamples ?? 40, seg.eccPeakMmS ?? 450);
        }
      });
      pushQuiet(quietEnd);
      if (samples.length < 180) pushQuiet(180 - samples.length);

      const pkts = [];
      const b1 = new ArrayBuffer(15);
      const b1dv = new DataView(b1);
      b1dv.setUint8(0, 0xb1);
      b1dv.setUint32(1, 0, true);
      b1dv.setUint32(5, Math.round((samples.length / 80) * 1000), true);
      b1dv.setUint16(9, opts.headerReps ?? segments.length, true);
      b1dv.setUint32(11, samples.length, true);
      pkts.push(new Uint8Array(b1));

      const perPkt = 23;
      const totalPkts = Math.ceil(samples.length / perPkt);
      for (let p = 0; p < totalPktCount(samples.length, perPkt); p++) {
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
        pkts.push(new Uint8Array(buf));
      }
      const b3 = new Uint8Array([0xb3]);
      pkts.push(b3);
      return pkts;
    }
    function totalPktCount(len, perPkt) { return Math.ceil(len / perPkt); }

    window.__mockPin = {
      setAutoReply83(v, delayMs = 40) { autoReply83 = !!v; reply83DelayMs = delayMs; },
      emit81(pct = 84.5) { emitFloatPacket(0x81, pct); },
      emit83() { emitBytes([0x83]); },
      emitPhase(phase) { emitBytes([0x01, phase]); },
      emitMetric(type, val) { emitFloatPacket(type, val); },
      async emitRep({ mv, mpv, propAcc = 1.4, romCm = 41.0, ecc = 0.40, drop02 = false, drop06 = false, stepDelayMs = 20 }) {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        emitBytes([0x01, 0x01]);
        await sleep(stepDelayMs);
        if (mpv !== null && mpv !== undefined) emitFloatPacket(0x03, mpv * 1000);
        if (romCm !== null && romCm !== undefined) emitFloatPacket(0x05, romCm * 10);
        if (propAcc !== null && propAcc !== undefined) emitFloatPacket(0x04, propAcc * 1000);
        if (!drop02 && mv !== null && mv !== undefined) emitFloatPacket(0x02, mv * 1000);
        await sleep(stepDelayMs);
        if (!drop06 && ecc !== null && ecc !== undefined) {
          emitFloatPacket(0x06, ecc * 1000);
          await sleep(10);
        }
        emitBytes([0x01, 0x03]);
        await sleep(15);
      },
      emitTrace(segments, opts = {}) {
        const pkts = buildTracePackets(segments, opts);
        for (const p of pkts) emitBytes(p);
      },
      getWrittenBytes() { return writtenBytes.slice(); },
      clearWrittenBytes() { writtenBytes.length = 0; },
      getDevice() { return mockDevice; },
      getLogs() { return { confirms: confirms.slice(), alerts: alerts.slice(), pageErrors: pageErrors.slice(), consoleErrors: consoleErrors.slice() }; },
      clearLogs() { confirms.length = 0; alerts.length = 0; }
    };
  })();`;
}

async function run() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const tmpProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpath-e2e-'));
  const chromePath = findChromeBinary();
  const { server, baseUrl } = await startStaticServer(REPO_ROOT);

  let chromeProc = null;
  let cdp = null;
  const runtimeErrors = [];
  const consoleErrors = [];
  const screenshots = [];

  try {
    const launched = await launchChrome(chromePath, tmpProfileDir);
    chromeProc = launched.proc;
    cdp = new CDPClient(launched.pageWsUrl);

    cdp.on('Runtime.exceptionThrown', (params) => {
      const desc = params?.exceptionDetails?.exception?.description || params?.exceptionDetails?.text || JSON.stringify(params);
      runtimeErrors.push(desc);
    });
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        const txt = (params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        consoleErrors.push(txt);
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430,
      height: 932,
      deviceScaleFactor: 2,
      mobile: true
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: buildInjectedMockScript()
    });

    const loaded = new Promise((resolve) => {
      cdp.on('Page.loadEventFired', resolve);
    });
    await cdp.send('Page.navigate', { url: `${baseUrl}/index.html` });
    await loaded;
    await cdp.eval(`(() => { localStorage.clear(); location.reload(); })()`, false);
    await waitFor(() => cdp.eval(`Boolean(document.getElementById('mainSetActionBtn') && window.__mockPin)`), { desc: 'clean app load' });

    const captureScreenshot = async (filename, description) => {
      await sleep(120);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const outPath = path.join(SCREENSHOT_DIR, filename);
      fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
      screenshots.push({ path: outPath, description });
      console.log(`SCREENSHOT ${outPath} | ${description}`);
    };

    const clickEl = async (selector) => {
      const ok = await cdp.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        el.click();
        return true;
      })()`);
      assert.equal(ok, true, `Element not found for click: ${selector}`);
    };

    const setInputValue = async (selector, val) => {
      const ok = await cdp.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.value = ${JSON.stringify(String(val))};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      assert.equal(ok, true, `Input not found: ${selector}`);
    };

    const getState = () => cdp.eval(`(() => {
      const mainBtn = document.getElementById('mainSetActionBtn');
      const tabLift = document.getElementById('tabLift');
      const statusText = document.getElementById('statusText');
      const toast = document.getElementById('pinNoticeToast');
      const toastText = document.getElementById('pinNoticeToastText');
      const liveWarn = document.getElementById('liveTraceWarn');
      return {
        tabState: tabLift ? tabLift.getAttribute('data-state') : null,
        mainBtnText: mainBtn ? mainBtn.textContent.trim() : '',
        mainBtnBg: mainBtn ? getComputedStyle(mainBtn).backgroundColor : '',
        statusText: statusText ? statusText.textContent.trim() : '',
        toastVisible: toast ? !toast.classList.contains('hidden') : false,
        toastText: toastText ? toastText.textContent.trim() : '',
        liveTraceWarnHidden: liveWarn ? liveWarn.classList.contains('hidden') : true,
        liveTraceWarnText: liveWarn ? liveWarn.textContent.trim() : '',
        written: window.__mockPin.getWrittenBytes()
      };
    })()`);

    // Helper: compute concSamples & peakMmS for a desired (romCm, mv)
    // analyzeTrace trims each half-sine segment at th = 0.1 * vPeak (~arcsin(0.1) .. pi - arcsin(0.1)),
    // where trimmed mean velocity is ~0.6766 * vPeak and trimmed displacement is ~0.990 * integral.
    const traceSeg = (mv, romCm = 40.5) => {
      const concSamples = Math.max(16, Math.round((romCm / 100) / (mv * 0.0125) * 1.07));
      const peakMmS = Math.round((mv / 0.6766) * 1000);
      return { concSamples, peakMmS, eccSamples: 36, eccPeakMmS: 420 };
    };

    const waitForSetActive = (desc) => waitFor(async () => {
      const st = await getState();
      return st.tabState === 'active' && st.mainBtnText === '⏹ LOPETA SARJA';
    }, { desc });

    // 1. Connect GPATH_Sensor & verify green start button
    await setInputValue('#exerciseSelect', 'Maastaveto');
    await setInputValue('#weightInput', '100');
    await setInputValue('#targetRepsInput', '3');
    await clickEl('#connectBtn');
    await waitFor(async () => {
      const st = await getState();
      return st.mainBtnText === '▶ ALOITA SARJA #1';
    }, { desc: 'connected and calibrated (#1 ready)' });

    const s1Ready = await getState();
    assert.equal(s1Ready.mainBtnText, '▶ ALOITA SARJA #1');
    assert.equal(s1Ready.mainBtnBg, 'rgb(34, 197, 94)', 'Start button must be green rgb(34, 197, 94)');
    await captureScreenshot('ready-green-start.png', 'Green Aloita sarja #1 ready state');
    console.log('PASS Step 1: Connect GPATH_Sensor & green start button');

    // 2. Set #1 (100 kg x 3): instant 0s start (no 0x04), drift Reps 1 & 2, valid Rep 3, no 0x04 on stop, 80 Hz trace
    await cdp.eval(`window.__mockPin.clearWrittenBytes()`);
    await clickEl('#mainSetActionBtn');
    await waitForSetActive('Set #1 instant active');
    const s1StartWritten = await cdp.eval(`window.__mockPin.getWrittenBytes()`);
    assert.equal(s1StartWritten.includes(0x04), false, 'Set #1 instant start must NOT send 0x04');
    assert.equal(s1StartWritten.includes(0x03), false, 'Set #1 instant start must NOT send 0x03');

    await cdp.eval(`(async () => {
      await window.__mockPin.emitRep({ mv: 0.668, mpv: 0.680, propAcc: 2.1, romCm: 205.0, ecc: 0.45 });
      await window.__mockPin.emitRep({ mv: 0.318, mpv: 0.330, propAcc: 0.9, romCm: 61.9, ecc: 0.35 });
      await window.__mockPin.emitRep({ mv: 0.635, mpv: 0.650, propAcc: 1.9, romCm: 38.1, ecc: 0.42 });
    })()`);
    await sleep(40);
    if ((await getState()).tabState === 'active') {
      await clickEl('#mainSetActionBtn');
    }
    await waitFor(async () => (await getState()).tabState === 'rest', { desc: 'Set #1 rest state' });
    const s1StopWritten = await cdp.eval(`window.__mockPin.getWrittenBytes()`);
    assert.equal(s1StopWritten.includes(0x04), false, 'stopSetOnPin must NEVER send 0x04');

    await cdp.eval(`window.__mockPin.emitTrace([
      ${JSON.stringify(traceSeg(0.668, 42.0))},
      ${JSON.stringify(traceSeg(0.318, 41.0))},
      ${JSON.stringify(traceSeg(0.635, 38.1))}
    ])`);
    await sleep(60);

    // Verify Rep 1 & Rep 2 flagged IMU-ajautuma and Rep 3 valid in Rest Analysis sheet
    await clickEl('#restAnalyzeBtn');
    await waitFor(() => cdp.eval(`!document.getElementById('setAnalysisSheet').classList.contains('hidden')`), { desc: 'Set #1 analysis sheet' });
    const set1Sheet = await cdp.eval(`document.getElementById('setAnalysisSheetBody').innerText`);
    assert.ok(set1Sheet.includes('Toisto #1: anturin IMU-ajautuma'), `Set #1 Rep 1 must be flagged IMU-ajautuma:\n${set1Sheet}`);
    assert.ok(set1Sheet.includes('Toisto #2: anturin IMU-ajautuma'), `Set #1 Rep 2 must be flagged IMU-ajautuma:\n${set1Sheet}`);
    assert.ok(!set1Sheet.includes('Toisto #3: anturin IMU-ajautuma'), 'Set #1 Rep 3 must NOT be flagged IMU-ajautuma');
    assert.ok(set1Sheet.includes('0.64 m/s') && set1Sheet.includes('38 cm') && set1Sheet.includes('paras'), 'Set #1 Rep 3 must remain valid');
    await clickEl('#closeSetAnalysisSheetBtn');
    console.log('PASS Step 2: Set #1 instant start, no 0x04 on stop, 2 drift reps + 1 valid');

    // 3. Set #2 (115 kg x 3): auto-rezero [0x04, 0x03] -> 0x83, drift rep + 2 normal + 80 Hz trace
    await setInputValue('#weightInput', '115');
    await cdp.eval(`window.__mockPin.clearWrittenBytes()`);
    await clickEl('#mainSetActionBtn');
    await waitForSetActive('Set #2 active after auto-rezero');
    const s2Written = await cdp.eval(`window.__mockPin.getWrittenBytes()`);
    assert.ok(
      s2Written.indexOf(0x04) !== -1 && s2Written.indexOf(0x03) > s2Written.indexOf(0x04),
      `Set #2 must auto-rezero [0x04, 0x03], got ${JSON.stringify(s2Written)}`
    );
    await cdp.eval(`(async () => {
      await window.__mockPin.emitRep({ mv: 0.740, mpv: 0.750, propAcc: 2.2, romCm: 92.0, ecc: 0.44 });
      await window.__mockPin.emitRep({ mv: 0.560, mpv: 0.575, propAcc: 1.5, romCm: 41.0, ecc: 0.40 });
      await window.__mockPin.emitRep({ mv: 0.520, mpv: 0.535, propAcc: 1.3, romCm: 40.5, ecc: 0.38 });
    })()`);
    await sleep(40);
    if ((await getState()).tabState === 'active') await clickEl('#mainSetActionBtn');
    await waitFor(async () => (await getState()).tabState === 'rest', { desc: 'Set #2 rest' });
    await cdp.eval(`window.__mockPin.emitTrace([
      ${JSON.stringify(traceSeg(0.740, 42.0))},
      ${JSON.stringify(traceSeg(0.560, 41.0))},
      ${JSON.stringify(traceSeg(0.520, 40.5))}
    ])`);
    await sleep(50);
    console.log('PASS Step 3: Set #2 auto-rezero [0x04, 0x03] -> 0x83 + drift + 2 normal');

    // 4. Set #3 (120 kg x 3): idle plate loading -> dropped-inactive, manual #rezeroBtn, NO double re-zero
    await setInputValue('#weightInput', '120');
    await cdp.eval(`(() => {
      window.__mockPin.emitPhase(0x01);
      window.__mockPin.emitMetric(0x03, 510);
      window.__mockPin.emitMetric(0x05, 400);
      window.__mockPin.emitMetric(0x04, 1200);
      window.__mockPin.emitMetric(0x02, 500);
    })()`);
    await sleep(40);
    await cdp.eval(`window.__mockPin.clearWrittenBytes()`);
    await clickEl('#rezeroBtn');
    await waitFor(async () => cdp.eval(`(() => {
      const rz = document.getElementById('rezeroStatusText')?.textContent || '';
      const btn = document.getElementById('mainSetActionBtn')?.textContent.trim() || '';
      return rz.includes('Anturi nollattu') && btn.startsWith('▶ ALOITA SARJA');
    })()`), { desc: 'Set #3 manual rezero completion' });
    const s3RezeroWritten = await cdp.eval(`window.__mockPin.getWrittenBytes()`);
    assert.ok(
      s3RezeroWritten.indexOf(0x04) !== -1 && s3RezeroWritten.indexOf(0x03) > s3RezeroWritten.indexOf(0x04),
      `Manual #rezeroBtn must send [0x04, 0x03], got ${JSON.stringify(s3RezeroWritten)}`
    );

    await cdp.eval(`window.__mockPin.clearWrittenBytes()`);
    await clickEl('#mainSetActionBtn');
    await waitForSetActive('Set #3 instant active (no double rezero)');
    const s3StartWritten = await cdp.eval(`window.__mockPin.getWrittenBytes()`);
    assert.equal(s3StartWritten.includes(0x04), false, 'Set #3 after manual rezero must NOT double re-zero (no 0x04)');
    assert.equal(s3StartWritten.includes(0x03), false, 'Set #3 after manual rezero must NOT double re-zero (no 0x03)');

    await cdp.eval(`(async () => {
      await window.__mockPin.emitRep({ mv: 0.520, mpv: 0.535, propAcc: 1.4, romCm: 41.0, ecc: 0.38 });
      await window.__mockPin.emitRep({ mv: 0.490, mpv: 0.505, propAcc: 1.3, romCm: 40.5, ecc: 0.37 });
      await window.__mockPin.emitRep({ mv: 0.460, mpv: 0.475, propAcc: 1.2, romCm: 40.0, ecc: 0.36 });
    })()`);
    await sleep(40);
    if ((await getState()).tabState === 'active') await clickEl('#mainSetActionBtn');
    await waitFor(async () => (await getState()).tabState === 'rest', { desc: 'Set #3 rest' });
    await cdp.eval(`window.__mockPin.emitTrace([
      ${JSON.stringify(traceSeg(0.520, 41.0))},
      ${JSON.stringify(traceSeg(0.490, 40.5))},
      ${JSON.stringify(traceSeg(0.460, 40.0))}
    ])`);
    await sleep(50);
    console.log('PASS Step 4: Set #3 idle dropped-inactive, #rezeroBtn, NO double re-zero');

    // 5. Set #4 (130 kg x 3): auto-rezero, Rep 2 drops 0x02 and triggers fallback02 on 0x06 (with loweringVelocity), 80 Hz trace refines Rep 2
    await setInputValue('#weightInput', '130');
    await cdp.eval(`window.__mockPin.clearWrittenBytes()`);
    await clickEl('#mainSetActionBtn');
    await waitForSetActive('Set #4 active');
    const s4Written = await cdp.eval(`window.__mockPin.getWrittenBytes()`);
    assert.ok(s4Written.includes(0x04) && s4Written.includes(0x03), 'Set #4 must auto-rezero');

    await cdp.eval(`(async () => {
      await window.__mockPin.emitRep({ mv: 0.480, mpv: 0.495, propAcc: 1.3, romCm: 41.0, ecc: 0.38 });
      await window.__mockPin.emitRep({ mv: 0.455, mpv: 0.465, propAcc: 1.15, romCm: 40.5, ecc: 0.36, drop02: true });
      await window.__mockPin.emitRep({ mv: 0.420, mpv: 0.435, propAcc: 1.05, romCm: 40.0, ecc: 0.35 });
    })()`);
    await sleep(40);
    if ((await getState()).tabState === 'active') await clickEl('#mainSetActionBtn');
    await waitFor(async () => (await getState()).tabState === 'rest', { desc: 'Set #4 rest' });

    const s4BeforeTrace = await cdp.eval(`(() => {
      const w = JSON.parse(localStorage.getItem('gpath_workouts_v1') || '[]')[0];
      const s = w.sets[3];
      return { len: s.reps.length, rep2: s.reps[1] };
    })()`);
    assert.equal(s4BeforeTrace.len, 3, 'Set #4 must have 3 reps via 0x06 fallback');
    assert.equal(s4BeforeTrace.rep2.fallback02, true, 'Set #4 Rep 2 must have fallback02: true before trace');
    assert.ok(Math.abs(s4BeforeTrace.rep2.loweringVelocity - 0.36) < 0.01, 'Set #4 Rep 2 must keep loweringVelocity');

    await cdp.eval(`window.__mockPin.emitTrace([
      ${JSON.stringify(traceSeg(0.480, 41.0))},
      ${JSON.stringify(traceSeg(0.452, 41.2))},
      ${JSON.stringify(traceSeg(0.420, 40.0))}
    ])`);
    await sleep(50);
    const s4AfterTrace = await cdp.eval(`(() => {
      const w = JSON.parse(localStorage.getItem('gpath_workouts_v1') || '[]')[0];
      return w.sets[3].reps[1];
    })()`);
    assert.equal(s4AfterTrace.refinedFromTrace, true, 'Set #4 Rep 2 must be refinedFromTrace');
    assert.equal(s4AfterTrace.fallback02, undefined, 'Set #4 Rep 2 fallback02 must be cleared after trace refinement');
    console.log('PASS Step 5: Set #4 fallback02 on 0x06 + 80 Hz refinement');

    // 6. Set #5 (145 kg x 3): auto-rezero, Rep 2 missed live (only Reps 1 & 3 live), stop set, 4-segment trace (3 real ~40 cm + 1 ~16 cm bounce)
    await setInputValue('#weightInput', '145');
    await clickEl('#mainSetActionBtn');
    await waitForSetActive('Set #5 active');
    await cdp.eval(`(async () => {
      await window.__mockPin.emitRep({ mv: 0.390, mpv: 0.405, propAcc: 1.0, romCm: 40.0, ecc: 0.34 });
      await new Promise((r) => setTimeout(r, 40));
      await window.__mockPin.emitRep({ mv: 0.340, mpv: 0.355, propAcc: 0.85, romCm: 39.5, ecc: 0.32 });
    })()`);
    await sleep(30);
    await clickEl('#mainSetActionBtn'); // stop set (only 2 reps live)
    await waitFor(async () => (await getState()).tabState === 'rest', { desc: 'Set #5 rest' });

    const bounceSeg = { concSamples: 28, peakMmS: 720, eccSamples: 16, eccPeakMmS: 300 }; // ~16 cm bounce
    await cdp.eval(`window.__mockPin.emitTrace([
      ${JSON.stringify(traceSeg(0.390, 40.0))},
      ${JSON.stringify(traceSeg(0.365, 40.2))},
      ${JSON.stringify(traceSeg(0.340, 39.5))},
      ${JSON.stringify(bounceSeg)}
    ])`);
    await sleep(60);
    const s5State = await getState();
    assert.equal(s5State.liveTraceWarnHidden, true, 'Set #5 lastTraceFailed warning must stay hidden after bounce-filtered recovery');
    const s5Set = await cdp.eval(`(() => {
      const w = JSON.parse(localStorage.getItem('gpath_workouts_v1') || '[]')[0];
      return w.sets[4];
    })()`);
    assert.equal(s5Set.reps.length, 3, 'Set #5 must recover to exactly 3 reps (4th bounce rejected)');
    assert.equal(s5Set.reps[1].recoveredFromTrace, true, 'Set #5 Rep #2 must have recoveredFromTrace: true');
    console.log('PASS Step 6: Set #5 Rep 2 recovered, 16 cm bounce rejected, warning hidden');

    // 7. Set #6 (150 kg x 3): auto-rezero, Rep 3 missed live, recovered from 3-segment 80 Hz trace
    await setInputValue('#weightInput', '150');
    await clickEl('#mainSetActionBtn');
    await waitForSetActive('Set #6 active');
    await cdp.eval(`(async () => {
      await window.__mockPin.emitRep({ mv: 0.350, mpv: 0.365, propAcc: 0.9, romCm: 39.5, ecc: 0.32 });
      await window.__mockPin.emitRep({ mv: 0.320, mpv: 0.335, propAcc: 0.8, romCm: 39.0, ecc: 0.30 });
    })()`);
    await sleep(30);
    await clickEl('#mainSetActionBtn');
    await waitFor(async () => (await getState()).tabState === 'rest', { desc: 'Set #6 rest' });
    await cdp.eval(`window.__mockPin.emitTrace([
      ${JSON.stringify(traceSeg(0.350, 39.5))},
      ${JSON.stringify(traceSeg(0.320, 39.0))},
      ${JSON.stringify(traceSeg(0.295, 38.8))}
    ])`);
    await sleep(50);
    const s6Set = await cdp.eval(`(() => JSON.parse(localStorage.getItem('gpath_workouts_v1') || '[]')[0].sets[5])()`);
    assert.equal(s6Set.reps.length, 3, 'Set #6 must recover Rep 3 to 3 reps');
    assert.equal(s6Set.reps[2].recoveredFromTrace, true, 'Set #6 Rep #3 must be recoveredFromTrace');
    console.log('PASS Step 7: Set #6 Rep 3 recovered from 80 Hz trace');

    // 8. Set #7 (140 kg x 3): auto-rezero, Rep 3 drops 0x02 & 0x06, committed by stopSetOnPin() fallback, refined by 80 Hz trace
    await setInputValue('#weightInput', '140');
    await clickEl('#mainSetActionBtn');
    await waitForSetActive('Set #7 active');
    await cdp.eval(`(async () => {
      await window.__mockPin.emitRep({ mv: 0.410, mpv: 0.425, propAcc: 1.1, romCm: 40.5, ecc: 0.36 });
      await window.__mockPin.emitRep({ mv: 0.380, mpv: 0.395, propAcc: 1.0, romCm: 40.0, ecc: 0.34 });
      await window.__mockPin.emitRep({ mv: 0.355, mpv: 0.365, propAcc: 0.92, romCm: 39.8, drop02: true, drop06: true });
    })()`);
    await sleep(20);
    await clickEl('#mainSetActionBtn'); // stopSetOnPin() commits Rep 3 fallback
    await waitFor(async () => (await getState()).tabState === 'rest', { desc: 'Set #7 rest' });
    const s7Before = await cdp.eval(`(() => JSON.parse(localStorage.getItem('gpath_workouts_v1') || '[]')[0].sets[6])()`);
    assert.equal(s7Before.reps.length, 3, 'Set #7 stopSetOnPin fallback must commit Rep 3');
    assert.equal(s7Before.reps[2].fallback02, true, 'Set #7 Rep 3 must be fallback02 before trace');
    await cdp.eval(`window.__mockPin.emitTrace([
      ${JSON.stringify(traceSeg(0.410, 40.5))},
      ${JSON.stringify(traceSeg(0.380, 40.0))},
      ${JSON.stringify(traceSeg(0.352, 40.1))}
    ])`);
    await sleep(50);
    const s7After = await cdp.eval(`(() => JSON.parse(localStorage.getItem('gpath_workouts_v1') || '[]')[0].sets[6])()`);
    assert.equal(s7After.reps[2].refinedFromTrace, true, 'Set #7 Rep 3 must be refinedFromTrace');
    console.log('PASS Step 8: Set #7 Rep 3 stopSetOnPin fallback + 80 Hz refinement');

    // 9. Set #8 (130 kg x 3): auto-rezero, Rep 1 missed live, recovered at index 0 from 3-segment 80 Hz trace
    await setInputValue('#weightInput', '130');
    await clickEl('#mainSetActionBtn');
    await waitForSetActive('Set #8 active');
    await cdp.eval(`(async () => {
      await new Promise((r) => setTimeout(r, 40));
      await window.__mockPin.emitRep({ mv: 0.450, mpv: 0.465, propAcc: 1.2, romCm: 40.5, ecc: 0.36 });
      await window.__mockPin.emitRep({ mv: 0.420, mpv: 0.435, propAcc: 1.1, romCm: 40.0, ecc: 0.35 });
    })()`);
    await sleep(30);
    await clickEl('#mainSetActionBtn');
    await waitFor(async () => (await getState()).tabState === 'rest', { desc: 'Set #8 rest' });
    await cdp.eval(`window.__mockPin.emitTrace([
      ${JSON.stringify(traceSeg(0.485, 41.0))},
      ${JSON.stringify(traceSeg(0.450, 40.5))},
      ${JSON.stringify(traceSeg(0.420, 40.0))}
    ])`);
    await sleep(50);
    const s8Set = await cdp.eval(`(() => JSON.parse(localStorage.getItem('gpath_workouts_v1') || '[]')[0].sets[7])()`);
    assert.equal(s8Set.reps.length, 3, 'Set #8 must recover Rep 1 to 3 reps');
    assert.equal(s8Set.reps[0].recoveredFromTrace, true, 'Set #8 Rep #1 must be recovered at index 0');
    assert.ok(s8Set.reps[0].meanVelocity > 0.46, 'Set #8 Rep #1 recovered velocity should be ~0.485');
    console.log('PASS Step 9: Set #8 Rep 1 recovered at index 0 from 80 Hz trace');

    // 10. Finish workout -> [0x04, 0x05] + disconnect, status & toast text, Analyysi > Sessio 8 sets / 24 reps
    await cdp.eval(`window.__mockPin.clearWrittenBytes()`);
    await clickEl('#finishWorkoutBtn');
    await waitFor(() => cdp.eval(`!document.getElementById('tabAnalysis').classList.contains('hidden')`), { desc: 'Analyysi tab open after finishWorkout' });
    const afterFinish = await cdp.eval(`(() => {
      const st = document.getElementById('statusText')?.textContent.trim() || '';
      const toastEl = document.getElementById('pinNoticeToast');
      const toastTxt = document.getElementById('pinNoticeToastText')?.textContent.trim() || '';
      const sessHtml = document.getElementById('anaSessionCard')?.innerHTML || '';
      const sessTxt = document.getElementById('anaSessionCard')?.innerText || '';
      const rows = document.querySelectorAll('#anaSessionCard .ana-set-row').length;
      return {
        written: window.__mockPin.getWrittenBytes(),
        connected: window.__mockPin.getDevice().gatt.connected,
        statusText: st,
        toastVisible: toastEl ? !toastEl.classList.contains('hidden') : false,
        toastText: toastTxt,
        rows,
        sessHtml,
        sessTxt
      };
    })()`);
    assert.ok(
      afterFinish.written.includes(0x04) && afterFinish.written.includes(0x05) &&
      afterFinish.written.indexOf(0x05) > afterFinish.written.indexOf(0x04),
      `finishWorkout must send [0x04, 0x05], got ${JSON.stringify(afterFinish.written)}`
    );
    assert.equal(afterFinish.connected, false, 'GATT must be disconnected after finishWorkout');
    assert.equal(afterFinish.statusText, 'Yhteys Gpath Pin -anturiin on katkaistu');
    assert.equal(afterFinish.toastText, 'Yhteys Gpath Pin -anturiin on katkaistu');
    assert.equal(afterFinish.statusText.toLowerCase().includes('liikuntarajoitteinen'), false);
    assert.equal(afterFinish.toastText.toLowerCase().includes('liikuntarajoitteinen'), false);
    assert.equal(afterFinish.rows, 8, 'Analyysi > Sessio table must show 8 sets');
    assert.ok(afterFinish.sessHtml.includes('>24<') || afterFinish.sessTxt.includes('24'), 'Analyysi > Sessio must show 24 total reps');
    await captureScreenshot('analysis-after-finish.png', 'Analyysi Sessio 8 sets and disconnect notice');
    console.log('PASS Step 10: finishWorkout disconnect, notice text, Analyysi > Sessio 8 sets / 24 reps');

    // 11. Analyysi > Sarjat: Set #1 (IMU-ajautuma on Reps #1 & #2) and Set #5 (3 reps + 📡 80 Hz on Rep #2)
    await clickEl('button[data-ana-sub="sarjat"]');
    await waitFor(() => cdp.eval(`!document.getElementById('anaSetDetailCard').classList.contains('hidden')`), { desc: 'Analyysi > Sarjat visible' });
    await setInputValue('#anaSetSelect', '0');
    await sleep(40);
    const sarja1Txt = await cdp.eval(`document.getElementById('anaSetDetailCard').innerText`);
    assert.ok(sarja1Txt.includes('Toisto #1: anturin IMU-ajautuma'), `Set #1 in Sarjat must flag Rep 1 IMU-ajautuma:\n${sarja1Txt}`);
    assert.ok(sarja1Txt.includes('Toisto #2: anturin IMU-ajautuma'), `Set #1 in Sarjat must flag Rep 2 IMU-ajautuma:\n${sarja1Txt}`);
    assert.ok(!sarja1Txt.includes('Toisto #3: anturin IMU-ajautuma'), 'Set #1 Rep 3 in Sarjat must remain valid');

    await setInputValue('#anaSetSelect', '4');
    await sleep(40);
    const sarja5Info = await cdp.eval(`(() => {
      const card = document.getElementById('anaSetDetailCard');
      return { text: card.innerText, html: card.innerHTML };
    })()`);
    assert.ok(sarja5Info.text.includes('📡 80 Hz'), `Set #5 must display 📡 80 Hz badge on Rep #2:\n${sarja5Info.text}`);
    assert.ok(sarja5Info.text.includes('#1') && sarja5Info.text.includes('#2') && sarja5Info.text.includes('#3'), 'Set #5 must show 3 reps');
    await cdp.eval(`(() => {
      const card = document.getElementById('anaSetDetailCard');
      const badge = Array.from(card.querySelectorAll('span')).find((el) => el.textContent.includes('80 Hz'));
      if (badge) badge.scrollIntoView({ block: 'center' });
    })()`);
    await captureScreenshot('set5-recovered-80hz.png', 'Set #5 with 3 reps and 80 Hz badge');
    console.log('PASS Step 11: Analyysi > Sarjat Set #1 drift & Set #5 recovered 80 Hz');

    // 12. Analyysi > ⚙: BLE-diagnostiikka + #anaRawExport (showSaveFilePicker, <a download>, iOS Bluefy)
    await clickEl('button[data-ana-sub="asetukset"]');
    await waitFor(() => cdp.eval(`!document.getElementById('anaSettingsCard').classList.contains('hidden')`), { desc: 'Analyysi > Asetukset visible' });
    await cdp.eval(`(() => { const d = document.getElementById('bleDiagDetails'); if (d) d.open = true; })()`);
    const diagTxt = await cdp.eval(`document.getElementById('bleDiagList').innerText`);
    for (const kind of ['dropped-inactive', 'fallback-02-missing', 'trace-b1', 'auto-rezero', 'trace-recovered', 'rezero']) {
      assert.ok(diagTxt.includes(kind), `BLE-diagnostiikka must contain [${kind}], got:\n${diagTxt}`);
    }

    // 12a. Desktop showSaveFilePicker mock
    const pickerRes = await cdp.eval(`(async () => {
      let savedName = '';
      let savedBytes = 0;
      window.showSaveFilePicker = async (opts) => {
        savedName = opts.suggestedName;
        return {
          async createWritable() {
            return {
              async write(blob) { savedBytes = blob.size || (await blob.text()).length; },
              async close() {}
            };
          }
        };
      };
      document.getElementById('anaRawExport').click();
      await new Promise((r) => setTimeout(r, 80));
      return { savedName, savedBytes, msg: document.getElementById('anaRawExportMsg').textContent.trim() };
    })()`);
    assert.ok(pickerRes.savedName.startsWith('gpath_raw_') && pickerRes.savedBytes > 100);
    assert.equal(pickerRes.msg, 'Tallennettu!');

    // 12b. Desktop <a download> fallback
    const anchorRes = await cdp.eval(`(async () => {
      delete window.showSaveFilePicker;
      let revoked = 0;
      let dlName = '';
      const origRevoke = URL.revokeObjectURL;
      URL.revokeObjectURL = (u) => { revoked++; return origRevoke.call(URL, u); };
      const origAnchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() { dlName = this.download; };
      try {
        document.getElementById('anaRawExport').click();
        const deadline = Date.now() + 2000;
        while (revoked === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
        return { revoked, dlName, msg: document.getElementById('anaRawExportMsg').textContent.trim() };
      } finally {
        URL.revokeObjectURL = origRevoke;
        HTMLAnchorElement.prototype.click = origAnchorClick;
      }
    })()`);
    assert.ok(anchorRes.revoked >= 1, 'Fallback <a download> must call URL.revokeObjectURL');
    assert.ok(anchorRes.dlName.startsWith('gpath_raw_'));
    assert.equal(anchorRes.msg, 'Tallennettu!');

    // 12c. Mocked iOS Bluefy
    const iosRawRes = await cdp.eval(`(async () => {
      const shared = [];
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Bluefy/1.0'
      });
      navigator.canShare = ({ files }) => Array.isArray(files) && files.length > 0;
      navigator.share = async ({ files }) => { shared.push(...files.map((f) => ({ name: f.name, size: f.size }))); };
      document.getElementById('anaRawExport').click();
      await new Promise((r) => setTimeout(r, 80));
      return { shared, msg: document.getElementById('anaRawExportMsg').textContent.trim() };
    })()`);
    assert.equal(iosRawRes.shared.length, 1);
    assert.ok(/^gpath_raw_.*\.csv$/.test(iosRawRes.shared[0].name), `Expected gpath_raw_*.csv, got ${iosRawRes.shared[0].name}`);
    assert.equal(iosRawRes.msg, 'Jaettu!');
    console.log('PASS Step 12: BLE-diagnostiikka & #anaRawExport (3 export modes)');

    // 13. Kalenteri -> #exportCsvBtn via mocked iOS navigator.share({ files }) -> 44-column CSV with 8 sets / 24 reps
    await clickEl('#navHistoryBtn');
    await waitFor(() => cdp.eval(`!document.getElementById('tabHistory').classList.contains('hidden')`), { desc: 'Kalenteri tab visible' });
    const csvRes = await cdp.eval(`(async () => {
      let csvText = '';
      let fileName = '';
      navigator.canShare = ({ files }) => Array.isArray(files) && files.length > 0;
      navigator.share = async ({ files }) => {
        fileName = files[0].name;
        csvText = await files[0].text();
      };
      document.getElementById('exportCsvBtn').click();
      await new Promise((r) => setTimeout(r, 80));
      return { fileName, csvText };
    })()`);
    assert.ok(/^gpath_.*\.csv$/.test(csvRes.fileName), `Unexpected CSV filename: ${csvRes.fileName}`);
    const csvLines = csvRes.csvText.trim().split('\n');
    assert.equal(csvLines.length, 25, `CSV must have 1 header + 24 rep rows, got ${csvLines.length}`);
    const headers = csvLines[0].split(',');
    assert.equal(headers.length, 44, `CSV must have 44 columns, got ${headers.length}`);
    const setNums = new Set(csvLines.slice(1).map((line) => line.split(',')[3]));
    assert.equal(setNums.size, 8, `CSV must contain all 8 sets, got ${setNums.size}`);
    console.log('PASS Step 13: Kalenteri CSV export (44 columns, 8 sets / 24 reps)');

    const logs = await cdp.eval(`window.__mockPin.getLogs()`);
    assert.deepEqual(runtimeErrors, [], `Unexpected page runtime errors: ${runtimeErrors.join('; ')}`);
    assert.deepEqual(consoleErrors, [], `Unexpected console.error calls: ${consoleErrors.join('; ')}`);
    assert.deepEqual(logs.pageErrors, [], `Unexpected in-page errors: ${logs.pageErrors.join('; ')}`);

    console.log('\nALL 13 BROWSER E2E STEPS PASSED (0 runtime/console errors).');
    for (const s of screenshots) {
      console.log(`Screenshot: ${s.path} | ${s.description}`);
    }
  } finally {
    if (cdp) cdp.close();
    if (chromeProc) {
      try { chromeProc.kill(); } catch {}
    }
    if (server) {
      await new Promise((r) => server.close(r));
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.rmSync(tmpProfileDir, { recursive: true, force: true });
        break;
      } catch {
        await sleep(150);
      }
    }
  }
}

run().catch((err) => {
  console.error('E2E FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});
