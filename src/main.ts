// Fonts are bundled (Latin subset) so the tuner also works offline.
import '@fontsource/big-shoulders-display/latin-600';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/instrument-sans/latin-400';
import '@fontsource/instrument-sans/latin-500';
import '@fontsource/instrument-sans/latin-600';
import './styles.css';
import { MicInput, MicError } from './audio/mic';
import { ReferencePlayer } from './audio/reference-player';
import { ClipRecorder, deliverFile } from './audio/clip';
import { registerServiceWorker, offlineVersion } from './pwa';
import { TunerEngine, type EngineSettings, type Reading } from './engine';
import { INSTRUMENTS, findInstrument, resolveStrings, tuningLetters, STRING_COUNT_RANGE, STRING_NOTE_RANGE } from './instruments';
import {
  selectedTuning, tuningsFor, stepNote, extraString, newCustomId, defaultCustomName, CUSTOM_NAME_MAX, type CustomTuning,
} from './tunings';
import { midiToName, nameToMidi } from './tuning';
import { t, tList } from './i18n';
import {
  loadSettings, saveSettings, clamp, A4_MIN, A4_MAX, TOLERANCE_MIN, TOLERANCE_MAX, type Settings, type Theme,
} from './settings';

// ---------- state ----------

const settings: Settings = loadSettings();
let lockedString: number | null = null;
let mic: MicInput | null = null;
let engine: TunerEngine | null = null;
let player: ReferencePlayer | null = null;
let playingString: number | null = null;
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
  plays: $('plays'),
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
  tuningBtn: $<HTMLButtonElement>('tuning-btn'),
  tuningName: $('tuning-name'),
  tuningNotes: $('tuning-notes'),
  standBtn: $<HTMLButtonElement>('stand-btn'),
  tuningDialog: $<HTMLDialogElement>('tuning-dialog'),
  presetList: $('preset-list'),
  customGroup: $('custom-group'),
  customList: $('custom-list'),
  newTuningBtn: $<HTMLButtonElement>('new-tuning-btn'),
  editorDialog: $<HTMLDialogElement>('editor-dialog'),
  editorForm: $<HTMLFormElement>('editor-form'),
  editorTitle: $('editor-title'),
  editorName: $<HTMLInputElement>('editor-name'),
  stringRows: $('string-rows'),
  addLow: $<HTMLButtonElement>('add-low'),
  addHigh: $<HTMLButtonElement>('add-high'),
  editorDelete: $<HTMLButtonElement>('editor-delete'),
  editorCancel: $<HTMLButtonElement>('editor-cancel'),
  editorClose: $<HTMLButtonElement>('editor-close'),
  editorSave: $<HTMLButtonElement>('editor-save'),
  stand: $('stand'),
  standHint: $('stand-hint'),
  standLetter: $('stand-letter'),
  standAcc: $('stand-acc'),
  standOct: $('stand-oct'),
  standDirText: $('stand-dir-text'),
  standCents: $('stand-cents'),
  standZone: $('stand-zone'),
  standMark: $('stand-mark'),
  standLive: $('stand-live'),
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------- helpers ----------

const isChromatic = () => settings.view === 'chromatic';
const instrumentId = () => (isChromatic() ? lastInstrument : settings.view);
let lastInstrument = isChromatic() ? INSTRUMENTS[0].id : settings.view;

function currentTuning() {
  return selectedTuning(instrumentId(), settings.tunings, settings.customTunings);
}

function engineSettings(): EngineSettings {
  const tun = currentTuning();
  return {
    a4: settings.a4,
    toleranceCents: settings.toleranceCents,
    mode: isChromatic() ? 'chromatic' : 'instrument',
    instrumentId: instrumentId(),
    tuningId: tun.id,
    strings: [...tun.strings],
    lockedString: isChromatic() ? null : lockedString,
  };
}

