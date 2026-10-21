// Fonts are bundled (Latin subset) so the tuner also works offline.
import '@fontsource/big-shoulders-display/latin-600';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/instrument-sans/latin-400';
import '@fontsource/instrument-sans/latin-500';
import '@fontsource/instrument-sans/latin-600';
import './styles.css';
import { MicInput, MicError } from './audio/mic';
import { ReferenceTone } from './audio/reference-tone';
import { ClipRecorder, deliverFile } from './audio/clip';
import { registerServiceWorker, offlineVersion } from './pwa';
import { TunerEngine, type EngineSettings, type Reading } from './engine';
import { INSTRUMENTS, findInstrument, resolveStrings } from './instruments';
import { t, tList } from './i18n';
import {
  loadSettings, saveSettings, clamp, A4_MIN, A4_MAX, TOLERANCE_MIN, TOLERANCE_MAX, type Settings, type Theme,
} from './settings';

// ---------- state ----------

const settings: Settings = loadSettings();
let lockedString: number | null = null;
let mic: MicInput | null = null;
let engine: TunerEngine | null = null;
let tone: ReferenceTone | null = null;
let reading: Reading | null = null;
let muteUntil = 0; // ignore the mic while a reference tone plays
let wakeLock: { release(): Promise<void> } | null = null;
let clip: ClipRecorder | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  stage: $('stage'),
  views: $('views'),
  noteLetter: $('note-letter'),
  noteAcc: $('note-acc'),
  noteOct: $('note-oct'),
  scale: $('scale'),
  zone: $('scale-zone'),
  ticks: $('scale-ticks'),
  needle: $('needle'),
  direction: $('direction'),
  detailCents: $('detail-cents'),
  detailHz: $('detail-hz'),
  live: $('live'),
  startBtn: $<HTMLButtonElement>('start-btn'),
  startHint: $('start-hint'),
  error: $('error'),
  stringsSection: $('strings-section'),
  pegs: $('pegs'),
  stringHint: $('string-hint'),
  playBtn: $<HTMLButtonElement>('play-btn'),
  playLabel: $('play-label'),
  levelLabel: $('level-label'),
  levelFill: $('level-fill'),
  clarityLabel: $('clarity-label'),
  clarityFill: $('clarity-fill'),
  stopBtn: $<HTMLButtonElement>('stop-btn'),
  settingsBtn: $<HTMLButtonElement>('settings-btn'),
  helpBtn: $<HTMLButtonElement>('help-btn'),
  settingsDialog: $<HTMLDialogElement>('settings-dialog'),
  helpDialog: $<HTMLDialogElement>('help-dialog'),
  a4Value: $<HTMLOutputElement>('a4-value'),
  a4Down: $<HTMLButtonElement>('a4-down'),
  a4Up: $<HTMLButtonElement>('a4-up'),
  tolRange: $<HTMLInputElement>('tol-range'),
  tolValue: $<HTMLOutputElement>('tol-value'),
  micSelect: $<HTMLSelectElement>('mic-select'),
  themeSeg: $('theme-seg'),
  resetTuned: $<HTMLButtonElement>('reset-tuned'),
  inputRow: $('input-row'),
  quickInput: $<HTMLSelectElement>('quick-input'),
  channelChip: $('channel-chip'),
  quickChannel: $<HTMLSelectElement>('quick-channel'),
  toast: $('toast'),
  toastText: $('toast-text'),
  toastBtn: $<HTMLButtonElement>('toast-btn'),
  toastClose: $<HTMLButtonElement>('toast-close'),
  saveClip: $<HTMLButtonElement>('save-clip'),
  appVersion: $('app-version'),
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------- helpers ----------

const isChromatic = () => settings.view === 'chromatic';
const instrumentId = () => (isChromatic() ? lastInstrument : settings.view);
let lastInstrument = isChromatic() ? INSTRUMENTS[0].id : settings.view;

function engineSettings(): EngineSettings {
  const inst = findInstrument(instrumentId());
  return {
    a4: settings.a4,
    toleranceCents: settings.toleranceCents,
    mode: isChromatic() ? 'chromatic' : 'instrument',
    instrumentId: inst.id,
    tuningId: inst.tunings[0].id,
    lockedString: isChromatic() ? null : lockedString,
  };
}

function currentStrings() {
  const inst = findInstrument(instrumentId());
  return resolveStrings(inst.tunings[0], settings.a4);
}

