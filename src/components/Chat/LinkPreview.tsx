import { useState, useEffect } from 'react'
import { ExternalLink } from 'lucide-react'

interface PreviewData {
  title?: string
  description?: string
  image?: string
  url: string
}

const CACHE_MAX = 100

// Session-level cache — avoids re-fetching the same URL within a session
const cache = new Map<string, PreviewData | null>()

function setCached(url: string, value: PreviewData | null) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(url, value)
}

function useLinkPreview(url: string) {
  const [data, setData] = useState<PreviewData | null | 'loading'>(
    cache.has(url) ? cache.get(url) ?? null : 'loading'
  )

  useEffect(() => {
    if (cache.has(url)) {
      setData(cache.get(url) ?? null)
      return
    }
    const controller = new AbortController()
    fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
      credentials: 'omit',
    })
      .then(r => r.json())
      .then(json => {
        if (json.status === 'success') {
          // Only accept https image URLs from the response — never data:, javascript:, etc.
          const rawImage: unknown = json.data?.image?.url
          const safeImage = (typeof rawImage === 'string' && /^https:\/\//i.test(rawImage))
            ? rawImage : undefined
          const d: PreviewData = {
            title: json.data.title || undefined,
            description: json.data.description || undefined,
            image: safeImage,
            url: json.data.url || url,
          }
          setCached(url, d)
          setData(d)
        } else {
          setCached(url, null)
          setData(null)
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return
        setCached(url, null)
        setData(null)
      })
    return () => controller.abort()
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
