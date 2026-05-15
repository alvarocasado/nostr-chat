// src/components/Chat/AddGroupModal.tsx
import { useState } from 'react'
import { X, Plus, Users, Loader2 } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useNostrStore } from '../../store/nostrStore'
import { generateGroupKey } from '../../lib/groupCrypto'
import {
  buildGroupMetadataEvent,
  buildGroupKeyBackupEvent,
  buildGroupInviteEvent,
  publishEvent,
} from '../../lib/nostr'

interface AddGroupModalProps {
  onClose: () => void
}

export function AddGroupModal({ onClose }: AddGroupModalProps) {
  const { relays, publicKey, getPrivateKey, addGroup, setGroupKey, setActiveChat } = useNostrStore()
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [memberInput, setMemberInput] = useState('')
  const [memberPubkeys, setMemberPubkeys] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const addMember = () => {
    const input = memberInput.trim()
    if (!input) return
    let pubkey = input
    if (input.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(input)
        if (decoded.type !== 'npub') { setError('Invalid npub'); return }
        pubkey = decoded.data as string
      } catch { setError('Invalid npub format'); return }
    } else if (!/^[0-9a-f]{64}$/.test(input)) {
      setError('Enter a valid npub or 64-char hex pubkey')
      return
    }
    if (pubkey === publicKey) { setError('You are already in the group'); return }
    if (memberPubkeys.includes(pubkey)) { setError('Already added'); return }
    setMemberPubkeys(prev => [...prev, pubkey])
    setMemberInput('')
    setError('')
  }

  const handleCreate = async () => {
    if (!name.trim()) { setError('Group name is required'); return }
    const sk = getPrivateKey()
    if (!sk || !publicKey) return
    setCreating(true)
    setError('')
    try {
      const groupId = crypto.randomUUID()
      const groupKeyHex = generateGroupKey()
      const allMembers = [publicKey, ...memberPubkeys]

      await publishEvent(relays, await buildGroupMetadataEvent(sk, groupKeyHex, groupId, name.trim(), about.trim(), allMembers))
      await publishEvent(relays, await buildGroupKeyBackupEvent(sk, groupId, groupKeyHex))
      for (const memberPubkey of memberPubkeys) {
        await publishEvent(relays, await buildGroupInviteEvent(sk, memberPubkey, groupId, groupKeyHex, name.trim()))
      }

      addGroup({
        id: groupId,
        name: name.trim(),
        about: about.trim() || undefined,
        creatorPubkey: publicKey,
        memberPubkeys: allMembers,
        relayUrl: relays[0],
      })
      setGroupKey(groupId, groupKeyHex)
      setActiveChat(groupId, 'group')
      onClose()
    } catch {
      setError('Failed to create group. Check relay connection.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl max-h-[92dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
          <h2 className="font-bold text-white text-lg">New Group</h2>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Group name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Team Alpha"
              className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/60 rounded-xl px-3 py-2.5 text-white text-sm outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Description</label>
            <input
              value={about}
              onChange={e => setAbout(e.target.value)}
              placeholder="Optional"
              className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/60 rounded-xl px-3 py-2.5 text-white text-sm outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Add members</label>
            <div className="flex gap-2">
              <input
                value={memberInput}
                onChange={e => setMemberInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMember() } }}
                placeholder="npub1… or hex pubkey"
                className="flex-1 bg-gray-800 border border-gray-700 focus:border-purple-500/60 rounded-xl px-3 py-2.5 text-white text-sm outline-none transition-colors"
              />
              <button
                onClick={addMember}
                className="px-3 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-xl text-gray-300 hover:text-white transition-colors"
              >
                <Plus size={16} />
              </button>
            </div>
            {memberPubkeys.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {memberPubkeys.map(pk => (
                  <span key={pk} className="flex items-center gap-1 bg-gray-800 rounded-lg px-2 py-1 text-xs text-gray-300">
                    {pk.slice(0, 8)}…{pk.slice(-4)}
                    <button onClick={() => setMemberPubkeys(prev => prev.filter(p => p !== pk))} className="text-gray-500 hover:text-white ml-0.5">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        <div className="px-4 py-4 border-t border-gray-800">
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
            {creating ? 'Creating…' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  )
}
