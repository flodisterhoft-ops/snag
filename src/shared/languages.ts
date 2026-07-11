// Minimal ISO-639 language-code → English display-name map for the codes
// yt-dlp commonly emits on audio tracks and subtitles. Falls back gracefully.

const NAMES: Record<string, string> = {
  en: 'English',
  'en-us': 'English (US)',
  'en-gb': 'English (UK)',
  es: 'Spanish',
  'es-419': 'Spanish (Latin America)',
  'es-us': 'Spanish (US)',
  pt: 'Portuguese',
  'pt-br': 'Portuguese (Brazil)',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  uk: 'Ukrainian',
  tr: 'Turkish',
  ar: 'Arabic',
  he: 'Hebrew',
  hi: 'Hindi',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  'zh-hans': 'Chinese (Simplified)',
  'zh-hant': 'Chinese (Traditional)',
  'zh-cn': 'Chinese (China)',
  'zh-tw': 'Chinese (Taiwan)',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  fil: 'Filipino',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  fi: 'Finnish',
  cs: 'Czech',
  sk: 'Slovak',
  hu: 'Hungarian',
  ro: 'Romanian',
  el: 'Greek',
  bg: 'Bulgarian',
  hr: 'Croatian',
  sr: 'Serbian',
  fa: 'Persian',
  ur: 'Urdu',
  ka: 'Georgian'
}

export function languageLabel(code: string | null | undefined): string {
  if (!code) return 'Default'
  const lower = code.toLowerCase()
  if (NAMES[lower]) return NAMES[lower]
  const base = lower.split('-')[0]
  if (NAMES[base]) {
    const region = lower.slice(base.length + 1)
    return region ? `${NAMES[base]} (${region.toUpperCase()})` : NAMES[base]
  }
  return code.toUpperCase()
}