function splitNote(name: string): { letter: string; acc: string; oct: string } {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) return { letter: '–', acc: '', oct: '' };
  return { letter: m[1], acc: m[2] === '#' ? '♯' : m[2] === 'b' ? '♭' : '', oct: m[3] };
}

const prettyNote = (name: string) => {
  const n = splitNote(name);
  return `${n.letter}${n.acc}${n.oct}`;
};

function persist() {
  saveSettings(settings);
}

// ---------- static UI ----------

function buildText() {
  document.title = 'Instrument Tuner';
  el.startBtn.textContent = t('start');
  el.startHint.textContent = t('startHint');
  el.stopBtn.textContent = t('stop');
  el.levelLabel.textContent = t('inputLevel');
  el.clarityLabel.textContent = t('clarity');
  el.settingsBtn.setAttribute('aria-label', t('settings'));
  el.helpBtn.textContent = t('help');
  $('settings-title').textContent = t('settings');
  $('help-title').textContent = t('help');
  $('a4-label').textContent = t('referencePitch');
  $('a4-hint').textContent = t('referencePitchHint');
  $('tol-label').textContent = t('tolerance');
  $('tol-hint').textContent = t('toleranceHint');
  $('mic-label').textContent = t('microphone');
  $('theme-label').textContent = t('theme');
  el.a4Down.setAttribute('aria-label', t('lower'));
  el.a4Up.setAttribute('aria-label', t('higher'));
  el.resetTuned.textContent = t('resetTuned');
  el.saveClip.textContent = t('saveClip');
  $('save-clip-hint').textContent = t('saveClipHint');
  $('quick-input-label').textContent = t('input');
  $('channel-label').textContent = t('channel');
  const list = $('help-list');
  list.replaceChildren(...tList('helpBody').map((line) => Object.assign(document.createElement('li'), { textContent: line })));
}

function buildViews() {
  const buttons = INSTRUMENTS.map((inst) => viewButton(inst.id, inst.name));
  const chrom = viewButton('chromatic', t('modeChromatic'));
  chrom.classList.add('is-chromatic');
  el.views.replaceChildren(...buttons, chrom);
  scrollViewIntoView();
}

/** On very narrow screens the tabs scroll; keep the selected one visible. */
function scrollViewIntoView() {
  el.views.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function viewButton(id: string, label: string) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'view-btn';
  b.textContent = label;
  b.dataset.view = id;
  b.setAttribute('aria-pressed', String(settings.view === id));
  b.addEventListener('click', () => selectView(id));
  return b;
}

function buildTicks() {
  const frag = document.createDocumentFragment();
  for (let c = -50; c <= 50; c += 5) {
    const tk = document.createElement('span');
    tk.className = 'tick' + (c === 0 ? ' centre' : c % 25 === 0 ? ' major' : '');
    tk.style.left = `${50 + c}%`;
    frag.append(tk);
  }
  el.ticks.replaceChildren(frag);
}

function buildPegs() {
  const show = !isChromatic();
  el.stringsSection.hidden = !show;
  if (!show) return;
  const pegs = currentStrings().map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'peg';
    b.dataset.index = String(s.index);
    const n = splitNote(s.name);
    b.innerHTML = `<span>${n.letter}${n.acc}<sub>${n.oct}</sub></span>`;
    b.setAttribute('aria-label', prettyNote(s.name));
    b.addEventListener('click', () => toggleLock(s.index));
    return b;
  });
  el.pegs.replaceChildren(...pegs);
  renderPegs();
}

function renderZone() {
  const tol = settings.toleranceCents;
  el.zone.style.left = `${50 - tol}%`;
  el.zone.style.width = `${2 * tol}%`;
}

// ---------- interactions ----------

function selectView(id: string) {
  if (settings.view === id) return;
  settings.view = id;
  if (id !== 'chromatic') lastInstrument = id;
  lockedString = null;
  persist();
  el.views.querySelectorAll<HTMLButtonElement>('.view-btn').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.view === id)),
  );
  scrollViewIntoView();
  engine?.configure(engineSettings());
  reading = null;
  buildPegs();
  renderStringTools();
  render();
}

function toggleLock(index: number) {
  lockedString = lockedString === index ? null : index;
  engine?.configure({ lockedString });
  renderPegs();
  renderStringTools();
}

function renderStringTools() {
  if (isChromatic()) return;
  const strings = currentStrings();
  if (lockedString !== null && strings[lockedString]) {
    const name = prettyNote(strings[lockedString].name);
    el.stringHint.textContent = t('lockedHint', { note: name });
    el.playLabel.textContent = t('playReference', { note: name });
    el.playBtn.hidden = false;
  } else {
    el.stringHint.textContent = t('autoHint');
    el.playBtn.hidden = true;
  }
}

