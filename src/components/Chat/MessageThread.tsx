import { useEffect, useRef, useState } from 'react'
import { useRateLimit } from '../../hooks/useRateLimit'
import { useWriteRelays } from '../../hooks/useRelays'
import { useTypingIndicator } from '../../hooks/useTypingIndicator'
import { useReadReceipts } from '../../hooks/useReadReceipts'
import { TypingIndicator } from './TypingIndicator'
import { useCallContext } from '../../contexts/CallContext'
import { useGroupCallContext } from '../../contexts/GroupCallContext'
import { GroupCallBanner } from '../Call/GroupCallBanner'
import { Send, Hash, Lock, WifiOff, ArrowLeft, Paperclip, X, Mic, Square, Phone, Video, Reply, Images, Users } from 'lucide-react'
import { useNostrStore, type Message, type Group } from '../../store/nostrStore'
import {
  useChannelMessages, useDMMessages, useGroupMessages,
  sendChannelReaction, sendDMReaction, sendGroupReaction,
  sendChannelMessage, sendDM, sendGroupControl,
} from '../../hooks/useNostrSubscriptions'
import { useChatThread } from '../../hooks/useChatThread'
import { buildChannelMessageEvent, buildDMEvent, buildGroupMessageEvent } from '../../lib/nostr'
import { getPeerRelays, combineRelays } from '../../lib/peerRelays'
import { encryptWithGroupKey } from '../../lib/groupCrypto'
import { MessageList } from './MessageList'
import { MediaGallery } from './MediaGallery'
import { Avatar } from './Avatar'
import { GroupMembersModal } from './GroupMembersModal'
import {
  compressImage, encodeFile, serializeMessage, getPreviewText, formatBytes, getDisplayName,
  type AttachmentData, type ReplyTo,
} from '../../lib/fileUtils'
import { INLINE_BASE64_THRESHOLD, MAX_CHUNKED_FILE_BYTES } from '../../lib/fileTransfer'
import { uploadAttachment } from '../../lib/fileSend'
import { getMediaServer } from '../../lib/blossom'
import { useAudioRecorder, MAX_RECORDING_SECONDS } from '../../hooks/useAudioRecorder'
import { AudioMessage } from './AudioMessage'
import { formatDuration } from '../../lib/format'


function ChannelHeader({ channelId, onOpenGallery }: { channelId: string; onOpenGallery: () => void }) {
  const { channels, clearActiveChat } = useNostrStore()
  const channel = channels.find(c => c.id === channelId)

  return (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-800 bg-gray-900">
      <button
        onClick={clearActiveChat}
        className="md:hidden p-2 -ml-1 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
        aria-label="Back"
      >
        <ArrowLeft size={20} />
      </button>
      <div className="w-9 h-9 bg-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
        <Hash size={18} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="font-semibold text-white truncate">{channel?.name || 'Channel'}</h2>
        {channel?.about && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{channel.about}</p>
        )}
      </div>
      <button
        onClick={onOpenGallery}
        className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
        title="Shared media"
      >
        <Images size={18} />
      </button>
    </div>
  )
}

function DMHeader({ pubkey, onOpenGallery }: { pubkey: string; onOpenGallery: () => void }) {
  const { contacts, profiles, clearActiveChat, setViewingProfilePubkey, signerCaps } = useNostrStore()
  const { callState, initiateCall } = useCallContext()
  const contact = contacts.find(c => c.pubkey === pubkey)
  const profile = contact?.profile || profiles[pubkey]
  const name = getDisplayName(profile, pubkey, 12)
  const canCall = callState === 'idle' && signerCaps.nip04

  return (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-800 bg-gray-900">
      <button
        onClick={clearActiveChat}
        className="md:hidden p-2 -ml-1 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
        aria-label="Back"
      >
        <ArrowLeft size={20} />
      </button>
      <Avatar picture={profile?.picture} name={name} pubkey={pubkey} size="md" onClick={() => setViewingProfilePubkey(pubkey)} />
      <div className="flex-1 min-w-0">
        <h2 className="font-semibold text-white truncate">{name}</h2>
        <div className="flex items-center gap-1 mt-0.5">
          <Lock size={11} className="text-green-400 flex-shrink-0" />
          <span className="text-xs text-gray-500">End-to-end encrypted</span>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onOpenGallery}
          className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          title="Shared media"
        >
          <Images size={18} />
        </button>
        <button
          onClick={() => initiateCall(pubkey, 'audio')}
          disabled={!canCall}
          className="p-2 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-white/10 transition-colors"
          title="Audio call"
        >
          <Phone size={18} />
        </button>
        <button
          onClick={() => initiateCall(pubkey, 'video')}
          disabled={!canCall}
          className="p-2 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-white/10 transition-colors"
          title="Video call"
        >
          <Video size={18} />
        </button>
      </div>
    </div>
  )
}

