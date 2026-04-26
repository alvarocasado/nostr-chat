import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Download, FileText, Film, Music, File, X, ZoomIn, Reply, AlertCircle, Check, Loader2 } from 'lucide-react'
import { Avatar } from './Avatar'
import { AudioMessage } from './AudioMessage'
import { MarkdownMessage } from './MarkdownMessage'
import type { Message } from '../../store/nostrStore'
import type { NostrProfile } from '../../lib/nostr'
import { parseMessageContent, formatBytes, getDisplayName, type AttachmentData, type ReplyTo } from '../../lib/fileUtils'
import { useNostrStore } from '../../store/nostrStore'

interface MessageItemProps {
  message: Message
  profile?: NostrProfile
  isOwn: boolean
  showAvatar: boolean
  onReply: (msg: Message) => void
  onRetry?: (msgId: string) => void
}

const SWIPE_THRESHOLD = 60
const SWIPE_DAMPEN   = 0.45
const SWIPE_MAX      = 80

function fileIcon(type: string) {
  if (type.startsWith('video/')) return <Film size={20} className="text-blue-400" />
  if (type.startsWith('audio/')) return <Music size={20} className="text-green-400" />
  if (type === 'application/pdf') return <FileText size={20} className="text-red-400" />
  return <File size={20} className="text-gray-400" />
}

function handleDownload(attachment: AttachmentData) {
  const a = document.createElement('a')
  a.href = attachment.data
  a.download = attachment.name
  a.click()
}

function ImageLightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center gap-3 p-4"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={src}
          alt={name}
          className="max-w-[90vw] max-h-[80vh] object-contain rounded-xl shadow-2xl"
        />
        <div className="absolute top-2 right-2 flex gap-2">
          <button
            onClick={() => handleDownload({ data: src, name, type: 'image/', size: 0 })}
            className="w-9 h-9 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center transition-colors"
            title="Download"
          >
            <Download size={16} className="text-white" />
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center transition-colors"
            title="Close"
          >
            <X size={16} className="text-white" />
          </button>
        </div>
        <p className="text-gray-400 text-xs truncate max-w-[80vw]">{name}</p>
      </div>
    </div>
  )
}

function ImageAttachment({ attachment }: { attachment: AttachmentData }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="relative group/img cursor-zoom-in" onClick={() => setOpen(true)}>
        <img
          src={attachment.data}
          alt={attachment.name}
          className="max-w-full rounded-xl object-contain"
          style={{ maxHeight: 300 }}
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
          <div className="w-10 h-10 bg-black/50 rounded-full flex items-center justify-center">
            <ZoomIn size={18} className="text-white" />
          </div>
        </div>
      </div>
      {open && <ImageLightbox src={attachment.data} name={attachment.name} onClose={() => setOpen(false)} />}
    </>
  )
}