function renderPegs() {
  const target = reading?.active ? reading.stringIndex : null;
  el.pegs.querySelectorAll<HTMLButtonElement>('.peg').forEach((b) => {
    const i = Number(b.dataset.index);
    b.setAttribute('aria-pressed', String(lockedString === i));
    b.classList.toggle('is-target', target === i);
    b.classList.toggle('is-tuned', engine?.tuned.has(i) ?? false);
  });
}

function playReference() {
  if (lockedString === null) return;
  const s = currentStrings()[lockedString];
  if (!s) return;
  if (!tone) {
    const ctx = mic?.context ?? new AudioContext();
    tone = new ReferenceTone(ctx);
  }
  const seconds = 2.5;
  tone.play(s.freq, seconds);
  muteUntil = performance.now() + seconds * 1000 + 250;
  engine?.reset();
  el.playBtn.setAttribute('aria-pressed', 'true');
  window.setTimeout(() => el.playBtn.setAttribute('aria-pressed', 'false'), seconds * 1000);
}

async function startMic() {
  el.error.hidden = true;
  el.startBtn.disabled = true;
  try {
    if (!mic) {
      mic = new MicInput(onSamples);
      mic.onDevicesChanged = () => void fillMicList();
    }
    mic.setChannel(settings.channel);
    await mic.start(settings.deviceId || undefined);
    engine = new TunerEngine(mic.sampleRate, engineSettings());
    tone ??= new ReferenceTone(mic.context);
    if (!clip || clip.sampleRate !== mic.sampleRate) clip = new ClipRecorder(mic.sampleRate);
    el.stage.dataset.state = 'listening';
    el.stopBtn.hidden = false;
    el.inputRow.hidden = false;
    void requestWakeLock();
    void fillMicList();
  } catch (e) {
    // A remembered device that is gone: retry once with the default input.
    if (e instanceof MicError && e.kind === 'no-device' && settings.deviceId) {
      settings.deviceId = '';
      persist();
      el.startBtn.disabled = false;
      return startMic();
    }
    showError(e);
  } finally {
    el.startBtn.disabled = false;
  }
}

function stopMic() {
  mic?.stop();
  tone?.stop(true);
  engine = null;
  reading = null;
  el.stage.dataset.state = 'idle';
  el.stopBtn.hidden = true;
  el.inputRow.hidden = true;
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
  render();
}

function showError(e: unknown) {
  let msg: string;
  if (e instanceof MicError) {
    msg = {
      denied: t('errDenied'),
      'no-device': t('errNoDevice'),
      insecure: t('errInsecure'),
      unsupported: t('errUnsupported'),
      other: t('errOther', { msg: e.message }),
    }[e.kind];
  } else {
    msg = t('errOther', { msg: (e as Error)?.message ?? String(e) });
  }
  el.error.textContent = msg;
  el.error.hidden = false;
}

function onSamples(block: Float32Array) {
  if (!engine) return;
  clip?.push(block);
  if (performance.now() < muteUntil) return;
  const r = engine.push(block);
  if (r) {
    reading = r;
    clip?.note({ active: r.active, held: r.held, note: r.targetName, cents: r.cents, freq: r.freq, inTune: r.inTune });
  }
}

async function requestWakeLock() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null; // not supported or not allowed; the tuner still works
  }
}

document.addEventListener('visibilitychange', () => {
  if (!mic?.running) return;
  if (document.hidden) void mic.context.suspend();
  else {
    void mic.context.resume();
    void requestWakeLock();
  }
});

// ---------- settings sheet ----------

function renderSettings() {
  el.a4Value.textContent = `${settings.a4} Hz`;
  el.a4Down.disabled = settings.a4 <= A4_MIN;
  el.a4Up.disabled = settings.a4 >= A4_MAX;
  el.tolRange.min = String(TOLERANCE_MIN);
  el.tolRange.max = String(TOLERANCE_MAX);
  el.tolRange.value = String(settings.toleranceCents);
  el.tolValue.textContent = t('plusMinusCents', { n: settings.toleranceCents });
  el.themeSeg.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.theme === settings.theme)),
  );
}

function buildThemeSeg() {
  const opts: [Theme, string][] = [['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')]];
  el.themeSeg.replaceChildren(
    ...opts.map(([id, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn';
      b.role = 'radio';
      b.dataset.theme = id;
      b.textContent = label;
      b.addEventListener('click', () => {
        settings.theme = id;
        persist();
        applyTheme();
        renderSettings();
      });
      return b;
    }),
  );
}

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
}

