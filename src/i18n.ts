// All user-facing text. To add a language, copy `en`, translate the values,
// and register it in LANGUAGES.

const en = {
  appTitle: 'Tuner',
  start: 'Start tuning',
  startHint: 'Your browser will ask to use the microphone.',
  stop: 'Stop',
  settings: 'Settings',
  help: 'How to use',
  close: 'Close',

  modeChromatic: 'Chromatic',

  playString: 'Play a string',
  playNote: 'Play a note',
  inTune: 'In tune',
  tuneUp: 'Tune up',
  tuneDown: 'Tune down',
  cents: '{n} cents',
  hz: '{n} Hz',

  autoHint: 'Tap a string to tune only that one.',
  lockedHint: 'Tuning {note} only. Tap it again to detect strings automatically.',
  playReference: 'Play {note}',
  stringTuned: '{note} is in tune',

  inputLevel: 'Input level',
  clarity: 'Signal clarity',
  tooQuiet: 'Too quiet. Move closer to the microphone.',

  referencePitch: 'Reference pitch',
  referencePitchHint: 'A4 frequency. Most music uses 440 Hz.',
  tolerance: 'In-tune range',
  toleranceHint: 'How close a note must be to count as in tune.',
  plusMinusCents: '±{n} cents',
  microphone: 'Microphone',
  microphoneDefault: 'Default microphone',
  theme: 'Appearance',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  resetTuned: 'Clear tuned strings',
  input: 'Input',
  channel: 'Channel',
  channelMix: 'All channels',
  channelN: 'Input {n}',
  offlineReady: 'Ready to use offline.',
  updateReady: 'A new version is ready.',
  update: 'Update',
  saveClip: 'Save the last 10 seconds',
  saveClipHint: 'If the tuner shows something wrong, save right after it happens and send the file to the developer. It contains the sound and the tuner’s settings.',
  clipNeedsAudio: 'Start tuning first, then save right after the problem.',
  clipSaved: 'Saved {file}.',
  version: 'Version {v}',

  tuning: 'Tuning',
  yourTunings: 'Your tunings',
  newTuning: 'New tuning',
  editTuning: 'Edit tuning',
  editNamed: 'Edit {name}',
  tuningNameLabel: 'Name',
  stringsLabel: 'Strings',
  stringsHint: 'In the same order as on the tuner. Tap a note to pick it, or use − and + for a semitone.',
  stringN: 'String {n}',
  noteDown: 'Lower string {n} by a semitone',
  noteUp: 'Raise string {n} by a semitone',
  removeString: 'Remove string {n}',
  addLowString: 'Add a string before',
  addHighString: 'Add a string after',
  save: 'Save',
  cancel: 'Cancel',
  deleteTuning: 'Delete',
  deleteConfirm: 'Tap again to delete',
  tuningSaved: 'Saved “{name}”.',
  tuningDeleted: 'Deleted “{name}”.',

  standView: 'Stand view',
  standViewLabel: 'Music stand view: large display you can read from a distance',
  standHint: 'Tap anywhere to close',
  lower: 'Lower',
  higher: 'Higher',

  errDenied: 'Microphone access is blocked. Allow it in your browser’s site settings, then tap Start tuning.',
  errNoDevice: 'No microphone was found. Connect one and tap Start tuning.',
  errInsecure: 'The microphone only works on https:// pages. Open the tuner from its https link.',
  errUnsupported: 'This browser can’t process microphone audio. Try a current Chrome, Firefox, Edge or Safari.',
  errOther: 'The microphone could not start: {msg}',

  helpBody: [
    'Tap Start tuning and allow the microphone.',
    'Choose your instrument, then play one string at a time. The tuner finds the nearest string on its own.',
    'The needle shows how far off you are. Left of centre is flat: tighten the string. Right is sharp: loosen it.',
    'When the note turns green you are within the in-tune range, and the string gets a green mark.',
    'To tune a single string, tap it. Tap Play to hear its pitch.',
    'Tap the tuning under the instrument tabs to switch to Drop D, open tunings and more, or make your own.',
    'Stand view fills the screen with the note, an arrow and colour you can read from a few metres away. Tap anywhere to close it.',
    'Chromatic mode names any note you play, for other instruments or alternate tunings.',
    'Using an audio interface? Pick it under the needle once tuning has started, and choose the input your instrument is plugged into.',
    'To keep the tuner on your phone: in Safari tap Share, then Add to Home Screen. On a computer, use the install icon in Chrome or Edge’s address bar. After opening it once with internet, it works offline.',
  ],
};

export type Strings = typeof en;
export const LANGUAGES: Record<string, Strings> = { en };

let current: Strings = en;

export function setLanguage(code: string): void {
  current = LANGUAGES[code] ?? en;
}

type StringKey = { [K in keyof Strings]: Strings[K] extends string ? K : never }[keyof Strings];

export function t(key: StringKey, vars: Record<string, string | number> = {}): string {
  return current[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export function tList(key: 'helpBody'): string[] {
  return current[key];
}
