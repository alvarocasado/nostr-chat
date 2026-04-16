import { useState, useRef } from 'react'
import { Play, Pause } from 'lucide-react'

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface AudioMessageProps {
  src: string
  isOwn: boolean
}

export function AudioMessage({ src, isOwn }: AudioMessageProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) { audio.pause() } else { void audio.play() }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    if (!audio) return
    const t = Number(e.target.value)
    audio.currentTime = t
    setCurrentTime(t)
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex items-center gap-2.5 w-52">
      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0) }}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        preload="metadata"
      />
      <button
        onClick={toggle}
        className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
          isOwn ? 'bg-purple-500/40 hover:bg-purple-400/50' : 'bg-gray-700 hover:bg-gray-600'
        }`}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing
          ? <Pause size={14} className="text-white" />
          : <Play size={14} className="text-white ml-0.5" />
        }
      </button>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        {/* Progress track */}
        <div className="relative h-1.5 bg-white/10 rounded-full">
          <div
            className="absolute inset-y-0 left-0 bg-purple-400 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>
        <span className="text-xs text-gray-400 tabular-nums">
          {formatDuration(currentTime)}
          {duration > 0 ? ` / ${formatDuration(duration)}` : ''}
        </span>
      </div>
    </div>
  )
}
