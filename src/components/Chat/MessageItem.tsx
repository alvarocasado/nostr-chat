import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { Download, FileText, Film, Music, File, X, ZoomIn, Reply, AlertCircle, Check, CheckCheck, Loader2, SmilePlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Avatar } from './Avatar'
import { AudioMessage } from './AudioMessage'
import { MarkdownMessage } from './MarkdownMessage'
import type { Message } from '../../store/nostrStore'
import type { NostrProfile } from '../../lib/nostr'
import { parseMessageContent, formatBytes, getDisplayName, type AttachmentData, type ReplyTo } from '../../lib/fileUtils'
import { useNostrStore } from '../../store/nostrStore'
import { useBlossomAttachment } from '../../hooks/useBlossomAttachment'
import { aggregateReactions, REACTION_EMOJIS } from '../../lib/reactions'

interface MessageItemProps {
  message: Message
  profile?: NostrProfile
  isOwn: boolean
  showAvatar: boolean
  onReply: (msg: Message) => void
  onRetry?: (msgId: string) => void
  onReact?: (msg: Message, emoji: string) => void
  onEdit?: (msg: Message, newText: string) => void
  onDelete?: (msg: Message) => void
}

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-gray-800 border border-gray-700 rounded-full px-1.5 py-1 shadow-lg">
      {REACTION_EMOJIS.map(e => (
        <button
          key={e}
          type="button"
          onClick={() => onPick(e)}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-base leading-none"
        >
          {e}
        </button>
      ))}
    </div>
  )
}