function currentStrings() {
  return resolveStrings(currentTuning(), settings.a4);
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
  $('stand-btn-label').textContent = t('standView');
  el.standBtn.setAttribute('aria-label', t('standViewLabel'));
  el.standHint.textContent = t('standHint');
  $('custom-title').textContent = t('yourTunings');
  $('new-tuning-label').textContent = t('newTuning');
  $('editor-name-label').textContent = t('tuningNameLabel');
  $('editor-strings-label').textContent = t('stringsLabel');
  $('editor-strings-hint').textContent = t('stringsHint');
  el.addLow.textContent = `+ ${t('addLowString')}`;
  el.addHigh.textContent = `+ ${t('addHighString')}`;
  el.editorCancel.textContent = t('cancel');
  el.editorSave.textContent = t('save');
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
  const strings = currentStrings();
  el.pegs.style.setProperty('--n', String(strings.length));
  const pegs = strings.map((s) => {
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
  el.plays.style.setProperty('--n', String(strings.length));
  el.plays.replaceChildren(
    ...strings.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'play-string';
      b.dataset.index = String(s.index);
      b.setAttribute('aria-label', t('playReference', { note: prettyNote(s.name) }));
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" /><path class="wave" d="M15.5 9a4 4 0 0 1 0 6" /></svg>';
      b.addEventListener('click', () => void playString(s.index));
      return b;
    }),
  );
  renderPegs();
  preloadReferences();
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
  renderTuningButton();
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
    el.stringHint.textContent = t('lockedHint', { note: prettyNote(strings[lockedString].name) });
  } else {
    el.stringHint.textContent = t('autoHint');
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

function ensurePlayer(): ReferencePlayer {
  if (!player) {
    player = new ReferencePlayer(mic?.context ?? new AudioContext({ latencyHint: 'interactive' }));
    player.onEnded = () => {
      playingString = null;
      renderPlays();
    };
  }
  return player;
}

/** Load the current strings' sounds in the background (only once audio is allowed). */
function preloadReferences() {
  if (!player || isChromatic()) return;
  player.preload(instrumentId(), currentStrings().map((s) => s.midi), settings.a4);
}

/** Play (or stop) the reference sound of one string, in the instrument's own voice. */
async function playString(index: number) {
  const p = ensurePlayer();
  if (playingString === index) {
    p.stop();
    playingString = null;
    muteUntil = 0;
    renderPlays();
    return;
  }
  const s = currentStrings()[index];
  if (!s) return;
  playingString = index;
  renderPlays();
  // The tuner would hear the speaker: ignore the microphone while the note sounds.
  muteUntil = performance.now() + 4000;
  engine?.reset();
  const seconds = await p.play(instrumentId(), s.midi, settings.a4);
  if (playingString === index) muteUntil = performance.now() + seconds * 1000 + 250;
  preloadReferences();
}

function renderPlays() {
  el.plays.querySelectorAll<HTMLButtonElement>('.play-string').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.index) === playingString)),
  );
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
    if (!clip || clip.sampleRate !== mic.sampleRate) clip = new ClipRecorder(mic.sampleRate);
    ensurePlayer();
    preloadReferences();
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
  player?.stop();
  playingString = null;
  renderPlays();
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

// ---------- tunings: picker and editor ----------

function renderTuningButton() {
  el.tuningBtn.hidden = isChromatic();
  if (isChromatic()) return;
  const tun = currentTuning();
  el.tuningName.textContent = tun.name;
  el.tuningNotes.textContent = tuningLetters(tun.strings);
  el.tuningBtn.setAttribute('aria-label', `${t('tuning')}: ${tun.name}, ${tuningLetters(tun.strings)}`);
}

function selectTuning(id: string) {
  settings.tunings = { ...settings.tunings, [instrumentId()]: id };
  persist();
  lockedString = null;
  engine?.configure(engineSettings());
  reading = null;
  buildPegs();
  renderStringTools();
  renderTuningButton();
}

function tuningRow(tun: { id: string; name: string; strings: string[] }, selected: boolean, editable: boolean) {
  const row = document.createElement('div');
  row.className = 'tuning-row';
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'tuning-pick';
  pick.setAttribute('role', 'radio');
  pick.setAttribute('aria-checked', String(selected));
  pick.innerHTML = `<span class="tick-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
    <span class="pick-text"><span class="pick-name"></span><span class="pick-notes"></span></span>`;
  pick.querySelector('.pick-name')!.textContent = tun.name;
  pick.querySelector('.pick-notes')!.textContent = tuningLetters(tun.strings);
  pick.addEventListener('click', () => {
    selectTuning(tun.id);
    el.tuningDialog.close();
  });
  row.append(pick);
  if (editable) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'icon-btn';
    edit.setAttribute('aria-label', t('editNamed', { name: tun.name }));
    edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>';
    edit.addEventListener('click', () => {
      el.tuningDialog.close();
      openEditor(tun.id);
    });
    row.append(edit);
  }
  return row;
}

