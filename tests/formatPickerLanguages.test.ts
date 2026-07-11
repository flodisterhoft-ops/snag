import { describe, expect, it } from 'vitest'
import { initialLanguageKeys, matchedFavoriteKeys } from '../src/renderer/src/components/FormatPicker'
import type { MediaInfo, Settings } from '../src/shared/types'

const info = {
  id: 'video',
  hasMultipleAudioLanguages: true,
  audioGroups: [
    { language: 'de', languageLabel: 'German', isDefault: true, formats: [] },
    { language: 'en-US', languageLabel: 'English (US)', isDefault: false, formats: [] },
    { language: 'fr', languageLabel: 'French', isDefault: false, formats: [] }
  ]
} as MediaInfo

const settings = {
  multiAudio: { enabled: true, languages: ['en', 'de'] }
} as Settings

describe('audio language defaults', () => {
  it('ranks matched favorites in the saved order and selects all when enabled', () => {
    expect(matchedFavoriteKeys(info, settings)).toEqual(['en-US', 'de'])
    expect(initialLanguageKeys(info, settings)).toEqual(['en-US', 'de'])
  })

  it('selects only the top favorite when multi-audio is disabled', () => {
    expect(
      initialLanguageKeys(info, { ...settings, multiAudio: { enabled: false, languages: ['en', 'de'] } })
    ).toEqual(['en-US'])
  })

  it('prefers English over a non-English video default when no favorite matches', () => {
    expect(
      initialLanguageKeys(info, { ...settings, multiAudio: { enabled: true, languages: ['ja'] } })
    ).toEqual(['en-US'])
  })
})
