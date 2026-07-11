import { describe, expect, it } from 'vitest'
import { compareVersions } from '../src/main/version'

describe('compareVersions', () => {
  it('compares app-style semver', () => {
    expect(compareVersions('1.2.0', '1.1.0')).toBe(1)
    expect(compareVersions('1.1.0', '1.2.0')).toBe(-1)
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
  })

  it('ignores a leading v', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('v1.3.0', 'v1.2.9')).toBe(1)
  })

  it('compares yt-dlp date versions with zero-padded parts', () => {
    expect(compareVersions('2026.07.04', '2026.07.04')).toBe(0)
    expect(compareVersions('2026.07.10', '2026.07.04')).toBe(1)
    expect(compareVersions('2026.07.04', '2026.12.30')).toBe(-1)
    expect(compareVersions('2027.01.01', '2026.12.30')).toBe(1)
  })

  it('treats missing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBe(1)
  })
})
