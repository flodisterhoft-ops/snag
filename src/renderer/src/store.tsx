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
  SettingsSection,
  StorageStatus,
  ToolStatus,
  ProgressUpdate,
  UpdateAvailability
} from '@shared/types'
import { applyProgressUpdate, removeFinishedJobs, removeJobById, reorderJobs as reorderJobList } from './jobState'

export type View = 'home' | 'queue' | 'settings'

// A single browser handoff. The seq distinguishes repeat handoffs of the same
// URL so effect consumers keyed on it re-fire for every click.
export interface Handoff {
  url: string
  seq: number
}

interface Store {
  ready: boolean
  startupError: string | null
  retryStartup: () => Promise<void>
  view: View
  setView: (v: View) => void
  // Which Settings tab is showing; openSettings() jumps straight to one.
  settingsSection: SettingsSection
  setSettingsSection: (section: SettingsSection) => void
  openSettings: (section?: SettingsSection) => void
  settings: Settings | null
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  jobs: DownloadJob[]
  reorderJobs: (ids: string[]) => Promise<void>
  clearFinished: () => Promise<void>
  removeJob: (id: string) => Promise<void>
  deleteJobFile: (id: string) => Promise<{ ok: boolean; error?: string }>
  deleteCompletedFiles: () => Promise<{ deletedIds: string[]; errors: string[] }>
  activeCount: number
  toolStatus: ToolStatus | null
  refreshTools: () => Promise<void>
  appVersion: string | null
  // Where this process's files really go; redirected when a packaged parent
  // app sandboxed Snag (see SandboxNotice).
  storage: StorageStatus | null
  // URL handed off from the browser via snag://, waiting to be analyzed.
  // Each handoff carries a unique seq so consumers re-fire even when the same
  // URL is handed off twice in a row.
  handoff: Handoff | null
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
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [storage, setStorage] = useState<StorageStatus | null>(null)
  const [handoffs, setHandoffs] = useState<Handoff[]>([])
  const handoffSeq = useRef(0)
  const [updates, setUpdates] = useState<UpdateAvailability | null>(null)
  const jobsRef = useRef<DownloadJob[]>([])
  jobsRef.current = jobs

  const initialize = useCallback(async (): Promise<void> => {
    setReady(false)
    setStartupError(null)
    const [settingsResult, jobsResult, toolsResult, versionResult, storageResult] =
      await Promise.allSettled([
        window.api.getSettings(),
        window.api.getJobs(),
        window.api.getToolStatus(),
        window.api.getAppVersion(),
        window.api.getStorageStatus()
      ])

    if (versionResult.status === 'fulfilled') setAppVersion(versionResult.value)
    else console.error('Failed to read app version:', versionResult.reason)

    if (storageResult.status === 'fulfilled') setStorage(storageResult.value)
    else console.error('Failed to read the storage status:', storageResult.reason)

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

    // Register push listeners before telling main that this renderer is ready.
    // Keep a FIFO locally too, so rapid browser clicks are not collapsed into a
    // single React state update.
    const receiveUrl = (url: string): void => {
      if (!mounted || !url) return
      handoffSeq.current += 1
      setHandoffs((prev) => [...prev, { url, seq: handoffSeq.current }])
      setView('home')
    }
    const offExternal = window.api.onExternalUrl(receiveUrl)
    const openSettingsAt = (section: SettingsSection): void => {
      if (!mounted) return
      setSettingsSection(section)
      setView('settings')
    }
    const offOpenSettings = window.api.onOpenSettings(openSettingsAt)
    const offUpdates = window.api.onUpdateAvailable((u: UpdateAvailability) => {
      if (mounted) setUpdates(u)
    })
    const offTools = window.api.onToolsChanged(() => {
      if (mounted) void window.api.getToolStatus().then(setToolStatus).catch(() => {})
    })

    void window.api.consumePendingExternalUrl().then((url) => {
      if (url) receiveUrl(url)
    })
    void window.api.consumePendingOpenSettings().then((section) => {
      if (section) openSettingsAt(section)
    })

    return () => {
      mounted = false
      offAdded()
      offProgress()
      offExternal()
      offOpenSettings()
      offUpdates()
      offTools()
    }
  }, [initialize])

  const reorderJobs = async (ids: string[]): Promise<void> => {
    setJobs((prev) => reorderJobList(prev, ids))
    await window.api.reorderJobs(ids)
  }

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

  const deleteJobFile = async (id: string): Promise<{ ok: boolean; error?: string }> => {
    const result = await window.api.deleteJobFile(id)
    if (result.ok) setJobs((prev) => removeJobById(prev, id))
    return result
  }

  const deleteCompletedFiles = async (): Promise<{ deletedIds: string[]; errors: string[] }> => {
    const result = await window.api.deleteCompletedFiles()
    if (result.deletedIds.length) {
      const deleted = new Set(result.deletedIds)
      setJobs((prev) => prev.filter((job) => !deleted.has(job.id)))
    }
    return result
  }

  const activeCount = useMemo(
    () => jobs.filter((j) => j.status === 'downloading' || j.status === 'processing' || j.status === 'queued' || j.status === 'paused').length,
    [jobs]
  )

  const value: Store = {
    ready,
    startupError,
    retryStartup: initialize,
    view,
    setView,
    settingsSection,
    setSettingsSection,
    openSettings: (section = 'general') => {
      setSettingsSection(section)
      setView('settings')
    },
    settings,
    updateSettings,
    jobs,
    reorderJobs,
    clearFinished,
    removeJob,
    deleteJobFile,
    deleteCompletedFiles,
    activeCount,
    toolStatus,
    refreshTools,
    appVersion,
    storage,
    handoff: handoffs[0] ?? null,
    clearHandoffUrl: () => setHandoffs((prev) => prev.slice(1)),
    updates,
    setUpdates
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
