import { useEffect, useState } from 'react'
import { X, Download, ArrowLeft, ArrowRight, Images } from 'lucide-react'
import type { Message } from '../../store/nostrStore'
import { parseMessageContent, type AttachmentData } from '../../lib/fileUtils'

interface GalleryImage {
  msgId: string
  attachment: AttachmentData
}

function extractImages(messages: Message[]): GalleryImage[] {
  return messages
    .flatMap(m => {
      const { attachment } = parseMessageContent(m.content)
      if (!attachment?.type.startsWith('image/')) return []
      return [{ msgId: m.id, attachment }]
    })
    .reverse()
}

export function MediaGallery({ messages, onClose }: { messages: Message[]; onClose: () => void }) {
  const images = extractImages(messages)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxIdx !== null) { setLightboxIdx(null); return }
        onClose()
      }
      if (lightboxIdx !== null) {
        if (e.key === 'ArrowLeft')  setLightboxIdx(i => Math.max(0, (i ?? 0) - 1))
        if (e.key === 'ArrowRight') setLightboxIdx(i => Math.min(images.length - 1, (i ?? 0) + 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIdx, images.length, onClose])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          aria-label="Close gallery"
        >
          <ArrowLeft size={18} />
        </button>
        <Images size={18} className="text-purple-400 flex-shrink-0" />
        <span className="font-semibold text-white flex-1">Shared Media</span>
        <span className="text-sm text-gray-500">{images.length} image{images.length !== 1 ? 's' : ''}</span>
      </div>

      {images.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-6">
            <Images size={40} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No images shared yet</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
          <div className="grid grid-cols-3 gap-1.5">
            {images.map((img, idx) => (
              <button
                key={img.msgId}
                onClick={() => setLightboxIdx(idx)}
                className="aspect-square overflow-hidden rounded-lg bg-gray-800 hover:opacity-80 transition-opacity"
              >
                <img
                  src={img.attachment.data}
                  alt={img.attachment.name}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {lightboxIdx !== null && (() => {
        const img = images[lightboxIdx]
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
            onClick={() => setLightboxIdx(null)}
          >
            <div
              className="relative flex flex-col items-center gap-3 p-4"
              onClick={e => e.stopPropagation()}
            >
              <img
                src={img.attachment.data}
                alt={img.attachment.name}
                className="max-w-[90vw] max-h-[80vh] object-contain rounded-xl shadow-2xl"
              />

              {lightboxIdx > 0 && (
                <button
                  onClick={() => setLightboxIdx(i => (i ?? 1) - 1)}
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center transition-colors"
                >
                  <ArrowLeft size={18} className="text-white" />
                </button>
              )}
              {lightboxIdx < images.length - 1 && (
                <button
                  onClick={() => setLightboxIdx(i => (i ?? 0) + 1)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center transition-colors"
                >
                  <ArrowRight size={18} className="text-white" />
                </button>
              )}

              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={() => { const a = document.createElement('a'); a.href = img.attachment.data; a.download = img.attachment.name; a.click() }}
                  className="w-9 h-9 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center transition-colors"
                  title="Download"
                >
                  <Download size={16} className="text-white" />
                </button>
                <button
                  onClick={() => setLightboxIdx(null)}
                  className="w-9 h-9 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center transition-colors"
                  title="Close"
                >
                  <X size={16} className="text-white" />
                </button>
              </div>

              <p className="text-gray-400 text-xs">{lightboxIdx + 1} / {images.length}</p>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
