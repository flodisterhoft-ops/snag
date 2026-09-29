export const CONVERSION_FORMATS = [
  { id: 'mp3', label: 'MP3', kind: 'audio', description: 'Plays on everything' },
  { id: 'm4a', label: 'M4A', kind: 'audio', description: 'AAC, smaller than MP3 at the same quality' },
  { id: 'wav', label: 'WAV', kind: 'audio', description: 'Uncompressed, for editing; large files' },
  { id: 'flac', label: 'FLAC', kind: 'audio', description: 'Lossless, about half the size of WAV' },
  { id: 'ogg', label: 'OGG', kind: 'audio', description: 'Vorbis, an open format' },
  { id: 'opus', label: 'Opus', kind: 'audio', description: 'Best sound for the size, in modern players' },
  { id: 'mp4', label: 'MP4', kind: 'video', description: 'H.264, plays everywhere' },
  { id: 'mkv', label: 'MKV', kind: 'video', description: 'H.264 in Matroska, keeps every audio track' },
  { id: 'mov', label: 'MOV', kind: 'video', description: 'H.264 for QuickTime and Apple editors' },
  { id: 'webm', label: 'WebM', kind: 'video', description: 'VP9 for the web, slow to convert' }
] as const

export type ConversionFormat = (typeof CONVERSION_FORMATS)[number]['id']
export interface ConversionRequest {
  paths: string[]
  format: ConversionFormat
  // Empty means save beside each source.
  saveDir: string
}
export interface ConversionJob {
  id: string
  source: string
  format: ConversionFormat
  saveDir: string
  status: 'queued' | 'converting' | 'completed' | 'cancelled' | 'error'
  progress: number | null
  output: string | null
  error: string | null
  // How the main stream (the video, or the audio for audio formats) is
  // written: 'copy' repacks it untouched, 'encode' converts it. Null until
  // the source has been read.
  method?: 'copy' | 'encode' | null
  outputSize?: number | null
}
