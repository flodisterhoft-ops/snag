import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type IconName =
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
  | 'info'
  | 'heart'
  | 'github'
  | 'share'
  | 'scissors'
  | 'play'
  | 'pause'
  | 'sun'

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
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  heart: (
    <path d="M12 20s-7-4.5-9.5-9A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9.5 5c-2.5 4.5-9.5 9-9.5 9z" />
  ),
  github: (
    <path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.6 6.8-4.2" />
      <path d="m8.6 13.4 6.8 4.2" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.1 15.9" />
      <path d="M14.5 14.5 20 20" />
      <path d="M8.1 8.1 12 12" />
    </>
  ),
  play: <path d="M7 4v16l13-8z" />,
  pause: (
    <>
      <path d="M8 5v14" />
      <path d="M16 5v14" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.3 17.7-1.4 1.4" />
      <path d="m19.1 4.9-1.4 1.4" />
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
  // Tooltip explaining the option, shown as soon as the pointer rests on it.
  hint?: string
  // Marks the option with a green star inside the button.
  recommended?: boolean
}

// Hover/focus tooltip for a segmented option: a small bubble above the button,
// rendered into document.body so section borders and scroll areas cannot clip
// it. Native title tooltips take a second to appear; this one is instant.
function SegTip({ text, anchor }: { text: string; anchor: HTMLElement }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  useLayoutEffect(() => {
    const tip = ref.current
    if (!tip) return
    const r = anchor.getBoundingClientRect()
    const width = tip.offsetWidth
    const margin = 8
    const left = Math.min(Math.max(margin, r.left + r.width / 2 - width / 2), window.innerWidth - width - margin)
    const above = r.top - tip.offsetHeight - 8
    setStyle(above >= margin ? { left, top: above } : { left, top: r.bottom + 8 })
  }, [anchor, text])
  return createPortal(
    <div ref={ref} className="seg-tip" role="tooltip" style={style}>
      {text}
    </div>,
    document.body
  )
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
  const [tip, setTip] = useState<{ text: string; anchor: HTMLElement } | null>(null)
  const show = (o: SegOption<T>, el: HTMLElement): void => {
    if (o.hint) setTip({ text: o.hint, anchor: el })
  }
  return (
    <div className={`segmented ${size === 'sm' ? 'segmented-sm' : ''}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={`seg-btn ${value === o.value ? 'active' : ''} ${o.recommended ? 'recommended' : ''}`}
          onClick={() => onChange(o.value)}
          onMouseEnter={(e) => show(o, e.currentTarget)}
          onMouseLeave={() => setTip(null)}
          onFocus={(e) => show(o, e.currentTarget)}
          onBlur={() => setTip(null)}
        >
          {o.recommended && (
            <svg className="seg-star" viewBox="0 0 24 24" aria-label="Recommended" role="img">
              <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" />
            </svg>
          )}
          {o.label}
        </button>
      ))}
      {tip && <SegTip text={tip.text} anchor={tip.anchor} />}
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

// Centered pop-up dialog with a dimmed backdrop. Closes on Esc, on backdrop
// click, and via the header's close button. `icon`/`title` render the header.
export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  size = 'md'
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  icon?: IconName
  children: ReactNode
  size?: 'sm' | 'md'
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal modal-${size} fade-up`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">
            {icon && <Icon name={icon} size={18} />}
            {title}
          </span>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// A whole-row checkbox: box on the left, icon + label + small hint, green when on.
export function CheckRow({
  checked,
  onChange,
  icon,
  label,
  hint
}: {
  checked: boolean
  onChange: () => void
  icon?: IconName
  label: string
  hint?: string
}): JSX.Element {
  return (
    <button
      className={`opt ${checked ? 'on' : ''}`}
      role="checkbox"
      aria-checked={checked}
      title={hint}
      onClick={onChange}
    >
      <span className="opt-box">
        <Icon name="check" size={12} />
      </span>
      {icon && <Icon name={icon} size={15} />}
      <span className="opt-text">
        <span className="opt-label">{label}</span>
        {hint && <span className="opt-hint">{hint}</span>}
      </span>
    </button>
  )
}

// Logos for the built-in share targets; custom apps bring their own icon.
export function AppIcon({
  kind,
  icon,
  size = 22
}: {
  kind: 'telegram' | 'windows' | 'custom' | 'add'
  icon?: string | null
  size?: number
}): JSX.Element {
  if (kind === 'custom' && icon) {
    return <img className="app-icon" src={icon} width={size} height={size} alt="" />
  }
  if (kind === 'telegram') {
    return (
      <svg className="app-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="#2AABEE" />
        <path
          d="M5.4 11.6l11.6-4.5c.5-.2 1 .1.8.9l-2 9.3c-.1.7-.6.8-1.1.5l-3-2.2-1.5 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5.1c.2-.2 0-.3-.3-.1l-7 4.4-3-.9c-.7-.2-.7-.7.3-.9z"
          fill="#fff"
        />
      </svg>
    )
  }
  if (kind === 'windows') {
    return (
      <svg className="app-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#0a5bd6" />
        <path d="M6 7.3l5-.7v5H6zM12 6.5l6-.9V11.6h-6zM6 12.4h5v5l-5-.7zM12 12.4h6v6l-6-.9z" fill="#fff" />
      </svg>
    )
  }
  if (kind === 'add') {
    return (
      <svg className="app-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    )
  }
  return (
    <svg className="app-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M9 12h6M12 9v6" />
    </svg>
  )
}

export interface SharePickerTarget {
  id: string
  label: string
  kind: 'telegram' | 'windows' | 'custom'
  icon?: string | null
}

// Stacked menu of share apps that slides out of a Share button: one row per
// app with its logo, and a last row to add another program. Closes on
// Escape, on an outside click, and after a pick. It is rendered into
// document.body at a fixed position next to the button (the element the
// enclosing .share-wrap holds) so scroll areas and the window edge cannot cut
// it off; it follows the button while the list scrolls, opens in the preferred
// direction, and flips when there is no room.
export function SharePicker({
  targets,
  onPick,
  onAdd,
  onClose,
  direction = 'down'
}: {
  targets: SharePickerTarget[]
  onPick: (id: string) => void
  onAdd?: () => void
  onClose: () => void
  direction?: 'up' | 'down'
}): JSX.Element {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  // Bumped on scroll and resize so the menu is placed again next to the button.
  const [placement, setPlacement] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onDoc = (): void => onClose()
    const onMove = (): void => setPlacement((n) => n + 1)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    document.addEventListener('scroll', onMove, true)
    const timer = window.setTimeout(() => document.addEventListener('click', onDoc), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      document.removeEventListener('scroll', onMove, true)
      window.clearTimeout(timer)
      document.removeEventListener('click', onDoc)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const wrap = anchorRef.current?.parentElement
    const pop = popRef.current
    if (!wrap || !pop) return
    const rect = wrap.getBoundingClientRect()
    const height = pop.offsetHeight
    const gap = 6
    const margin = 8
    const roomBelow = window.innerHeight - rect.bottom - gap - margin
    const roomAbove = rect.top - gap - margin
    const up =
      direction === 'up'
        ? roomAbove >= height || roomAbove >= roomBelow
        : roomBelow < height && roomAbove > roomBelow
    const right = Math.max(margin, window.innerWidth - rect.right)
    setStyle(
      up
        ? { right, bottom: Math.max(margin, window.innerHeight - rect.top + gap) }
        : { right, top: Math.max(margin, rect.bottom + gap) }
    )
  }, [direction, targets.length, placement])

  return (
    <>
      <span ref={anchorRef} hidden />
      {createPortal(
        <div
          ref={popRef}
          className="share-pop"
          style={style}
          role="menu"
          aria-label="Share with"
          onClick={(e) => e.stopPropagation()}
        >
      {targets.map((t, i) => (
        <button
          key={t.id}
          role="menuitem"
          className="share-item"
          style={{ animationDelay: `${i * 35}ms` }}
          onClick={() => onPick(t.id)}
        >
          <AppIcon kind={t.kind} icon={t.icon} size={20} />
          <span>{t.label}</span>
        </button>
      ))}
      {onAdd && (
        <button
          role="menuitem"
          className="share-item add"
          style={{ animationDelay: `${targets.length * 35}ms` }}
          onClick={onAdd}
        >
          <AppIcon kind="add" size={20} />
          <span>Add an app…</span>
        </button>
      )}
        </div>,
        document.body
      )}
    </>
  )
}
