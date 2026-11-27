import { useNostrStore } from '../../store/nostrStore'
import { Avatar } from '../Chat/Avatar'
import { getDisplayName } from '../../lib/fileUtils'
import { Toggle } from './NotificationsTab'
import type { LinkPreviewMode } from '../../lib/linkPreview'

const LINK_PREVIEW_OPTIONS: [LinkPreviewMode, string][] = [
  ['contacts', 'Contacts only'],
  ['all', 'Everyone'],
  ['off', 'Off'],
]

export function PrivacyTab() {
  const { blockedPubkeys, profiles, unblockPubkey, readReceiptsEnabled, setReadReceiptsEnabled, linkPreviews, setLinkPreviews } = useNostrStore()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1">Read receipts</h2>
        <Toggle
          checked={readReceiptsEnabled}
          onChange={setReadReceiptsEnabled}
          label="Send read receipts"
          sublabel="When on, contacts see when you read their direct messages, and you see theirs. Off means neither."
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-white mb-1">Link previews</h2>
        <p className="text-xs text-gray-500 mb-2">
          Previews send the link to microlink.io and load an image from the linked site, which can see your IP address.
        </p>
        <div role="radiogroup" aria-label="Link previews" className="flex gap-1 p-1 rounded-xl bg-gray-900 border border-gray-800">
          {LINK_PREVIEW_OPTIONS.map(([mode, label]) => (
            <button
              key={mode}
              role="radio"
              aria-checked={linkPreviews === mode}
              onClick={() => setLinkPreviews(mode)}
              className={`flex-1 px-3 py-1.5 rounded-lg text-sm transition-colors ${linkPreviews === mode ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-white mb-1">Blocked users</h2>
        <p className="text-xs text-gray-500">
          {blockedPubkeys.length === 0
            ? "You haven't blocked anyone."
            : `You've blocked ${blockedPubkeys.length} ${blockedPubkeys.length === 1 ? 'person' : 'people'}. Unblocking lets them message you again.`}
        </p>
      </div>

      <div className="space-y-1">
        {blockedPubkeys.map(pk => {
          const profile = profiles[pk]
          return (
            <div key={pk} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-900 border border-gray-800">
              <Avatar picture={profile?.picture} name={getDisplayName(profile, pk, 12)} pubkey={pk} size="sm" />
              <span className="flex-1 text-sm text-white truncate">{getDisplayName(profile, pk, 12)}</span>
              <button
                onClick={() => unblockPubkey(pk)}
                className="px-3 py-1.5 rounded-lg text-sm text-purple-400 hover:bg-purple-500/10 transition-colors"
              >
                Unblock
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
