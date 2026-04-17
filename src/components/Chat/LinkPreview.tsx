import { useState, useEffect } from 'react'
import { ExternalLink } from 'lucide-react'

interface PreviewData {
  title?: string
  description?: string
  image?: string
  url: string
}

// Session-level cache — avoids re-fetching the same URL within a session
const cache = new Map<string, PreviewData | null>()

function useLinkPreview(url: string) {
  const [data, setData] = useState<PreviewData | null | 'loading'>(
    cache.has(url) ? cache.get(url) ?? null : 'loading'
  )

  useEffect(() => {
    if (cache.has(url)) {
      setData(cache.get(url) ?? null)
      return
    }
    let cancelled = false
    fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json.status === 'success') {
          const d: PreviewData = {
            title: json.data.title || undefined,
            description: json.data.description || undefined,
            image: json.data.image?.url || undefined,
            url: json.data.url || url,
          }
          cache.set(url, d)
          setData(d)
        } else {
          cache.set(url, null)
          setData(null)
        }
      })
      .catch(() => {
        if (!cancelled) { cache.set(url, null); setData(null) }
      })
    return () => { cancelled = true }
  }, [url])

  return data
}

function hostname(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export function LinkPreview({ url, isOwn }: { url: string; isOwn: boolean }) {
  const data = useLinkPreview(url)

  if (data === 'loading') {
    return (
      <div className={`mt-2 h-16 rounded-xl animate-pulse ${isOwn ? 'bg-purple-700/30' : 'bg-gray-700/40'}`} />
    )
  }
  if (!data) return null

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-2 flex gap-0 rounded-xl border overflow-hidden transition-opacity hover:opacity-80 ${
        isOwn
          ? 'bg-purple-700/40 border-purple-500/30'
          : 'bg-gray-700/40 border-gray-600/30'
      }`}
    >
      {data.image && (
        <img
          src={data.image}
          alt=""
          className="w-20 h-20 object-cover flex-shrink-0"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <div className="py-2.5 px-3 flex flex-col justify-center min-w-0 flex-1 gap-0.5">
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400 truncate">{hostname(url)}</span>
          <ExternalLink size={10} className="text-gray-500 flex-shrink-0" />
        </div>
        {data.title && (
          <p className="text-sm font-semibold text-white line-clamp-1">{data.title}</p>
        )}
        {data.description && (
          <p className="text-xs text-gray-400 line-clamp-2">{data.description}</p>
        )}
      </div>
    </a>
  )
}