function setA4(v: number) {
  settings.a4 = clamp(Math.round(v), A4_MIN, A4_MAX);
  persist();
  engine?.configure({ a4: settings.a4 });
  renderSettings();
  buildPegs();
}

/** Fill both input pickers (settings sheet and main screen) and the channel picker. */
async function fillMicList() {
  const devices = await MicInput.listInputs();
  const named = devices.filter((d) => d.id && d.id !== 'default' && d.id !== 'communications');
  // A remembered input that has been unplugged: fall back to the default one.
  if (settings.deviceId && devices.length && !named.some((d) => d.id === settings.deviceId)) {
    settings.deviceId = '';
    persist();
    if (mic?.running) void startMic();
  }
  for (const sel of [el.micSelect, el.quickInput]) {
    sel.replaceChildren(new Option(t('microphoneDefault'), ''), ...named.map((d) => new Option(d.label, d.id)));
    sel.value = settings.deviceId;
  }
  renderChannels();
}

function renderChannels() {
  const n = mic?.running ? mic.channelCount : 1;
  el.channelChip.hidden = n < 2;
  if (n < 2) return;
  const opts = [new Option(t('channelMix'), '-1')];
  for (let c = 0; c < n; c++) opts.push(new Option(t('channelN', { n: c + 1 }), String(c)));
  el.quickChannel.replaceChildren(...opts);
  el.quickChannel.value = String(settings.channel < n ? settings.channel : -1);
}

function selectInput(deviceId: string) {
  settings.deviceId = deviceId;
  persist();
  el.micSelect.value = deviceId;
  el.quickInput.value = deviceId;
  if (mic?.running) void startMic();
}

function wireSettings() {
  el.settingsBtn.addEventListener('click', () => {
    renderSettings();
    void fillMicList();
    void offlineVersion().then((v) => (el.appVersion.textContent = v ? t('version', { v }) : ''));
    el.settingsDialog.showModal();
  });
  el.helpBtn.addEventListener('click', () => {
    el.settingsDialog.close();
    el.helpDialog.showModal();
  });
  for (const d of [el.settingsDialog, el.helpDialog]) {
    d.addEventListener('click', (ev) => {
      if (ev.target === d) d.close(); // click on the backdrop
    });
  }
  el.a4Down.addEventListener('click', () => setA4(settings.a4 - 1));
  el.a4Up.addEventListener('click', () => setA4(settings.a4 + 1));
  el.tolRange.addEventListener('input', () => {
    settings.toleranceCents = clamp(Number(el.tolRange.value), TOLERANCE_MIN, TOLERANCE_MAX);
    persist();
    engine?.configure({ toleranceCents: settings.toleranceCents });
    renderSettings();
    renderZone();
  });
  el.micSelect.addEventListener('change', () => selectInput(el.micSelect.value));
  el.quickInput.addEventListener('change', () => selectInput(el.quickInput.value));
  el.quickChannel.addEventListener('change', () => {
    settings.channel = Number(el.quickChannel.value);
    persist();
    mic?.setChannel(settings.channel);
    engine?.reset();
  });
  el.saveClip.addEventListener('click', () => void saveClip());
  el.resetTuned.addEventListener('click', () => {
    engine?.clearTuned();
    renderPegs();
  });
}

// ---------- notices, offline support, troubleshooting clips ----------

let toastTimer: number | undefined;
function showToast(text: string, action?: { label: string; run: () => void }, seconds = 6) {
  window.clearTimeout(toastTimer);
  el.toastText.textContent = text;
  el.toastBtn.hidden = !action;
  if (action) {
    el.toastBtn.textContent = action.label;
    el.toastBtn.onclick = () => {
      el.toast.hidden = true;
      action.run();
    };
  }
  el.toast.hidden = false;
  if (!action) toastTimer = window.setTimeout(() => (el.toast.hidden = true), seconds * 1000);
}
el.toastClose.addEventListener('click', () => (el.toast.hidden = true));