function openTuningPicker() {
  const { presets, custom } = tuningsFor(instrumentId(), settings.customTunings);
  const current = currentTuning().id;
  $('tuning-title').textContent = `${findInstrument(instrumentId()).name} · ${t('tuning')}`;
  el.presetList.replaceChildren(...presets.map((p) => tuningRow(p, p.id === current, false)));
  el.customGroup.hidden = custom.length === 0;
  el.customList.replaceChildren(...custom.map((c) => tuningRow(c, c.id === current, true)));
  el.tuningDialog.showModal();
  el.tuningDialog.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest' });
}

// Editor draft: a copy that only becomes real on Save.
let draft: { id: string | null; strings: string[] } = { id: null, strings: [] };
let deleteArmed = false;

const ALL_NOTES = (() => {
  const out: string[] = [];
  for (let m = nameToMidi(STRING_NOTE_RANGE.low); m <= nameToMidi(STRING_NOTE_RANGE.high); m++) out.push(midiToName(m));
  return out;
})();

function openEditor(editId: string | null) {
  const existing = editId ? settings.customTunings.find((c) => c.id === editId) : undefined;
  const base = existing ?? currentTuning();
  // keep notes as sharps in the editor so they match the note list
  draft = { id: existing?.id ?? null, strings: base.strings.map((n) => midiToName(nameToMidi(n))) };
  el.editorTitle.textContent = existing ? t('editTuning') : t('newTuning');
  el.editorName.value = existing ? existing.name : '';
  el.editorName.placeholder = defaultCustomName(draft.strings);
  el.editorDelete.hidden = !existing;
  deleteArmed = false;
  el.editorDelete.textContent = t('deleteTuning');
  renderStringRows();
  el.editorDialog.showModal();
}

function renderStringRows() {
  const n = draft.strings.length;
  el.stringRows.replaceChildren(
    ...draft.strings.map((note, i) => {
      const li = document.createElement('li');
      li.className = 'string-row';
      const label = document.createElement('span');
      label.className = 'string-num';
      label.textContent = String(i + 1);
      const down = stepBtn('−', t('noteDown', { n: i + 1 }), () => setString(i, stepNote(draft.strings[i], -1)));
      const sel = document.createElement('select');
      sel.className = 'note-select';
      sel.setAttribute('aria-label', t('stringN', { n: i + 1 }));
      sel.replaceChildren(...ALL_NOTES.map((nn) => new Option(prettyNote(nn), nn)));
      sel.value = note;
      sel.addEventListener('change', () => setString(i, sel.value));
      const up = stepBtn('+', t('noteUp', { n: i + 1 }), () => setString(i, stepNote(draft.strings[i], 1)));
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'icon-btn remove-btn';
      rm.setAttribute('aria-label', t('removeString', { n: i + 1 }));
      rm.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>';
      rm.disabled = n <= STRING_COUNT_RANGE.min;
      rm.addEventListener('click', () => {
        draft.strings.splice(i, 1);
        renderStringRows();
      });
      li.append(label, down, sel, up, rm);
      return li;
    }),
  );
  const full = n >= STRING_COUNT_RANGE.max;
  el.addLow.disabled = full;
  el.addHigh.disabled = full;
  el.editorName.placeholder = defaultCustomName(draft.strings);
}

function stepBtn(text: string, label: string, fn: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'step note-step';
  b.textContent = text;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', fn);
  return b;
}

function setString(i: number, note: string) {
  draft.strings[i] = note;
  renderStringRows();
}

function saveEditor() {
  if (!draft.strings.length) return;
  const name = (el.editorName.value.trim() || defaultCustomName(draft.strings)).slice(0, CUSTOM_NAME_MAX);
  const list = settings.customTunings;
  const id = draft.id ?? newCustomId(list);
  const tuning: CustomTuning = { id, instrumentId: instrumentId(), name, strings: [...draft.strings], custom: true };
  settings.customTunings = draft.id ? list.map((c) => (c.id === id ? tuning : c)) : [...list, tuning];
  el.editorDialog.close();
  selectTuning(id); // also saves
  showToast(t('tuningSaved', { name }));
}

function deleteEdited() {
  if (!draft.id) return;
  if (!deleteArmed) {
    deleteArmed = true;
    el.editorDelete.textContent = t('deleteConfirm');
    return;
  }
  const gone = settings.customTunings.find((c) => c.id === draft.id);
  settings.customTunings = settings.customTunings.filter((c) => c.id !== draft.id);
  el.editorDialog.close();
  if (currentTuning().id === draft.id || settings.tunings[instrumentId()] === draft.id) selectTuning('standard');
  else persist();
  if (gone) showToast(t('tuningDeleted', { name: gone.name }));
}