function AttachmentView({ attachment, isOwn }: { attachment: AttachmentData; isOwn: boolean }) {
  if (attachment.type.startsWith('image/')) {
    return <ImageAttachment attachment={attachment} />
  }

  if (attachment.type.startsWith('audio/')) {
    return <AudioMessage src={attachment.data} isOwn={isOwn} />
  }

  return (
    <button
      onClick={() => handleDownload(attachment)}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors w-full text-left ${
        isOwn
          ? 'bg-purple-700/60 border-purple-500/40 hover:bg-purple-700/80'
          : 'bg-gray-700/60 border-gray-600/40 hover:bg-gray-700/80'
      }`}
    >
      {fileIcon(attachment.type)}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{attachment.name}</p>
        <p className="text-xs text-gray-400">{formatBytes(attachment.size)}</p>
      </div>
      <Download size={16} className="text-gray-400 flex-shrink-0" />
    </button>
  )
}

function QuoteBlock({ replyTo, isOwn }: { replyTo: ReplyTo; isOwn: boolean }) {
  const { profiles } = useNostrStore()
  const senderName = getDisplayName(profiles[replyTo.pubkey], replyTo.pubkey, 8)
  return (
    <div className={`rounded-lg px-3 py-1.5 border-l-2 text-xs mb-0.5 ${
      isOwn
        ? 'bg-purple-800/50 border-purple-300/60'
        : 'bg-gray-700/60 border-purple-400/60'
    }`}>
      <span className="text-purple-300 font-medium block truncate">{senderName}</span>
      <span className="text-gray-300 block truncate">{replyTo.previewText}</span>
    </div>
  )
}

function StatusIndicator({ status, onRetry, msgId }: {
  status?: 'sending' | 'sent' | 'failed'
  onRetry?: (id: string) => void
  msgId: string
}) {
  if (status === 'sending') {
    return <Loader2 size={12} className="text-gray-500 animate-spin flex-shrink-0 mb-1" />
  }
  if (status === 'failed') {
    return (
      <button
        onClick={() => onRetry?.(msgId)}
        title="Failed — tap to retry"
        className="flex-shrink-0 mb-1"
      >
        <AlertCircle size={13} className="text-red-400" />
      </button>
    )
  }
  if (status === 'sent') {
    return <Check size={12} className="text-gray-500 flex-shrink-0 mb-1" />
  }
  return null
}

export function MessageItem({ message, profile, isOwn, showAvatar, onReply, onRetry }: MessageItemProps) {
  const name = getDisplayName(profile, message.pubkey, 10)
  const time = format(new Date(message.createdAt * 1000), 'HH:mm')
  const { text, attachment, replyTo } = parseMessageContent(message.content)

  const rowRef        = useRef<HTMLDivElement>(null)
  const swipeDxRef    = useRef(0)
  const [swipeDx, setSwipeDx]         = useState(0)
  const [isReturning, setIsReturning] = useState(false)

  useEffect(() => {
    const el = rowRef.current
    if (!el) return

    let startX = 0, startY = 0, swiping = false

    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      swiping = false
    }

    const onTouchMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY

      if (!swiping) {
        if (Math.abs(dx) < 8) return
        if (Math.abs(dy) > Math.abs(dx)) return  // vertical dominant → let scroll win
        if (dx < 0) return                         // leftward → ignore
        swiping = true
      }

      e.preventDefault()
      const clamped = Math.min(dx * SWIPE_DAMPEN, SWIPE_MAX)
      swipeDxRef.current = clamped
      setSwipeDx(clamped)
    }

    const onTouchEnd = () => {
      if (swiping && swipeDxRef.current >= SWIPE_THRESHOLD) {
        onReply(message)
      }
      swiping = false
      swipeDxRef.current = 0
      setIsReturning(true)
      setSwipeDx(0)
      setTimeout(() => setIsReturning(false), 250)
    }

    el.addEventListener('touchstart',  onTouchStart, { passive: true })
    el.addEventListener('touchmove',   onTouchMove,  { passive: false })
    el.addEventListener('touchend',    onTouchEnd,   { passive: true })
    el.addEventListener('touchcancel', onTouchEnd,   { passive: true })

    return () => {
      el.removeEventListener('touchstart',  onTouchStart)
      el.removeEventListener('touchmove',   onTouchMove)
      el.removeEventListener('touchend',    onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [message, onReply])

  const bubbleSwipeStyle: React.CSSProperties = {
    transform:  `translateX(${swipeDx}px)`,
    transition: isReturning ? 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none',
    willChange: 'transform',
  }

  const progress = Math.min(swipeDx / SWIPE_THRESHOLD, 1)

  const replyIconStyle: React.CSSProperties = {
    opacity:    progress,
    transform:  `scale(${0.4 + 0.6 * progress})`,
    transition: isReturning ? 'opacity 0.25s ease, transform 0.25s ease' : 'none',
  }

  const swipeReplyIcon = (
    <div
      style={replyIconStyle}
      className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 pointer-events-none"
    >
      <Reply size={15} className="text-purple-400" />
    </div>
  )

  const replyBtn = (
    <button
      onClick={() => onReply(message)}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-gray-500 hover:text-purple-400 rounded-lg hover:bg-white/10 flex-shrink-0 mb-1"
      title="Reply"
    >
      <Reply size={15} />
    </button>
  )

  if (isOwn) {
    return (
      <div ref={rowRef} className="flex flex-col items-end gap-1 group">
        <div className="flex items-end gap-2 max-w-[85%]">
          <StatusIndicator status={message.status} onRetry={onRetry} msgId={message.id} />
          <span className="text-gray-600 text-xs mb-1">
            {time}
          </span>
          {replyBtn}
          {swipeReplyIcon}
          <div
            style={bubbleSwipeStyle}
            className="bg-purple-600 rounded-2xl rounded-br-md px-4 py-2.5 flex flex-col gap-2"
          >
            {replyTo && <QuoteBlock replyTo={replyTo} isOwn />}
            {attachment && <AttachmentView attachment={attachment} isOwn />}
            <MarkdownMessage content={text} isOwn={true} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={rowRef} className="flex items-end gap-2 group">
      <div className="w-8 flex-shrink-0">
        {showAvatar && (
          <Avatar picture={profile?.picture} name={name} pubkey={message.pubkey} size="sm" />
        )}
      </div>
      <div className="flex flex-col gap-1 max-w-[75%]">
        {showAvatar && (
          <span className="text-xs text-purple-400 font-medium px-1">{name}</span>
        )}
        <div className="flex items-end gap-2">
          {swipeReplyIcon}
          <div
            style={bubbleSwipeStyle}
            className="bg-gray-800 rounded-2xl rounded-bl-md px-4 py-2.5 flex flex-col gap-2"
          >
            {replyTo && <QuoteBlock replyTo={replyTo} isOwn={false} />}
            {attachment && <AttachmentView attachment={attachment} isOwn={false} />}
            <MarkdownMessage content={text} isOwn={false} />
          </div>
          {replyBtn}
          <span className="text-gray-600 text-xs mb-1 flex-shrink-0">
            {time}
          </span>
        </div>
      </div>
    </div>
  )
}
