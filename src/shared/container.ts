import type { AudioFormat, VideoContainer, VideoFormat } from './types'

export const CONTAINER_CODEC_PATTERNS: Record<
  Exclude<VideoContainer, 'mkv'>,
  { video: string; audio: string }
> = {
  mp4: {
    video: '^(avc1|av01|h264|h265|hevc|hev1|hvc1)',
    audio: '^(mp4a|aac|ac-3|ec-3)'
  },
  webm: {
    video: '^(vp8|vp9|vp0?9|av01)',
    audio: '^(opus|vorbis)'
  }
}

function normalized(codec: string): string {
  return codec.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizedExt(ext: string): string {
  return ext.trim().toLowerCase().replace(/^\./, '')
}

const NATIVE_EXTENSIONS: Record<VideoContainer, ReadonlySet<string>> = {
  mp4: new Set(['mp4', 'm4v', 'mov', 'm4a']),
  webm: new Set(['webm', 'weba']),
  mkv: new Set(['mkv', 'mka', 'matroska'])
}

/** Whether a source is already stored in the selected output-container family. */
export function isNativeContainerSource(container: VideoContainer, ext: string): boolean {
  return NATIVE_EXTENSIONS[container].has(normalizedExt(ext))
}

export function isVideoCodecCompatible(container: VideoContainer, codec: string): boolean {
  if (container === 'mkv') return true
  const value = normalized(codec)
  if (container === 'mp4') {
    return /^(h264|avc1|h265|hevc|hev1|hvc1|av1|av01)/.test(value)
  }
  return /^(vp8|vp9|vp09|av1|av01)/.test(value)
}

export function isAudioCodecCompatible(container: VideoContainer, codec: string): boolean {
  if (container === 'mkv') return true
  const value = normalized(codec)
  if (container === 'mp4') return /^(aac|mp4a|ac3|ec3)/.test(value)
  return /^(opus|vorbis)/.test(value)
}

// Renderer-facing compatibility check. Video-only rows do not carry their
// eventual audio codec, so only validate audio for progressive (muxed) rows.
// Sources with unknown codecs (X/Twitter's direct MP4 variants) count as
// compatible when they are already stored in the target container family.
export function isVideoFormatCompatible(
  container: VideoContainer,
  vcodec: string,
  acodec: string,
  progressive: boolean,
  ext = ''
): boolean {
  if (container === 'mkv') return true
  if (!vcodec) return isNativeContainerSource(container, ext)
  return (
    isVideoCodecCompatible(container, vcodec) &&
    (!progressive || !acodec || acodec === 'none' || isAudioCodecCompatible(container, acodec))
  )
}

/**
 * Pick audio that can be muxed into the selected output without transcoding.
 * Prefer a native source container (M4A for MP4, WebM for WebM), then bitrate.
 * Unknown audio codecs (X/Twitter HLS renditions) pass when the source is
 * already in the target container family.
 */
export function findCompatibleAudioFormat(
  container: VideoContainer,
  formats: AudioFormat[]
): AudioFormat | null {
  return (
    formats
      .filter(
        (format) =>
          !!format.formatId &&
          (format.acodec
            ? isAudioCodecCompatible(container, format.acodec)
            : container === 'mkv' || isNativeContainerSource(container, format.ext))
      )
      .map((format, index) => ({ format, index }))
      .sort((a, b) => {
        const nativeDifference =
          Number(isNativeContainerSource(container, b.format.ext)) -
          Number(isNativeContainerSource(container, a.format.ext))
        if (nativeDifference !== 0) return nativeDifference
        const bitrateDifference = (b.format.abr ?? 0) - (a.format.abr ?? 0)
        return bitrateDifference || a.index - b.index
      })[0]?.format ?? null
  )
}

function renditionKey(format: VideoFormat): string {
  // Source extension and codec are intentionally absent: they are alternate
  // encodings of the same user-visible quality. HDR/SDR and frame-rate choices
  // remain separate because they materially change the downloaded video.
  return [
    format.width ?? 0,
    format.height ?? 0,
    format.fps ?? 0,
    format.dynamicRange ?? 'SDR',
    format.height ? '' : format.qualityLabel
  ].join('|')
}

/**
 * Formats that can become the chosen output container without re-encoding.
 *
 * MP4 and WebM prefer source rows already in that container. A compatible
 * remux source remains only when the same resolution/FPS/HDR rendition has no
 * native alternative, which keeps uncommon high-quality tiers (including 4K)
 * visible. MKV is deliberately permissive and shows every muxable source.
 */
export function filterVideoFormatsForContainer(
  container: VideoContainer,
  videoFormats: VideoFormat[],
  audioFormats: AudioFormat[]
): VideoFormat[] {
  const mergeAudio = findCompatibleAudioFormat(container, audioFormats)
  const compatible = videoFormats.filter(
    (format) =>
      isVideoFormatCompatible(
        container,
        format.vcodec,
        format.acodec,
        format.isProgressive,
        format.ext
      ) && (format.isProgressive || !!mergeAudio)
  )

  if (container === 'mkv') return compatible

  const renditionsWithNativeSource = new Set(
    compatible
      .filter((format) => isNativeContainerSource(container, format.ext))
      .map(renditionKey)
  )

  return compatible.filter(
    (format) =>
      isNativeContainerSource(container, format.ext) ||
      !renditionsWithNativeSource.has(renditionKey(format))
  )
}

/** Label the original stream and make any remux explicit in the format table. */
export function formatContainerSource(container: VideoContainer, ext: string): string {
  const source = normalizedExt(ext).toUpperCase() || 'STREAM'
  return isNativeContainerSource(container, ext)
    ? source
    : `${source}\u2192${container.toUpperCase()}`
}