function ReactionPills({ message, isOwn, onReact }: {
  message: Message
  isOwn: boolean
  onReact: (msg: Message, emoji: string) => void
}) {
  const myPubkey = useNostrStore(s => s.publicKey) ?? ''
  const byEmoji = useNostrStore(s => s.reactions[message.id])
  const pills = aggregateReactions(byEmoji, myPubkey)
  if (pills.length === 0) return null
  return (
    <div className={`flex flex-wrap gap-1 ${isOwn ? 'justify-end' : ''}`}>
      {pills.map(p => (
        <button
          key={p.emoji}
          type="button"
          onClick={() => onReact(message, p.emoji)}
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors ${
            p.mine
              ? 'bg-purple-600/30 border-purple-500/60 text-white'
              : 'bg-gray-800/80 border-gray-700 text-gray-300 hover:bg-gray-700/80'
          }`}
        >
          <span className="leading-none">{p.emoji}</span>
          <span className="tabular-nums">{p.count}</span>
        </button>
      ))}
    </div>
  )
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
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-sm"
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
      {open && createPortal(<ImageLightbox src={attachment.data} name={attachment.name} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function RemoteAttachmentView({ attachment, isOwn }: { attachment: AttachmentData; isOwn: boolean }) {
  const { status, objectUrl, retry } = useBlossomAttachment(attachment)

  if (status === 'ready' && objectUrl) {
    return <AttachmentView attachment={{ ...attachment, data: objectUrl }} isOwn={isOwn} />
  }
  if (status === 'error') {
    return (
      <button
        onClick={retry}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-red-700/50 bg-red-900/20 w-full text-left"
      >
        <AlertCircle size={20} className="text-red-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">Couldn't load attachment</p>
          <p className="text-xs text-gray-400 truncate">{attachment.name} — tap to retry</p>
        </div>
      </button>
    )
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-600/40 bg-gray-700/40 w-full">
      <Loader2 size={18} className="text-gray-400 animate-spin flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">Loading…</p>
        <p className="text-xs text-gray-400 truncate">{attachment.name}</p>
      </div>
    </div>
  )
}

function AttachmentView({ attachment, isOwn }: { attachment: AttachmentData; isOwn: boolean }) {
  if (!attachment.data && attachment.url) {
    return <RemoteAttachmentView attachment={attachment} isOwn={isOwn} />
  }
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

function StatusIndicator({ status, read, onRetry, msgId }: {
  status?: 'sending' | 'sent' | 'failed'
  read?: boolean
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
    if (read) {
      return <CheckCheck size={13} aria-label="Read" className="text-purple-400 flex-shrink-0 mb-1" />
    }
    return <Check size={12} className="text-gray-500 flex-shrink-0 mb-1" />
  }
  return null
}

export function MessageItem({ message, profile, isOwn, showAvatar, onReply, onRetry, onReact, onEdit, onDelete }: MessageItemProps) {
  const name = getDisplayName(profile, message.pubkey, 10)
  const time = format(new Date(message.createdAt * 1000), 'HH:mm')
  const { setViewingProfilePubkey } = useNostrStore()
  const deletion = useNostrStore(s => s.deletedMessages[message.id])
  const edit = useNostrStore(s => s.editedMessages[message.id])
  const isDeleted = deletion?.by === message.pubkey
  const isEdited = !!edit && edit.by === message.pubkey
  const readUntil = useNostrStore(s =>
    isOwn && s.readReceiptsEnabled && message.recipientPubkey
      ? s.readUntilByPeer[message.recipientPubkey]
      : undefined)
  const isRead = readUntil !== undefined && message.createdAt <= readUntil
  const effectiveContent = isEdited ? edit.content : message.content
  const { text, attachment, replyTo } = parseMessageContent(effectiveContent)
  const [showPicker, setShowPicker] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')

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

  const reactBtn = onReact ? (
    <div className="relative flex-shrink-0 mb-1">
      <button
        onClick={() => setShowPicker(v => !v)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-gray-500 hover:text-purple-400 rounded-lg hover:bg-white/10"
        title="React"
      >
        <SmilePlus size={15} />
      </button>
      {showPicker && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowPicker(false)} />
          <div className={`absolute z-20 bottom-full mb-1 ${isOwn ? 'left-0' : 'right-0'}`}>
            <ReactionPicker onPick={emoji => { onReact(message, emoji); setShowPicker(false) }} />
          </div>
        </>
      )}
    </div>
  ) : null

  const pills = onReact ? <ReactionPills message={message} isOwn={isOwn} onReact={onReact} /> : null

  // Edit/delete are offered only on your own messages; edit is text-only.
  const canEdit = isOwn && !!onEdit && !attachment
  const canDelete = isOwn && !!onDelete
  const moreMenu = (canEdit || canDelete) ? (
    <div className="relative flex-shrink-0 mb-1">
      <button
        onClick={() => setShowMenu(v => !v)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-gray-500 hover:text-purple-400 rounded-lg hover:bg-white/10"
        title="More"
      >
        <MoreHorizontal size={15} />
      </button>
      {showMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
          <div className="absolute z-20 bottom-full mb-1 left-0 bg-gray-800 border border-gray-700 rounded-lg shadow-lg py-1 min-w-[120px]">
            {canEdit && (
              <button
                onClick={() => { setShowMenu(false); setEditText(text); setEditing(true) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-gray-200 hover:bg-white/10"
              >
                <Pencil size={13} /> Edit
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => { setShowMenu(false); onDelete!(message) }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-400 hover:bg-white/10"
              >
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  ) : null

  if (isDeleted) {
    return (
      <div data-message-id={message.id} className={`flex ${isOwn ? 'justify-end' : 'items-end gap-2'}`}>
        {!isOwn && <div className="w-8 flex-shrink-0" />}
        <div className="text-xs text-gray-600 italic px-4 py-2 rounded-[18px] border border-dashed border-gray-700/70">
          This message was deleted
        </div>
      </div>
    )
  }

  const timeSuffix = isEdited ? ' · edited' : ''

  if (isOwn) {
    return (
      <div ref={rowRef} data-message-id={message.id} className="flex flex-col items-end gap-1 group">
        <div className="flex items-end gap-2 max-w-[85%]">
          <StatusIndicator status={message.status} read={isRead} onRetry={onRetry} msgId={message.id} />
          <span className="text-gray-700 text-xs mb-1">
            {time}{timeSuffix}
          </span>
          {moreMenu}
          {reactBtn}
          {replyBtn}
          {swipeReplyIcon}
          <div
            style={bubbleSwipeStyle}
            className="bg-gradient-to-br from-violet-500 to-purple-700 rounded-[18px] rounded-br-[4px] px-4 py-2.5 flex flex-col gap-2 min-w-0 overflow-hidden shadow-[0_4px_16px_rgba(124,58,237,0.35)]"
          >
            {editing ? (
              <div className="flex flex-col gap-2 min-w-[200px]">
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  rows={2}
                  autoFocus
                  className="bg-purple-900/40 text-white rounded-lg p-2 text-sm resize-none outline-none scrollbar-thin"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditing(false)} className="text-xs text-purple-200 px-2 py-1 hover:text-white">
                    Cancel
                  </button>
                  <button
                    onClick={() => { const t = editText.trim(); if (t && t !== text) onEdit!(message, t); setEditing(false) }}
                    className="text-xs bg-white/20 hover:bg-white/30 text-white rounded px-2 py-1"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <>
                {replyTo && <QuoteBlock replyTo={replyTo} isOwn />}
                {attachment && <AttachmentView attachment={attachment} isOwn />}
                <MarkdownMessage content={text} isOwn={true} />
              </>
            )}
          </div>
        </div>
        {pills}
      </div>
    )
  }

  return (
    <div ref={rowRef} data-message-id={message.id} className="flex items-end gap-2 group">
      <div className="w-8 flex-shrink-0">
        {showAvatar && (
          <div className="p-[1.5px] bg-gradient-to-br from-violet-500 to-cyan-400 rounded-full">
            <div className="bg-gray-950 rounded-full">
              <Avatar picture={profile?.picture} name={name} pubkey={message.pubkey} size="sm" onClick={() => setViewingProfilePubkey(message.pubkey)} />
            </div>
          </div>
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
            className="bg-[#13131f] border border-[#1e1e30] rounded-[18px] rounded-bl-[4px] px-4 py-2.5 flex flex-col gap-2 min-w-0 overflow-hidden"
          >
            {replyTo && <QuoteBlock replyTo={replyTo} isOwn={false} />}
            {attachment && <AttachmentView attachment={attachment} isOwn={false} />}
            <MarkdownMessage content={text} isOwn={false} />
          </div>
          {replyBtn}
          {reactBtn}
          <span className="text-gray-700 text-xs mb-1 flex-shrink-0">
            {time}{timeSuffix}
          </span>
        </div>
        {pills}
      </div>
    </div>
  )
}
