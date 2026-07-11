import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode
} from 'react'
import type {
  DownloadJob,
  Settings,
  ToolStatus,
  ProgressUpdate,
  UpdateAvailability
} from '@shared/types'
import { applyProgressUpdate, removeFinishedJobs, removeJobById } from './jobState'

export type View = 'home' | 'queue' | 'settings'

interface Store {
  ready: boolean
  startupError: string | null
  retryStartup: () => Promise<void>
  view: View
  setView: (v: View) => void
  settings: Settings | null
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  jobs: DownloadJob[]
  clearFinished: () => Promise<void>
  removeJob: (id: string) => Promise<void>
  activeCount: number
  toolStatus: ToolStatus | null
  refreshTools: () => Promise<void>
  // URL handed off from the browser via snag://, waiting to be analyzed.
  handoffUrl: string | null
  clearHandoffUrl: () => void
  // Available updates (auto-check or manual), shown by the update banner.
  updates: UpdateAvailability | null
  setUpdates: (u: UpdateAvailability | null) => void
}

const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore must be used within StoreProvider')
  return s
}

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)
  const [view, setView] = useState<View>('home')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null)
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null)
  const [updates, setUpdates] = useState<UpdateAvailability | null>(null)
  const jobsRef = useRef<DownloadJob[]>([])
  jobsRef.current = jobs

  const initialize = useCallback(async (): Promise<void> => {
    setReady(false)
    setStartupError(null)
    const [settingsResult, jobsResult, toolsResult] = await Promise.allSettled([
      window.api.getSettings(),
      window.api.getJobs(),
      window.api.getToolStatus()
    ])

    if (settingsResult.status === 'fulfilled') {
      setSettings(settingsResult.value)
    } else {
      console.error('Failed to load settings:', settingsResult.reason)
      setStartupError('Snag could not load its settings. Please try again.')
    }

    if (jobsResult.status === 'fulfilled') setJobs([...jobsResult.value].reverse())
    else console.error('Failed to load downloads:', jobsResult.reason)

    if (toolsResult.status === 'fulfilled') setToolStatus(toolsResult.value)
    else console.error('Failed to check download tools:', toolsResult.reason)

    setReady(true)
  }, [])

  useEffect(() => {
    let mounted = true
    void initialize()

    const offAdded = window.api.onJobAdded((job: DownloadJob) => {
      setJobs((prev) => {
        if (prev.some((p) => p.id === job.id)) return prev
        return [job, ...prev]
      })
    })

    const offProgress = window.api.onProgress((u: ProgressUpdate) => {
      if (mounted) setJobs((prev) => applyProgressUpdate(prev, u))
    })

    // Browser handoff: pull the URL that may have arrived before this renderer
    // mounted, then listen for pushes while the window stays open.
    const receiveUrl = (url: string): void => {
      if (!mounted || !url) return
      setHandoffUrl(url)
      setView('home')
    }
    void window.api.consumePendingExternalUrl().then((url) => {
      if (url) receiveUrl(url)
    })
    const offExternal = window.api.onExternalUrl(receiveUrl)

    const offUpdates = window.api.onUpdateAvailable((u: UpdateAvailability) => {
      if (mounted) setUpdates(u)
    })

    return () => {
      mounted = false
      offAdded()
      offProgress()
      offExternal()
      offUpdates()
    }
  }, [initialize])

  const updateSettings = async (patch: Partial<Settings>): Promise<void> => {
    const next = await window.api.setSettings(patch)
    setSettings(next)
  }

  const refreshTools = async (): Promise<void> => {
    const t = await window.api.getToolStatus()
    setToolStatus(t)
  }

  const clearFinished = async (): Promise<void> => {
    await window.api.clearCompleted()
    setJobs((prev) => removeFinishedJobs(prev))
  }

  const removeJob = async (id: string): Promise<void> => {
    await window.api.removeJob(id)
    setJobs((prev) => removeJobById(prev, id))
  }

  const activeCount = useMemo(
    () => jobs.filter((j) => j.status === 'downloading' || j.status === 'processing' || j.status === 'queued').length,
    [jobs]
  )

  const value: Store = {
    ready,
    startupError,
    retryStartup: initialize,
    view,
    setView,
    settings,
    updateSettings,
    jobs,
    clearFinished,
    removeJob,
    activeCount,
    toolStatus,
    refreshTools,
    handoffUrl,
    clearHandoffUrl: () => setHandoffUrl(null),
    updates,
    setUpdates
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
