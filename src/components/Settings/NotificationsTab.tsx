import { useState } from 'react'
import { Bell, BellOff, Volume2, VolumeX, Check, AlertCircle } from 'lucide-react'
import { useNostrStore } from '../../store/nostrStore'
import { requestNotificationPermission } from '../../lib/notifications'

const DND_PRESETS: { label: string; ms: number | null }[] = [
  { label: '1 hour',   ms: 60 * 60 * 1000 },
  { label: '8 hours',  ms: 8 * 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'Until I turn off', ms: null },
]

function Toggle({
  checked, onChange, label, sublabel,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; sublabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-sm text-white">{label}</p>
        {sublabel && <p className="text-xs text-gray-500 mt-0.5">{sublabel}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-purple-600' : 'bg-gray-700'}`}
        role="switch"
        aria-checked={checked}
      >
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${checked ? 'left-5' : 'left-1'}`} />
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 space-y-1">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pb-1">{title}</p>
      {children}
    </div>
  )
}

export function NotificationsTab() {
  const { notificationSettings: ns, updateNotificationSettings } = useNostrStore()
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  )

  const handleRequestPermission = async () => {
    const p = await requestNotificationPermission()
    setPermission(p)
  }

  const dndActive = ns.dndEnabled && (ns.dndUntil === null || Date.now() < ns.dndUntil)

  const enableDnd = (presetMs: number | null) => {
    updateNotificationSettings({
      dndEnabled: true,
      dndUntil: presetMs === null ? null : Date.now() + presetMs,
    })
  }

  const disableDnd = () => {
    updateNotificationSettings({ dndEnabled: false, dndUntil: null })
  }

  const dndLabel = () => {
    if (!dndActive) return null
    if (ns.dndUntil === null) return 'Until you turn off'
    const diff = ns.dndUntil - Date.now()
    if (diff <= 0) return null
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    return h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`
  }

  return (
    <div className="space-y-4">
      {/* Permission banner */}
      {permission === 'default' && (
        <div className="bg-purple-900/30 border border-purple-500/40 rounded-xl p-4 flex items-start gap-3">
          <Bell size={18} className="text-purple-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-white font-semibold">Enable desktop notifications</p>
            <p className="text-xs text-gray-400 mt-0.5">Get alerted for new DMs and @mentions even when the app is in the background.</p>
          </div>
          <button
            onClick={handleRequestPermission}
            className="flex-shrink-0 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Allow
          </button>
        </div>
      )}

      {permission === 'granted' && (
        <div className="flex items-center gap-2 text-green-400 text-sm bg-green-900/20 border border-green-500/20 rounded-xl px-4 py-2.5">
          <Check size={15} />
          Desktop notifications enabled
        </div>
      )}

      {permission === 'denied' && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-500/20 rounded-xl px-4 py-2.5">
          <AlertCircle size={15} />
          <span>Notifications blocked — enable them in your browser settings.</span>
        </div>
      )}

      {/* DMs */}
      <Section title="Direct Messages">
        <Toggle
          label="Show notifications"
          sublabel="Critical — banner appears for every DM"
          checked={ns.dmEnabled}
          onChange={v => updateNotificationSettings({ dmEnabled: v })}
        />
        <div className="border-t border-gray-700/50" />
        <Toggle
          label="Play sound"
          checked={ns.dmSound}
          onChange={v => updateNotificationSettings({ dmSound: v })}
        />
      </Section>

      {/* Channels */}
      <Section title="Channels">
        <Toggle
          label="Show @mention notifications"
          sublabel="Banner when someone mentions you in a channel"
          checked={ns.mentionEnabled}
          onChange={v => updateNotificationSettings({ mentionEnabled: v })}
        />
        <div className="border-t border-gray-700/50" />
        <Toggle
          label="Play sound for @mentions"
          checked={ns.mentionSound}
          onChange={v => updateNotificationSettings({ mentionSound: v })}
        />
        <div className="border-t border-gray-700/50" />
        <Toggle
          label="Show all channel messages"
          sublabel="Off by default — badge indicator only"
          checked={ns.groupEnabled}
          onChange={v => updateNotificationSettings({ groupEnabled: v })}
        />
      </Section>

      {/* Do Not Disturb */}
      <Section title="Do Not Disturb">
        {dndActive ? (
          <div className="py-1 space-y-3">
            <div className="flex items-center gap-2 text-amber-400">
              <BellOff size={16} />
              <div>
                <p className="text-sm font-semibold text-white">DnD is on</p>
                {dndLabel() && <p className="text-xs text-amber-400">{dndLabel()}</p>}
              </div>
            </div>
            <button
              onClick={disableDnd}
              className="w-full py-2 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-400 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Volume2 size={15} />
              Turn off DnD
            </button>
          </div>
        ) : (
          <div className="py-1 space-y-2">
            <p className="text-xs text-gray-500">Silence all notifications for a set period.</p>
            <div className="grid grid-cols-2 gap-2">
              {DND_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => enableDnd(p.ms)}
                  className="py-2 bg-gray-900 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5"
                >
                  <VolumeX size={12} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <p className="text-xs text-gray-600 text-center px-2">
        Individual chats can also be muted via the bell icon in the sidebar.
      </p>
    </div>
  )
}
