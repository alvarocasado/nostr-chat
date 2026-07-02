import { useEffect, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Wifi, ChevronDown } from 'lucide-react'
import { useNostrStore, type Message } from '../../store/nostrStore'
import { MessageItem } from './MessageItem'
import { decorateRow, unreadAnchorId } from '../../lib/messageRows'
import { useChatHistory } from '../../hooks/useChatHistory'
import { START_INDEX, MAX_JUMP_PAGES } from '../../lib/pagination'
import { indexOfMessage } from '../../lib/history'

function NewMessagesDivider() {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-purple-500/40" />
      <span className="text-xs text-purple-400 font-semibold px-2 flex-shrink-0">New messages</span>
      <div className="flex-1 border-t border-purple-500/40" />
    </div>
  )
}

function DateSeparator({ date }: { date: Date }) {
  const label = (() => {
    const now = new Date()
    const d = new Date(date)
    if (d.toDateString() === now.toDateString()) return 'Today'
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  })()

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-gray-800" />
      <span className="text-xs text-gray-500 px-2">{label}</span>
      <div className="flex-1 border-t border-gray-800" />
    </div>
  )
}

export function MessageList({ chatId, chatType, messages, myPubkey, profiles, onReply, onRetry, onReact, dividerTimestamp, targetMessageId }: {
  chatId: string
  chatType: 'dm' | 'channel' | 'group'
  messages: Message[]
  myPubkey: string
  profiles: Record<string, { name?: string; display_name?: string; picture?: string; pubkey: string }>
  onReply: (msg: Message) => void
  onRetry: (msgId: string) => void
  onReact?: (msg: Message, emoji: string) => void
  dividerTimestamp?: number
  targetMessageId?: string
}) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [jumpNotice, setJumpNotice] = useState(false)
  const { clearTargetMessage } = useNostrStore()

  const { loadOlder, exhausted } = useChatHistory(chatId, chatType, myPubkey)
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX)

  const handleStartReached = async () => {
    const added = await loadOlder()
    if (added > 0) setFirstItemIndex(i => i - added)
  }

  // Reset the prepend anchor when switching chats.
  useEffect(() => { setFirstItemIndex(START_INDEX) }, [chatId])

  // Open at the first unread message when a divider exists, otherwise at the bottom.
  // Compute only once messages exist: on an empty first render `messages.length - 1`
  // is -1, which corrupts Virtuoso's index math when the list later populates.
  const initialIndexRef = useRef<number | null>(null)
  if (initialIndexRef.current === null && messages.length > 0) {
    initialIndexRef.current = (() => {
      if (dividerTimestamp !== undefined) {
        const i = messages.findIndex(m => m.createdAt > dividerTimestamp)
        if (i >= 0) return i
      }
      return messages.length - 1
    })()
  }
  const initialIndex = initialIndexRef.current ?? 0

  const dividerAnchorId = unreadAnchorId(messages, dividerTimestamp, myPubkey)

  // Jump to a target message, paging older history until it is found or the page budget runs out.
  useEffect(() => {
    if (!targetMessageId) return
    let cancelled = false

    const highlight = () => {
      requestAnimationFrame(() => {
        if (cancelled) return
        const el = document.querySelector<HTMLElement>(`[data-message-id="${targetMessageId}"]`)
        if (el) {
          el.classList.add('message-highlight')
          el.addEventListener('animationend', () => el.classList.remove('message-highlight'), { once: true })
        }
        clearTargetMessage()
      })
    }

    const resolve = async () => {
      for (let page = 0; page < MAX_JUMP_PAGES; page++) {
        if (cancelled) return
        const idx = indexOfMessage(useNostrStore.getState().messages[chatId] ?? [], targetMessageId)
        if (idx >= 0) {
          virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' })
          highlight()
          return
        }
        if (exhausted) break
        const added = await loadOlder()
        if (added === 0) break
      }
      if (!cancelled) {
        setJumpNotice(true)
        clearTargetMessage()
        noticeTimerRef.current = setTimeout(() => setJumpNotice(false), 4000)
      }
    }
    void resolve()
    return () => {
      cancelled = true
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    }
  }, [targetMessageId, chatId, exhausted, loadOlder, clearTargetMessage])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-6">
          <Wifi size={40} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No messages yet. Say hello!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 relative min-h-0">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        style={{ height: '100%' }}
        className="scrollbar-thin"
        initialTopMostItemIndex={initialIndex}
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        atBottomStateChange={setAtBottom}
        increaseViewportBy={600}
        firstItemIndex={firstItemIndex}
        startReached={() => { void handleStartReached() }}
        itemContent={(index, msg) => {
          // Virtuoso passes the absolute index (offset by firstItemIndex); map back to the data array.
          const prev = messages[index - firstItemIndex - 1]
          const { showDateSeparator, showAvatar } = decorateRow(msg, prev, myPubkey)
          const showDivider = msg.id === dividerAnchorId
          return (
            <div className="px-3">
              {showDateSeparator && <DateSeparator date={new Date(msg.createdAt * 1000)} />}
              {showDivider && <NewMessagesDivider />}
              <div className="py-0.5">
                <MessageItem
                  message={msg}
                  profile={profiles[msg.pubkey]}
                  isOwn={msg.pubkey === myPubkey}
                  showAvatar={showAvatar}
                  onReply={onReply}
                  onRetry={onRetry}
                  onReact={onReact}
                />
              </div>
            </div>
          )
        }}
      />
      {jumpNotice && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700/50 rounded-xl px-3 py-2 shadow-lg">
          <p className="text-xs text-gray-300">Message not available</p>
        </div>
      )}
      {!atBottom && (
        <button
          onClick={() => virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: 'end', behavior: 'smooth' })}
          className="absolute bottom-4 right-4 w-10 h-10 bg-gray-800/90 hover:bg-gray-700 border border-gray-700/50 rounded-full flex items-center justify-center shadow-lg transition-colors"
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={20} className="text-white" />
        </button>
      )}
    </div>
  )
}
