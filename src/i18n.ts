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
    'Chromatic mode names any note you play, for other instruments or alternate tunings.',
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