async function saveClip() {
  if (!clip?.hasAudio) {
    showToast(t('clipNeedsAudio'));
    return;
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = `tuner-clip-${stamp}.wav`;
  const blob = clip.toWav({
    app: 'instrument-tuner',
    version: await offlineVersion(),
    savedAt: new Date().toISOString(),
    settings: { ...engineSettings(), view: settings.view, channel: settings.channel },
    input: { label: el.quickInput.selectedOptions[0]?.textContent ?? '', channels: mic?.channelCount ?? 1 },
    userAgent: navigator.userAgent,
  });
  const how = await deliverFile(blob, file);
  if (how !== 'cancelled') showToast(t('clipSaved', { file }));
}

registerServiceWorker({
  onOfflineReady: () => showToast(t('offlineReady')),
  onUpdateReady: (apply) => showToast(t('updateReady'), { label: t('update'), run: apply }),
});

// ---------- render loop ----------

let needleCents = 0;
let lastFrame = performance.now();
let lastLiveKey = '';

function render() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const listening = engine !== null;
  const r = listening ? reading : null;
  const active = !!r?.active;

  el.stage.dataset.state = !listening ? 'idle' : active ? 'active' : 'listening';
  el.stage.dataset.held = String(!!r?.held);
  el.stage.dataset.tune = active && r!.inTune ? 'in' : 'out';

  if (active && r) {
    const n = splitNote(r.targetName);
    el.noteLetter.textContent = n.letter;
    el.noteAcc.textContent = n.acc;
    el.noteOct.textContent = n.oct;
    el.direction.textContent = r.inTune ? t('inTune') : r.cents < 0 ? t('tuneUp') : t('tuneDown');
    const sign = r.cents > 0 ? '+' : r.cents < 0 ? '−' : '';
    el.detailCents.textContent = t('cents', { n: `${sign}${Math.abs(r.cents).toFixed(1)}` });
    el.detailHz.textContent = t('hz', { n: r.freq.toFixed(1) });

    // Needle: critically-damped follow, pinned at the scale ends.
    const target = clamp(r.cents, -50, 50);
    if (reducedMotion.matches) needleCents = target;
    else needleCents += (target - needleCents) * (1 - Math.exp(-dt * 28));
  } else {
    el.noteLetter.textContent = listening ? (lastLetter() ?? '') : '';
    el.noteAcc.textContent = '';
    el.noteOct.textContent = '';
    el.direction.textContent = listening ? (isChromatic() ? t('playNote') : t('playString')) : '';
    el.detailCents.textContent = '';
    el.detailHz.textContent = '';
    needleCents += (0 - needleCents) * (1 - Math.exp(-dt * 6));
  }
  const width = el.scale.clientWidth;
  el.needle.style.transform = `translateX(${(needleCents / 100) * width}px)`;

  // Meters
  const level = r ? clamp((r.levelDb + 60) / 60, 0, 1) : 0;
  el.levelFill.style.width = `${(level * 100).toFixed(1)}%`;
  el.levelFill.classList.toggle('good', !!r && r.levelDb > -40);
  el.levelFill.classList.toggle('low', !!r && r.levelDb <= -50);
  const conf = r ? r.confidence : 0;
  el.clarityFill.style.width = `${(conf * 100).toFixed(1)}%`;
  el.clarityFill.classList.toggle('good', conf > 0.85);

  if (listening) renderPegs();

  // Screen readers: announce when a note comes into tune, not every frame.
  const liveKey = active && r!.inTune && !r!.held ? r!.targetName : '';
  if (liveKey !== lastLiveKey) {
    lastLiveKey = liveKey;
    el.live.textContent = liveKey ? t('stringTuned', { note: prettyNote(liveKey) }) : '';
  }
}

/** In instrument mode, show the locked string's letter faintly while waiting. */
function lastLetter(): string | null {
  if (isChromatic() || lockedString === null) return null;
  const s = currentStrings()[lockedString];
  return s ? splitNote(s.name).letter : null;
}

function loop() {
  render();
  requestAnimationFrame(loop);
}

// ---------- boot ----------

applyTheme();
buildText();
buildViews();
buildTicks();
buildPegs();
buildThemeSeg();
renderZone();
renderStringTools();
wireSettings();
el.startBtn.addEventListener('click', () => void startMic());
el.stopBtn.addEventListener('click', stopMic);
el.playBtn.addEventListener('click', playReference);
requestAnimationFrame(loop);

// Expose a hook for automated browser tests (feeds synthetic audio).
declare global {
  interface Window {
    __tuner?: { feed(block: Float32Array): void; start(sampleRate: number): void };
  }
}
window.__tuner = {
  start(sampleRate: number) {
    engine = new TunerEngine(sampleRate, engineSettings());
    el.stage.dataset.state = 'listening';
  },
  feed(block: Float32Array) {
    if (!engine) return;
    const r = engine.push(block);
    if (r) reading = r;
  },
};