function GroupHeader({ groupId, onOpenGallery }: { groupId: string; onOpenGallery: () => void }) {
  const { groups, clearActiveChat } = useNostrStore()
  const group = groups.find((g: Group) => g.id === groupId)
  const { startOrJoin, liveCall, joinState } = useGroupCallContext()
  const [showMembers, setShowMembers] = useState(false)

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-800 bg-gray-900">
        <button
          onClick={clearActiveChat}
          className="md:hidden p-2 -ml-1 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="w-9 h-9 bg-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
          <Users size={18} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-white truncate">{group?.name || 'Group'}</h2>
          <div className="flex items-center gap-1 mt-0.5">
            <Lock size={11} className="text-green-400 flex-shrink-0" />
            <button
              onClick={() => group && setShowMembers(true)}
              aria-label="Members"
              className="text-xs text-gray-500 hover:text-gray-300 hover:underline transition-colors"
            >
              {group ? `${group.memberPubkeys.length} members · encrypted` : 'Encrypted group'}
            </button>
          </div>
        </div>
        <button
          onClick={() => startOrJoin(groupId, liveCall?.mediaType ?? 'audio')}
          disabled={joinState !== 'can-join'}
          className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          title={liveCall ? 'Join call' : 'Start voice call'}
        >
          <Phone size={18} />
        </button>
        <button
          onClick={() => startOrJoin(groupId, liveCall?.mediaType ?? 'video')}
          disabled={joinState !== 'can-join'}
          className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          title={liveCall ? 'Join call' : 'Start video call'}
        >
          <Video size={18} />
        </button>
        <button
          onClick={onOpenGallery}
          className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
          title="Shared media"
        >
          <Images size={18} />
        </button>
      </div>
      {showMembers && group && <GroupMembersModal group={group} onClose={() => setShowMembers(false)} />}
    </>
  )
}

interface UploadProgress { name: string; sent: number; total: number }

const MAX_TEXTAREA_HEIGHT = 120

