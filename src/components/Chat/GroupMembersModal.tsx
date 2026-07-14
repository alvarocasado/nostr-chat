import { useState } from 'react'
import { X, UserPlus } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useNostrStore, type Group } from '../../store/nostrStore'
import { Avatar } from './Avatar'
import { getDisplayName } from '../../lib/fileUtils'
import { addGroupMember, removeGroupMember } from '../../lib/groupManage'

export function GroupMembersModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const { publicKey, profiles } = useNostrStore()
  const isCreator = publicKey === group.creatorPubkey
  const [input, setInput] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolveInput = (): string | null => {
    const raw = input.trim()
    if (raw.startsWith('npub1')) {
      try {
        const d = nip19.decode(raw)
        if (d.type === 'npub') return d.data
      } catch { /* fall through */ }
      return null
    }
    return /^[0-9a-f]{64}$/.test(raw) ? raw : null
  }

  const handleInvite = async () => {
    const pk = resolveInput()
    if (!pk) { setError('Enter a valid npub or hex pubkey'); return }
    if (pk === publicKey || group.memberPubkeys.includes(pk)) { setError('Already a member'); return }
    setBusy(true); setError(null)
    try { await addGroupMember(group, pk); setInput('') }
    catch { setError('Invite failed. Check relay connection and retry.') }
    finally { setBusy(false) }
  }

  const handleRemove = async (pk: string) => {
    if (confirming !== pk) { setConfirming(pk); return }
    setBusy(true); setError(null)
    try { await removeGroupMember(group, pk); setConfirming(null) }
    catch { setError('Removal failed. Check relay connection and retry.') }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl max-h-[92dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
          <h2 className="font-bold text-white text-lg">Members · {group.memberPubkeys.length}</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {group.memberPubkeys.map(pk => {
            const name = getDisplayName(profiles[pk], pk, 12)
            const isSelf = pk === publicKey
            return (
              <div key={pk} className="flex items-center gap-3 py-1.5">
                <Avatar picture={profiles[pk]?.picture} name={name} pubkey={pk} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{name}</p>
                  {pk === group.creatorPubkey && (
                    <p className="text-xs text-gray-500">creator</p>
                  )}
                </div>
                {isCreator && !isSelf && (
                  <button
                    onClick={() => handleRemove(pk)}
                    disabled={busy}
                    aria-label={confirming === pk ? 'Confirm — rotates key' : `Remove ${name}`}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-red-900/40 text-gray-300 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    {confirming === pk ? 'Confirm — rotates key' : 'Remove'}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {isCreator && (
          <div className="px-4 pb-2">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => { setInput(e.target.value); setError(null) }}
                placeholder="npub or hex pubkey"
                className="flex-1 bg-gray-800 border border-gray-700 focus:border-purple-500/60 rounded-xl px-3 py-2.5 text-white text-sm outline-none transition-colors"
              />
              <button
                onClick={handleInvite}
                disabled={busy}
                className="px-3 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-gray-300 hover:text-white transition-colors flex items-center gap-1.5 text-sm font-medium"
              >
                <UserPlus size={16} />
                Invite
              </button>
            </div>
          </div>
        )}

        {error !== null && (
          <div className="px-4 pb-2">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="px-4 py-4 border-t border-gray-800">
          <p className="text-xs text-gray-500">
            Anyone who was a member can still read messages from before their removal.
            Removing a member rotates the key so they can't read anything new.
          </p>
        </div>
      </div>
    </div>
  )
}
