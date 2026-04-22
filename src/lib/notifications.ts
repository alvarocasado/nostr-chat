import { useNostrStore } from '../store/nostrStore'
import { getDisplayName } from './fileUtils'

export type NotifType = 'dm' | 'mention' | 'channel'

function playSound(type: NotifType) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    // DMs: higher pitch (more urgent); mentions: medium; channels: not played
    osc.frequency.value = type === 'dm' ? 880 : 660
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)
  } catch { /* AudioContext unavailable */ }
}

// Repeating two-tone ringtone for incoming calls. Returns a stop function.
export function playRingtone(): () => void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const INTERVAL = 1.5  // seconds between ring cycles
    const MAX_RINGS = 40  // ~60 seconds max

    for (let i = 0; i < MAX_RINGS; i++) {
      const t = ctx.currentTime + i * INTERVAL
      for (const [freq, offset] of [[880, 0], [1100, 0.35]] as const) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.25, t + offset)
        gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.28)
        osc.start(t + offset)
        osc.stop(t + offset + 0.28)
      }
    }
    return () => { ctx.close().catch(() => {}) }
  } catch {
    return () => {}
  }
}

/**
 * Fire a browser Notification if all conditions allow it.
 * Safe to call outside React — reads store state directly.
 */
export function fireNotification(
  chatId: string,
  type: NotifType,
  title: string,
  body: string,
  icon?: string,
) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  const { notificationSettings: ns, mutedChats, activeChatId } = useNostrStore.getState()

  // DnD check
  if (ns.dndEnabled) {
    if (ns.dndUntil === null || Date.now() < ns.dndUntil) return
    // Expired — let it through (store will show DnD as off on next render)
  }

  // Per-chat mute check
  const muteUntil = mutedChats[chatId]
  if (muteUntil !== undefined) {
    if (muteUntil === null || Date.now() < muteUntil) return
  }

  // Per-type toggle
  if (type === 'dm' && !ns.dmEnabled) return
  if (type === 'mention' && !ns.mentionEnabled) return
  if (type === 'channel' && !ns.groupEnabled) return

  // Contextual suppression: app focused AND user is already viewing this chat
  if (document.visibilityState === 'visible' && activeChatId === chatId) return

  const n = new Notification(title, {
    body: body.length > 120 ? body.slice(0, 120) + '…' : body,
    icon: icon || `${import.meta.env.BASE_URL}favicon.ico`,
    tag: chatId,
  })
  n.onclick = () => { window.focus(); n.close() }

  const shouldSound = (type === 'dm' && ns.dmSound) || (type === 'mention' && ns.mentionSound)
  if (shouldSound) playSound(type)
}

/**
 * Fire an incoming-call notification (ringtone + optional banner when backgrounded).
 * Returns a stop function — call it when the call is accepted, rejected, or cancelled.
 */
export function fireCallNotification(peerPubkey: string): () => void {
  const { notificationSettings: ns, profiles, contacts } = useNostrStore.getState()

  const dndActive = ns.dndEnabled && (ns.dndUntil === null || Date.now() < ns.dndUntil)

  // Browser banner — only when app is in background and permission granted
  if (
    !dndActive &&
    ns.callEnabled &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted' &&
    document.visibilityState !== 'visible'
  ) {
    const profile = contacts.find(c => c.pubkey === peerPubkey)?.profile || profiles[peerPubkey]
    const name = getDisplayName(profile, peerPubkey)
    const n = new Notification('Incoming Call', {
      body: `${name} is calling`,
      icon: profile?.picture || `${import.meta.env.BASE_URL}favicon.ico`,
      tag: `call-${peerPubkey}`,
    })
    n.onclick = () => { window.focus(); n.close() }
  }

  // Ringtone
  if (!dndActive && ns.callSound) return playRingtone()
  return () => {}
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}
