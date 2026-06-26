import { useEffect, useState } from 'react'
import { downloadBlob, sha256Hex, getCachedObjectUrl, setCachedObjectUrl } from '../lib/blossom'
import { decryptBlob } from '../lib/fileCrypto'
import type { AttachmentData } from '../lib/fileUtils'

type Status = 'loading' | 'ready' | 'error'

export function useBlossomAttachment(attachment: AttachmentData): {
  status: Status
  objectUrl: string | null
  retry: () => void
} {
  const [status, setStatus] = useState<Status>('loading')
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const url = attachment.url
  const hash = attachment.hash
  const encKey = attachment.enc?.key
  const encIv = attachment.enc?.iv
  const mime = attachment.type

  useEffect(() => {
    if (!url) { setStatus('error'); return }

    const cached = getCachedObjectUrl(url)
    if (cached) { setObjectUrl(cached); setStatus('ready'); return }

    let cancelled = false
    setStatus('loading')
    setObjectUrl(null)

    ;(async () => {
      try {
        const blob = await downloadBlob(url)
        if (hash) {
          const got = await sha256Hex(blob)
          if (got !== hash) throw new Error('hash mismatch')
        }
        const plain = encKey && encIv ? await decryptBlob(blob, encKey, encIv) : blob
        if (cancelled) return
        const obj = URL.createObjectURL(new Blob([plain], { type: mime }))
        setCachedObjectUrl(url, obj)
        setObjectUrl(obj)
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => { cancelled = true }
  }, [url, hash, encKey, encIv, mime, attempt])

  return { status, objectUrl, retry: () => setAttempt(a => a + 1) }
}
