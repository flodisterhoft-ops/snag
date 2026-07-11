import { ReactNode } from 'react'

type IconName =
  | 'download'
  | 'queue'
  | 'settings'
  | 'paste'
  | 'folder'
  | 'video'
  | 'audio'
  | 'subtitle'
  | 'close'
  | 'retry'
  | 'check'
  | 'alert'
  | 'open'
  | 'trash'
  | 'chevron'
  | 'link'
  | 'spinner'
  | 'sparkle'

const PATHS: Record<IconName, ReactNode> = {
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  queue: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h10" />
      <path d="M18 6h2" />
      <circle cx="16" cy="6" r="2" />
      <path d="M4 12h2" />
      <path d="M10 12h10" />
      <circle cx="8" cy="12" r="2" />
      <path d="M4 18h10" />
      <path d="M18 18h2" />
      <circle cx="16" cy="18" r="2" />
    </>
  ),
  paste: (
    <>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
    </>
  ),
  folder: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="m17 9 4-2v10l-4-2" />
    </>
  ),
  audio: (
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </>
  ),
  subtitle: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15h5" />
      <path d="M15 15h2" />
      <path d="M7 11h2" />
      <path d="M12 11h5" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  retry: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </>
  ),
  check: <path d="m5 12 5 5L20 6" />,
  alert: (
    <>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </>
  ),
  open: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M9 7V4h6v3" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  link: (
    <>
      <path d="M9 15 15 9" />
      <path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1" />
      <path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1" />
    </>
  ),
  spinner: <path d="M12 3a9 9 0 1 0 9 9" />,
  sparkle: (
    <>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="m6 6 2.5 2.5" />
      <path d="m15.5 15.5 2.5 2.5" />
      <path d="m18 6-2.5 2.5" />
      <path d="m8.5 15.5-2.5 2.5" />
    </>
  )
}

export function Icon({
  name,
  size = 18,
  className
}: {
  name: IconName
  size?: number
  className?: string
}): JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

export function Spinner({ size = 16 }: { size?: number }): JSX.Element {
  return <Icon name="spinner" size={size} className="spin" />
}

interface SegOption<T extends string> {
  value: T
  label: ReactNode
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md'
}: {
  options: SegOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}): JSX.Element {
  return (
    <div className={`segmented ${size === 'sm' ? 'segmented-sm' : ''}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={`seg-btn ${value === o.value ? 'active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}): JSX.Element {
  return (
    <button
      className={`toggle ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      {label && <span className="sr-only">{label}</span>}
      <span className="toggle-knob" />
    </button>
  )
}