export function MessageInput({
  chatId,
  chatType,
  onSend,
  onTyping,
  placeholder,
  replyTo,
  onCancelReply,
  preloadedAttachment,
}: {
  chatId: string
  chatType: 'dm' | 'channel' | 'group'
  onSend: (content: string) => Promise<void>
  onTyping: () => void
  placeholder: string
  replyTo: Message | null
  onCancelReply: () => void
  preloadedAttachment?: AttachmentData
}) {
  const { profiles, drafts, setDraft, clearDraft } = useNostrStore()
  const [text, setText] = useState(() => drafts[chatId] ?? '')
  const [sending, setSending] = useState(false)
  const [attachment, setAttachment] = useState<AttachmentData | null>(preloadedAttachment ?? null)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    return () => {
      if (textRef.current.trim()) {
        setDraft(chatId, textRef.current)
      } else {
        clearDraft(chatId)
      }
    }
  }, [chatId]) // eslint-disable-line react-hooks/exhaustive-deps

  const recorder = useAudioRecorder()
  const { isLimited, cooldownSec, tryRecord } = useRateLimit()

  const canSend = (text.trim().length > 0 || attachment !== null) && !sending && !isLimited

  const buildReplyTo = (): ReplyTo | null => {
    if (!replyTo) return null
    return { id: replyTo.id, pubkey: replyTo.pubkey, previewText: getPreviewText(replyTo.content) }
  }

  const handleSend = async () => {
    if (!canSend) return
    if (!tryRecord()) return

    const replyToData = buildReplyTo()
    const a = attachment
    const t = text.trim()

    setSending(true)
    setText('')
    setAttachment(null)
    onCancelReply()
    clearDraft(chatId)

    try {
      let finalAttachment = a
      if (a && a.data && a.data.length > INLINE_BASE64_THRESHOLD) {
        setUploadProgress({ name: a.name, sent: 0, total: 1 })
        const server = await getMediaServer()
        finalAttachment = await uploadAttachment(a, chatType, server, (loaded, total) =>
          setUploadProgress({ name: a.name, sent: loaded, total }))
      }
      const content = serializeMessage(t, finalAttachment, replyToData)
      await onSend(content)
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Send failed.')
      setText(t)
      if (a) setAttachment(a)
    } finally {
      setSending(false)
      setUploadProgress(null)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAttachError(null)

    if (file.size > MAX_CHUNKED_FILE_BYTES) {
      setAttachError(`File too large. Maximum is ${formatBytes(MAX_CHUNKED_FILE_BYTES)}.`)
      return
    }

    try {
      // Images: compress first; large files are uploaded to the media server (Blossom) on send
      const data = file.type.startsWith('image/')
        ? await compressImage(file)
        : await encodeFile(file)
      setAttachment({ name: file.name, type: file.type, size: file.size, data })
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Failed to attach file.')
    }
  }

  // When recording stops, encode the blob and set as attachment
  const handleStopRecording = async () => {
    recorder.stop()
  }

  useEffect(() => {
    if (recorder.state !== 'stopped' || !recorder.audioBlob) return
    const blob = recorder.audioBlob
    const mime = blob.type || recorder.mimeType || 'audio/webm'
    const ext = mime.split(';')[0].split('/')[1] ?? 'webm'
    const reader = new FileReader()
    reader.onload = () => {
      const data = reader.result as string
      setAttachment({ name: `voice-message.${ext}`, type: mime, size: blob.size, data })
      recorder.reset()
    }
    reader.readAsDataURL(blob)
  }, [recorder.state, recorder.audioBlob]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (recorder.error) setAttachError(recorder.error)
  }, [recorder.error])

  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT) + 'px'
    }
  }, [text])

  const isRecording = recorder.state === 'recording' || recorder.state === 'requesting'

  return (
    <div
      className="px-3 py-3 bg-gray-950"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      {/* Reply banner */}
      {replyTo && !isRecording && (
        <div className="mb-2 flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2 border-l-2 border-purple-500">
          <Reply size={14} className="text-purple-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-purple-300 text-xs font-medium block truncate">
              {getDisplayName(profiles[replyTo.pubkey], replyTo.pubkey, 8)}
            </span>
            <p className="text-gray-400 text-xs truncate">{getPreviewText(replyTo.content)}</p>
          </div>
          <button
            onClick={onCancelReply}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
            aria-label="Cancel reply"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Attachment preview */}
      {attachment && !isRecording && (
        <div className="mb-2 flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2">
          {attachment.type.startsWith('image/') ? (
            <img src={attachment.data} alt={attachment.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
          ) : attachment.type.startsWith('audio/') ? (
            <div className="flex-1 min-w-0 py-1">
              <AudioMessage src={attachment.data} isOwn />
            </div>
          ) : (
            <div className="w-12 h-12 bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
              <Paperclip size={18} className="text-gray-400" />
            </div>
          )}
          {!attachment.type.startsWith('audio/') && (
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{attachment.name}</p>
              <p className="text-xs text-gray-500">{formatBytes(attachment.size)}</p>
            </div>
          )}
          <button
            onClick={() => setAttachment(null)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
            aria-label="Remove attachment"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Upload progress */}
      {uploadProgress && (
        <div className="mb-2 bg-gray-800 rounded-xl px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-300 truncate max-w-[60%]">{uploadProgress.name}</span>
            <span className="text-gray-400 tabular-nums flex-shrink-0">
              {uploadProgress.total > 1
                ? `Chunk ${uploadProgress.sent} / ${uploadProgress.total}`
                : 'Sending…'}
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-purple-500 h-full rounded-full transition-all duration-200"
              style={{ width: `${uploadProgress.total > 1 ? (uploadProgress.sent / uploadProgress.total) * 100 : 30}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {attachError && (
        <div className="mb-2 flex items-center justify-between gap-2 bg-red-900/30 border border-red-700/50 rounded-xl px-3 py-2">
          <p className="text-xs text-red-400">{attachError}</p>
          <button onClick={() => setAttachError(null)} className="text-red-500 hover:text-red-300 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Recording row */}
      {isRecording ? (
        <div className="flex items-center gap-3 bg-[#10101c] rounded-[28px] px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.05)]">
          <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
          <span className="text-sm text-white flex-1 tabular-nums">
            {recorder.state === 'requesting' ? 'Waiting for mic…' : `Recording  ${formatDuration(recorder.elapsed)} / ${formatDuration(MAX_RECORDING_SECONDS)}`}
          </span>
          <button
            onClick={handleStopRecording}
            disabled={recorder.state === 'requesting'}
            className="w-9 h-9 bg-red-600 hover:bg-red-500 disabled:opacity-40 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
            title="Stop recording"
          >
            <Square size={14} className="text-white fill-white" />
          </button>
          <button
            onClick={recorder.reset}
            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        /* Normal input row */
        <div className="flex items-end gap-2 bg-[#10101c] rounded-[28px] px-4 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.05)]">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-gray-500 hover:text-purple-400 transition-colors flex-shrink-0 mb-0.5"
            title="Attach file"
            type="button"
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,text/*,audio/*,video/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => { setText(e.target.value); onTyping() }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="flex-1 bg-transparent text-white placeholder-gray-500 resize-none outline-none text-sm leading-relaxed max-h-32 scrollbar-thin"
            style={{ overflow: 'hidden' }}
          />
          {/* Mic button — shown when no text typed, no attachment, and not rate-limited */}
          {!text.trim() && !attachment && !isLimited ? (
            <button
              onClick={() => { void recorder.start() }}
              className="w-10 h-10 text-gray-500 hover:text-purple-400 transition-colors flex items-center justify-center flex-shrink-0"
              title="Record voice message"
              type="button"
            >
              <Mic size={20} />
            </button>
          ) : isLimited ? (
            <div
              className="w-10 h-10 bg-amber-600/30 border border-amber-600/50 rounded-full flex items-center justify-center flex-shrink-0"
              title={`Slow down — wait ${cooldownSec}s`}
            >
              <span className="text-amber-400 text-xs font-bold tabular-nums">{cooldownSec}s</span>
            </div>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send"
              className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-700 hover:from-violet-400 hover:to-purple-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-all flex-shrink-0 shadow-[0_4px_12px_rgba(124,58,237,0.45)]"
            >
              <Send size={16} className="text-white" />
            </button>
          )}
        </div>
      )}
      <p className="text-gray-600 text-xs mt-1.5 text-center hidden sm:block">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}

function ChannelThread({ channelId }: { channelId: string }) {
  const { publicKey, messages, profiles, targetMessageId } = useNostrStore()
  const writeR = useWriteRelays()
  useChannelMessages(channelId)
  const { typists, notifyTyping } = useTypingIndicator('channel', channelId)
  const thread = useChatThread(channelId, {
    targetRelays: () => writeR,
    sendContent: content => sendChannelMessage(content, channelId, writeR),
    sendReaction: (t, e, o) => sendChannelReaction(t, e, o, channelId, writeR),
  })

  const handleSend = async (content: string) => {
    if (!thread.guarded()) return
    const event = await buildChannelMessageEvent(content, channelId, writeR[0], thread.replyTo?.id)
    await thread.publish(event, { content, kind: 42, channelId })
  }

  return (
    <>
      <ChannelHeader channelId={channelId} onOpenGallery={() => thread.setShowGallery(true)} />
      {thread.showGallery ? (
        <MediaGallery messages={messages[channelId] || []} onClose={() => thread.setShowGallery(false)} />
      ) : (
        <>
          <MessageList chatId={channelId} chatType="channel" messages={messages[channelId] || []} myPubkey={publicKey || ''} profiles={profiles} onReply={thread.setReplyTo} onRetry={thread.handleRetry} onReact={thread.handleReact} onEdit={thread.handleEdit} onDelete={thread.handleDelete} dividerTimestamp={thread.dividerTimestamp} targetMessageId={targetMessageId ?? undefined} />
          <TypingIndicator typists={typists} profiles={profiles} />
          <MessageInput chatId={channelId} chatType="channel" onSend={handleSend} onTyping={notifyTyping} placeholder="Message channel..." replyTo={thread.replyTo} onCancelReply={() => thread.setReplyTo(null)} />
        </>
      )}
    </>
  )
}

function DMThread({ theirPubkey }: { theirPubkey: string }) {
  const { publicKey, messages, profiles, targetMessageId,
    contacts, acceptMessageRequest, dismissMessageRequest, blockPubkey, clearActiveChat, signerCaps } = useNostrStore()
  const writeR = useWriteRelays()
  useDMMessages(publicKey, theirPubkey)
  const isPending = contacts.find(c => c.pubkey === theirPubkey)?.pending === true
  const { typists, notifyTyping } = useTypingIndicator('dm', theirPubkey, theirPubkey)
  useReadReceipts(theirPubkey, !isPending)

  const dmTargetRelays = async () => {
    const peerRead = (await getPeerRelays(theirPubkey, useNostrStore.getState().readRelays())).read
    return combineRelays(writeR, peerRead)
  }

  const thread = useChatThread(theirPubkey, {
    canAct: () => signerCaps.nip04,
    targetRelays: dmTargetRelays,
    sendContent: async content => sendDM(content, theirPubkey, await dmTargetRelays()),
    sendReaction: async (t, e, o) => sendDMReaction(t, e, o, theirPubkey, await dmTargetRelays()),
  })

  const handleSend = async (content: string) => {
    if (!thread.guarded()) return
    if (isPending) acceptMessageRequest(theirPubkey)
    const event = await buildDMEvent(theirPubkey, content)
    await thread.publish(event, { content, kind: 4, recipientPubkey: theirPubkey, decrypted: true })
  }

  return (
    <>
      <DMHeader pubkey={theirPubkey} onOpenGallery={() => thread.setShowGallery(true)} />
      {isPending && (
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 border-b border-gray-800">
          <p className="flex-1 text-sm text-gray-300">This person isn't in your contacts.</p>
          <button
            onClick={() => acceptMessageRequest(theirPubkey)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white transition-colors"
          >
            Accept
          </button>
          <button
            onClick={() => { dismissMessageRequest(theirPubkey); clearActiveChat() }}
            className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-white/5 transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={() => { blockPubkey(theirPubkey); clearActiveChat() }}
            className="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Block
          </button>
        </div>
      )}
      {thread.showGallery ? (
        <MediaGallery messages={messages[theirPubkey] || []} onClose={() => thread.setShowGallery(false)} />
      ) : (
        <>
          <MessageList chatId={theirPubkey} chatType="dm" messages={messages[theirPubkey] || []} myPubkey={publicKey || ''} profiles={profiles} onReply={thread.setReplyTo} onRetry={thread.handleRetry} onReact={thread.handleReact} onEdit={thread.handleEdit} onDelete={thread.handleDelete} dividerTimestamp={thread.dividerTimestamp} targetMessageId={targetMessageId ?? undefined} />
          <TypingIndicator typists={typists} profiles={profiles} />
          {!signerCaps.nip04 && (
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 border-t border-gray-800">
              <p className="flex-1 text-sm text-gray-400">Your signer does not support encrypted messages yet</p>
            </div>
          )}
          {signerCaps.nip04 && (
            <MessageInput chatId={theirPubkey} chatType="dm" onSend={handleSend} onTyping={notifyTyping} placeholder="Encrypted message..." replyTo={thread.replyTo} onCancelReply={() => thread.setReplyTo(null)} />
          )}
        </>
      )}
    </>
  )
}

function GroupThread({ groupId }: { groupId: string }) {
  const { publicKey, messages, profiles, groupKeys, targetMessageId, signerCaps } = useNostrStore()
  const writeR = useWriteRelays()
  useGroupMessages(groupId)
  const { watchGroup } = useGroupCallContext()
  useEffect(() => {
    watchGroup(groupId)
    return () => watchGroup(null)
  }, [groupId, watchGroup])
  const groupKey = groupKeys[groupId]

  const thread = useChatThread(groupId, {
    canAct: () => !!groupKey,
    targetRelays: () => writeR,
    // groupKey is guaranteed by canAct before these closures run
    sendContent: content => sendGroupControl(content, groupId, groupKey!, writeR),
    sendReaction: (t, e, o) => sendGroupReaction(t, e, o, groupId, groupKey!, writeR),
  })

  const handleSend = async (content: string) => {
    if (!thread.guarded() || !groupKey || !signerCaps.nip04) return
    const encryptedContent = await encryptWithGroupKey(content, groupKey)
    const event = await buildGroupMessageEvent(encryptedContent, groupId, writeR[0], thread.replyTo?.id)
    // store plaintext locally
    await thread.publish(event, { content, kind: event.kind })
  }

  if (!groupKey) {
    return (
      <>
        <GroupHeader groupId={groupId} onOpenGallery={() => {}} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-6">
            <WifiOff size={40} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Group key unavailable. Try logging out and back in.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <GroupHeader groupId={groupId} onOpenGallery={() => thread.setShowGallery(true)} />
      <GroupCallBanner groupId={groupId} />
      {thread.showGallery ? (
        <MediaGallery messages={messages[groupId] || []} onClose={() => thread.setShowGallery(false)} />
      ) : (
        <>
          <MessageList
            chatId={groupId}
            chatType="group"
            messages={messages[groupId] || []}
            myPubkey={publicKey || ''}
            profiles={profiles}
            onReply={thread.setReplyTo}
            onRetry={thread.handleRetry}
            onReact={thread.handleReact}
            onEdit={thread.handleEdit}
            onDelete={thread.handleDelete}
            dividerTimestamp={thread.dividerTimestamp}
            targetMessageId={targetMessageId ?? undefined}
          />
          {!signerCaps.nip04 && (
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 border-t border-gray-800">
              <p className="flex-1 text-sm text-gray-400">Your signer does not support encrypted messages yet</p>
            </div>
          )}
          {signerCaps.nip04 && (
            <MessageInput
              chatId={groupId}
              chatType="group"
              onSend={handleSend}
              onTyping={() => {}}
              placeholder="Message group…"
              replyTo={thread.replyTo}
              onCancelReply={() => thread.setReplyTo(null)}
            />
          )}
        </>
      )}
    </>
  )
}

export function MessageThread() {
  const { activeChatId, activeChatType } = useNostrStore()

  if (!activeChatId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <div className="text-center space-y-3 px-8">
          <div className="w-20 h-20 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto">
            <WifiOff size={36} className="text-gray-600" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-gray-300">Select a chat</h3>
            <p className="text-gray-500 text-sm mt-1">
              Choose a channel or contact to start chatting.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-950 overflow-hidden">
      {activeChatType === 'channel' ? (
        <ChannelThread key={activeChatId} channelId={activeChatId} />
      ) : activeChatType === 'group' ? (
        <GroupThread key={activeChatId} groupId={activeChatId} />
      ) : (
        <DMThread key={activeChatId} theirPubkey={activeChatId} />
      )}
    </div>
  )
}