function wireTunings() {
  el.tuningBtn.addEventListener('click', openTuningPicker);
  el.newTuningBtn.addEventListener('click', () => {
    el.tuningDialog.close();
    openEditor(null);
  });
  el.addLow.addEventListener('click', () => {
    draft.strings.unshift(extraString(draft.strings, 'low'));
    renderStringRows();
  });
  el.addHigh.addEventListener('click', () => {
    draft.strings.push(extraString(draft.strings, 'high'));
    renderStringRows();
  });
  el.editorForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    saveEditor();
  });
  el.editorCancel.addEventListener('click', () => el.editorDialog.close());
  el.editorClose.addEventListener('click', () => el.editorDialog.close());
  el.editorDelete.addEventListener('click', deleteEdited);
  for (const d of [el.tuningDialog, el.editorDialog]) {
    d.addEventListener('click', (ev) => {
      if (ev.target === d) d.close();
    });
  }
}

// ---------- music stand view ----------

let standHintTimer: number | undefined;

async function enterStand() {
  if (!engine) await startMic();
  if (!engine) return; // the mic could not start; the error shows on the main screen
  el.stand.hidden = false;
  el.standHint.classList.remove('faded');
  window.clearTimeout(standHintTimer);
  standHintTimer = window.setTimeout(() => el.standHint.classList.add('faded'), 3000);
  const root = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
  // Full screen where the browser allows it (desktop, Android); iPhone ignores it.
  if (root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
}

function exitStand() {
  el.stand.hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function renderStand(r: Reading | null, active: boolean) {
  const tol = settings.toleranceCents;
  el.standZone.style.left = `${50 - tol}%`;
  el.standZone.style.width = `${2 * tol}%`;
  let dir: 'none' | 'up' | 'down' | 'in' = 'none';
  if (active && r) {
    const n = splitNote(r.targetName);
    el.standLetter.textContent = n.letter;
    el.standAcc.textContent = n.acc;
    el.standOct.textContent = n.oct;
    dir = r.inTune ? 'in' : r.cents < 0 ? 'up' : 'down';
    el.standDirText.textContent = r.inTune ? t('inTune') : r.cents < 0 ? t('tuneUp') : t('tuneDown');
    const c = Math.round(r.cents);
    el.standCents.textContent = c === 0 ? '0' : `${c > 0 ? '+' : '−'}${Math.abs(c)}`;
    el.standMark.style.left = `${50 + clamp(r.cents, -50, 50)}%`;
  } else {
    el.standLetter.textContent = lastLetter() ?? '';
    el.standAcc.textContent = '';
    el.standOct.textContent = '';
    el.standDirText.textContent = isChromatic() ? t('playNote') : t('playString');
    el.standCents.textContent = '';
    el.standMark.style.left = '50%';
  }
  el.stand.dataset.dir = dir;
  el.stand.dataset.held = String(!!r?.held);
  el.standLive.textContent = el.live.textContent;
}

function wireStand() {
  el.standBtn.addEventListener('click', () => void enterStand());
  el.stand.addEventListener('click', exitStand);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !el.stand.hidden) exitStand();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !el.stand.hidden) el.stand.hidden = true;
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
  if (!el.stand.hidden) renderStand(r, active);

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
wireTunings();
wireStand();
renderTuningButton();
el.startBtn.addEventListener('click', () => void startMic());
el.stopBtn.addEventListener('click', stopMic);
requestAnimationFrame(loop);

// Expose a hook for automated browser tests (feeds synthetic audio).
declare global {
  interface Window {
    __tuner?: {
      feed(block: Float32Array): void;
      start(sampleRate: number): void;
      renderReference(instrumentId: string, note: string, a4: number): Promise<{ sampleRate: number; samples: number[]; kind: string }>;
    };
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
  async renderReference(instrumentId: string, note: string, a4: number) {
    const p = ensurePlayer();
    const midi = nameToMidi(note);
    const x = await p.render(instrumentId, midi, a4);
    const { chooseSource } = await import('./audio/reference-source');
    return { sampleRate: p.sampleRate, samples: Array.from(x), kind: chooseSource(instrumentId, midi, a4).kind };
  },
};
