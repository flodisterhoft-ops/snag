import type { MediaInfo } from '@shared/types'
import { formatDuration } from '../lib/format'
import { Icon } from './ui'

export function MediaCard({ info }: { info: MediaInfo }): JSX.Element {
  const duration = formatDuration(info.durationSeconds)
  return (
    <div className="media-card">
      <div className="media-thumb">
        {info.thumbnail ? (
          <img src={info.thumbnail} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="media-thumb-fallback">
            <Icon name="video" size={22} />
          </div>
        )}
        {duration && <span className="media-duration">{duration}</span>}
        {info.isLive && <span className="media-live">LIVE</span>}
      </div>
      <div className="media-meta">
        <h2 className="media-title" title={info.title}>
          {info.title}
        </h2>
        <div className="media-sub">
          {info.channel && <span className="media-channel">{info.channel}</span>}
          <span className="media-source">{info.extractor}</span>
          {info.playlist && (
            <span className="media-playlist-note">
              <Icon name="queue" size={12} />
              Playlist “{info.playlist.title ?? 'Untitled'}” · {info.playlist.count} videos
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
