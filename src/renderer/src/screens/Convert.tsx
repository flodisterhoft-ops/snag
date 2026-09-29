import { useEffect, useState } from 'react'
import { CONVERSION_FORMATS, type ConversionFormat, type ConversionJob } from '@shared/conversion'
import { formatBytes } from '@shared/format'
import { useStore } from '../store'
import { Icon, Segmented, Spinner } from '../components/ui'

type Kind = 'audio' | 'video'

const AUDIO_FILE = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|wma|aiff?|alac|amr|mka)$/i
const RECOMMENDED: Record<Kind, ConversionFormat> = { audio: 'mp3', video: 'mp4' }
const STATUS_LABEL: Record<ConversionJob['status'], string> = {
  queued: 'Queued',
  converting: 'Converting',
  completed: 'Completed',
  error: 'Failed',
  cancelled: 'Canceled'
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path
const extension = (path: string): string => /\.([^.\\/]+)$/.exec(path)?.[1]?.toUpperCase() ?? 'FILE'
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const formatOf = (id: ConversionFormat): (typeof CONVERSION_FORMATS)[number] =>
  CONVERSION_FORMATS.find((f) => f.id === id)!

export function Convert({ visible }: { visible: boolean }): JSX.Element {
  const { toolStatus, setView, openSettings } = useStore()
  const [paths, setPaths] = useState<string[]>([])
  const [kind, setKind] = useState<Kind>('audio')
  const [format, setFormat] = useState<ConversionFormat>('mp3')
  const [saveDir, setSaveDir] = useState('')
  const [jobs, setJobs] = useState<ConversionJob[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const addFiles = (incoming: string[]): void => {
    if (!incoming.length) return
    setPaths((previous) => [...new Set([...previous, ...incoming])])
    setError('')
  }

  // Catch OS file drops anywhere in the main window, including the Download tab.
  useEffect(() => {
    const over = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDragging(true)
    }
    const leave = (event: DragEvent): void => {
      if (!event.relatedTarget) setDragging(false)
    }
    const drop = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      setDragging(false)
      setView('convert')
      try {
        const incoming = Array.from(event.dataTransfer.files)
          .map((file) => window.api.pathForFile(file))
          .filter(Boolean)
        if (!incoming.length) throw new Error('Drop files from your computer, or use Choose files.')
        addFiles(incoming)
      } catch (error) {
        setError(message(error))
      }
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [setView])

  useEffect(() => {
    if (!visible) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async (): Promise<void> => {
      try {
        const next = await window.api.getConversions()
        if (!stopped) setJobs(next)
      } catch (error) {
        if (!stopped) setError(message(error))
      }
      if (!stopped) timer = setTimeout(() => void refresh(), 750)
    }
    void refresh()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [visible])

  // Audio files have no picture to turn into a video.
  const onlyAudio = paths.length > 0 && paths.every((path) => AUDIO_FILE.test(path))
  useEffect(() => {
    if (onlyAudio && kind === 'video') {
      setKind('audio')
      setFormat(RECOMMENDED.audio)
    }
  }, [onlyAudio, kind])

  const chooseKind = (next: Kind): void => {
    setKind(next)
    setFormat(RECOMMENDED[next])
  }
  const chooseFiles = async (): Promise<void> => {
    try {
      addFiles(await window.api.pickConversionFiles())
    } catch (error) {
      setError(message(error))
    }
  }
  const chooseFolder = async (): Promise<void> => {
    try {
      const dir = await window.api.pickFolder(saveDir)
      if (dir) setSaveDir(dir)
    } catch (error) {
      setError(message(error))
    }
  }
  const start = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const submitted = [...paths]
      await window.api.convert({ paths: submitted, format, saveDir })
      setPaths((current) => current.filter((path) => !submitted.includes(path)))
      setJobs(await window.api.getConversions())
    } catch (error) {
      setError(message(error))
    } finally {
      setBusy(false)
    }
  }
  const action = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      const result = await work()
      if (typeof result === 'string' && result) setError(result)
      setJobs(await window.api.getConversions())
    } catch (error) {
      setError(message(error))
    }
  }

  const selected = formatOf(format)
  const finished = jobs.filter((job) => job.status !== 'queued' && job.status !== 'converting').length
  const count = `${paths.length} ${paths.length === 1 ? 'file' : 'files'}`

  return (
    <div className="screen convert-screen">
      <header className="screen-head row">
        <div>
          <h1 className="screen-title">Convert</h1>
          <p className="screen-desc">Change a video&apos;s format or pull out its audio. Everything stays on your PC.</p>
        </div>
        {finished > 0 && (
          <div className="queue-actions">
            <button className="btn-ghost" onClick={() => void action(() => window.api.clearConversions())}>
              <Icon name="close" size={15} /> Clear finished
            </button>
          </div>
        )}
      </header>

      {!toolStatus?.ffmpegFound && (
        <div className="queue-error convert-alert" role="alert">
          FFmpeg is missing, so nothing can be converted.
          <button className="btn-mini ghost" onClick={() => openSettings('engine')}>
            Open Engine settings
          </button>
        </div>
      )}

      <div className={`convert-drop ${dragging ? 'dragging' : ''} ${paths.length ? 'compact' : ''}`}>
        <span className="convert-drop-icon">
          <Icon name="convert" size={paths.length ? 18 : 24} />
        </span>
        <div className="convert-drop-text">
          <strong>{paths.length ? 'Add more files' : 'Drop video or audio files here'}</strong>
          <span>Or anywhere in this window. The originals are never changed.</span>
        </div>
        <button className="btn-ghost" onClick={() => void chooseFiles()}>
          <Icon name="folder" size={15} /> Choose files
        </button>
      </div>

      {paths.length > 0 && (
        <section className="settings-section convert-setup">
          <div className="section-body">
            <div className="set-row stacked convert-files">
              <div className="convert-files-head">
                <span className="set-row-title">{count}</span>
                <button className="btn-mini ghost" disabled={busy} onClick={() => setPaths([])}>
                  Clear
                </button>
              </div>
              <ul>
                {paths.map((path) => (
                  <li key={path}>
                    <Icon name={AUDIO_FILE.test(path) ? 'audio' : 'video'} size={15} />
                    <span className="convert-file-name" title={path}>
                      {baseName(path)}
                    </span>
                    <button
                      className="icon-btn"
                      title="Remove from the list"
                      aria-label={`Remove ${baseName(path)}`}
                      disabled={busy}
                      onClick={() => setPaths((current) => current.filter((item) => item !== path))}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="set-row">
              <div className="set-row-text">
                <span className="set-row-title">Turn into</span>
                <span className="set-row-desc">
                  {kind === 'audio' ? 'Just the sound, from the first audio track.' : 'A video file with every audio track.'}
                </span>
              </div>
              <div className="set-row-control">
                <Segmented
                  size="sm"
                  options={[
                    { value: 'audio', label: 'Audio', hint: 'Keep only the sound' },
                    {
                      value: 'video',
                      label: 'Video',
                      disabled: onlyAudio,
                      hint: onlyAudio ? 'Audio files have no picture to make a video from' : 'Change the video format'
                    }
                  ]}
                  value={kind}
                  onChange={(v) => chooseKind(v as Kind)}
                />
              </div>
            </div>
            <div className="set-row">
              <div className="set-row-text">
                <span className="set-row-title">Format</span>
                <span className="set-row-desc">
                  {selected.description}. Streams that already fit are repacked in seconds, without quality loss.
                </span>
              </div>
              <div className="set-row-control">
                <Segmented
                  size="sm"
                  options={CONVERSION_FORMATS.filter((f) => f.kind === kind).map((f) => ({
                    value: f.id,
                    label: f.label,
                    hint: f.description,
                    recommended: f.id === RECOMMENDED[kind]
                  }))}
                  value={format}
                  onChange={(v) => setFormat(v as ConversionFormat)}
                />
              </div>
            </div>
            <div className="set-row">
              <div className="set-row-text">
                <span className="set-row-title">Save to</span>
                <span className={`set-row-desc ${saveDir ? 'convert-path' : ''}`} title={saveDir || undefined}>
                  {saveDir || 'Next to each original file'}
                </span>
              </div>
              <div className="set-row-control convert-save-buttons">
                {saveDir && (
                  <button className="btn-mini ghost" onClick={() => setSaveDir('')}>
                    Next to originals
                  </button>
                )}
                <button className="btn-ghost" onClick={() => void chooseFolder()}>
                  <Icon name="folder" size={15} /> Change
                </button>
              </div>
            </div>
            <div className="convert-go">
              <button
                className="btn-accent"
                disabled={busy || !toolStatus?.ffmpegFound}
                onClick={() => void start()}
              >
                {busy ? <Spinner size={16} /> : <Icon name="convert" size={16} />}
                Convert {count} to {selected.label}
              </button>
            </div>
          </div>
        </section>
      )}

      {error && (
        <div className="queue-error convert-alert" role="alert">
          {error}
        </div>
      )}

      {jobs.length > 0 && (
        <section className="convert-results" aria-label="Conversions">
          <h2 className="section-title">Conversions</h2>
          <div className="job-list">
            {jobs.map((job) => (
              <ConversionCard key={job.id} job={job} onAction={(work) => void action(work)} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ConversionCard({
  job,
  onAction
}: {
  job: ConversionJob
  onAction: (work: () => Promise<unknown>) => void
}): JSX.Element {
  const target = formatOf(job.format)
  const running = job.status === 'converting'
  const waiting = job.status === 'queued'
  const tone = running ? 'processing' : job.status === 'cancelled' ? 'canceled' : job.status
  const pct = job.progress === null ? null : Math.floor(job.progress)
  const size = job.outputSize ? formatBytes(job.outputSize) : null

  return (
    <div className={`job-card convert-card ${tone}`}>
      <div className="job-thumb">
        <div className="job-thumb-fallback">
          <Icon name={target.kind === 'audio' ? 'audio' : 'video'} size={20} />
        </div>
        <span className="job-kind">
          <Icon name="convert" size={12} />
        </span>
      </div>

      <div className="job-body">
        <div className="job-top">
          <span className="job-title" title={job.source}>
            {baseName(job.source)}
          </span>
        </div>
        <div className="job-selection">
          {extension(job.source)} → {target.label}
          {job.method === 'copy' && <span className="job-extras"> · repacked, no quality loss</span>}
        </div>
        {running && (
          <div className="progress">
            <div
              className={`progress-bar ${pct === null ? 'indeterminate' : ''}`}
              style={{ width: pct === null ? '100%' : `${pct}%` }}
            />
          </div>
        )}
        <div className="job-meta">
          {running && (
            <>
              {pct !== null && <span className="job-pct">{pct}%</span>}
              <span className="dim">{job.method === 'copy' ? 'Repacking…' : job.method ? 'Converting…' : 'Reading the file…'}</span>
            </>
          )}
          {waiting && <span className="dim">Waiting in queue…</span>}
          {job.status === 'completed' && job.output && (
            <>
              <span className="dim convert-output" title={job.output}>
                {baseName(job.output)}
              </span>
              {size && <span className="dim">{size}</span>}
            </>
          )}
          {job.status === 'error' && <span className="job-error">{job.error}</span>}
          {job.status === 'cancelled' && <span className="dim">Conversion canceled</span>}
        </div>
      </div>

      <div className="job-actions">
        <span className={`job-status ${tone}`}>
          {job.status === 'completed' && <Icon name="check" size={13} />}
          {job.status === 'error' && <Icon name="alert" size={13} />}
          {STATUS_LABEL[job.status]}
        </span>
        <div className="job-buttons">
          {(running || waiting) && (
            <button
              className="icon-btn danger"
              title="Cancel"
              onClick={() => onAction(() => window.api.cancelConversion(job.id))}
            >
              <Icon name="close" size={16} />
            </button>
          )}
          {job.status === 'completed' && job.output && (
            <>
              <button className="icon-btn accent" title="Open" onClick={() => onAction(() => window.api.openPath(job.output!))}>
                <Icon name="play" size={16} />
              </button>
              <button
                className="icon-btn"
                title={`Show in folder\n${job.output}`}
                onClick={() => onAction(() => window.api.showInFolder(job.output!))}
              >
                <Icon name="folder" size={16} />
              </button>
            </>
          )}
          {(job.status === 'error' || job.status === 'cancelled') && (
            <button
              className="icon-btn"
              title="Try again"
              onClick={() =>
                onAction(() => window.api.convert({ paths: [job.source], format: job.format, saveDir: job.saveDir }))
              }
            >
              <Icon name="retry" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
