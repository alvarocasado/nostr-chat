import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

interface QRCodeDisplayProps {
  value: string
  size?: number
  label?: string
}

export function QRCodeDisplay({ value, size = 220, label }: QRCodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!value) return
    QRCode.toCanvas(
      canvasRef.current!,
      value,
      {
        width: size,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      },
      (err) => {
        if (err) console.error(err)
      }
    )
    QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).then(setDataUrl)
  }, [value, size])

  const handleDownload = () => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = 'nostr-pubkey-qr.png'
    a.click()
  }

  const handleShare = async () => {
    if (!dataUrl || !navigator.share) return
    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], 'nostr-pubkey-qr.png', { type: 'image/png' })
    try {
      await navigator.share({ files: [file], title: 'My Nostr Public Key', text: value })
    } catch {
      // user cancelled or not supported
    }
  }

  const canShare = typeof navigator !== 'undefined' && !!navigator.share

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-2xl overflow-hidden border border-gray-300 bg-white p-3">
        <canvas ref={canvasRef} className="block rounded-xl" />
      </div>
      {label && (
        <p className="text-gray-400 text-xs text-center px-4">{label}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={handleDownload}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          Download
        </button>
        {canShare && (
          <button
            onClick={handleShare}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Share
          </button>
        )}
      </div>
    </div>
  )
}
