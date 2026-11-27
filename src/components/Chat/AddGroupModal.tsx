// src/components/Chat/AddGroupModal.tsx
import { useState } from 'react'
import { X, Plus, Users, Loader2 } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useNostrStore } from '../../store/nostrStore'
import { generateGroupKey } from '../../lib/groupCrypto'
import { getSigner } from '../../lib/signer'
import {
  buildGroupMetadataEvent,
  buildGroupKeyBackupEvent,
  publishEvent,
} from '../../lib/nostr'
import { sendPrivate } from '../../lib/privateSend'
import { serializeGroupInvite } from '../../lib/groupMembership'
import { roomIdFor, MAX_ROOM_SIZE } from '../../lib/nip17Room'
import { fetchDmCaps } from '../../lib/dmCaps'
import { getDisplayName } from '../../lib/fileUtils'

interface AddGroupModalProps {
  onClose: () => void
}

export function AddGroupModal({ onClose }: AddGroupModalProps) {
  const { publicKey, addGroup, setGroupKey, setActiveChat, signerCaps } = useNostrStore()
  const [privateRoom, setPrivateRoom] = useState(false)
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
    } else if (!/^[0-9a-fA-F]{64}$/.test(input)) {
      setError('Enter a valid npub or 64-char hex pubkey')
      return
    }
    if (pubkey === publicKey) { setError('You are already in the group'); return }
    if (memberPubkeys.includes(pubkey)) { setError('Already added'); return }
    if (privateRoom && memberPubkeys.length + 1 >= MAX_ROOM_SIZE) {
      setError(`Private groups are limited to ${MAX_ROOM_SIZE} people including you`)
      return
    }
    setMemberPubkeys(prev => [...prev, pubkey])
    setMemberInput('')
    setError('')
  }

  // NIP-17 room: nothing to publish or invite; the first message creates it
  // for everyone. Only check that each member can read gift wraps.
  const handleCreateRoom = async () => {
    if (!getSigner() || !publicKey) return
    if (memberPubkeys.length < 2) { setError('Add at least two people (for one person, send a direct message)'); return }
    if (memberPubkeys.length + 1 > MAX_ROOM_SIZE) { setError(`Private groups are limited to ${MAX_ROOM_SIZE} people including you`); return }
    setCreating(true)
    setError('')
    try {
      const { readRelays, profiles } = useNostrStore.getState()
      const caps = await Promise.all(memberPubkeys.map(pk => fetchDmCaps(pk, readRelays())))
      const missing = memberPubkeys.filter((_, i) => !caps[i].nip17)
      if (missing.length > 0) {
        setError(`${missing.map(pk => getDisplayName(profiles[pk], pk)).join(', ')} can't receive private group messages yet`)
        return
      }
      const allMembers = [publicKey, ...memberPubkeys]
      const roomId = await roomIdFor(allMembers)
      addGroup({
        id: roomId,
        name: name.trim() || memberPubkeys.map(pk => getDisplayName(profiles[pk], pk)).join(', '),
        creatorPubkey: publicKey,
        memberPubkeys: allMembers,
        relayUrl: '',
        nip17: true,
        ...(name.trim() && { subjectPending: true }),
      })
      setActiveChat(roomId, 'group')
      onClose()
    } catch {
      setError('Failed to create group. Check relay connection.')
    } finally {
      setCreating(false)
    }
  }

  const handleCreate = async () => {
    if (privateRoom) return handleCreateRoom()
    if (!name.trim()) { setError('Group name is required'); return }
    if (!getSigner() || !publicKey) return
    setCreating(true)
    setError('')
    try {
      const groupId = crypto.randomUUID()
      const groupKeyHex = generateGroupKey()
      const allMembers = [publicKey, ...memberPubkeys]

      const writeRelays = useNostrStore.getState().writeRelays()
      await publishEvent(writeRelays, await buildGroupMetadataEvent(groupKeyHex, groupId, name.trim(), about.trim(), allMembers))
      await publishEvent(writeRelays, await buildGroupKeyBackupEvent(groupId, [groupKeyHex]))
      for (const memberPubkey of memberPubkeys) {
        await sendPrivate(serializeGroupInvite(groupId, groupKeyHex, name.trim(), allMembers), memberPubkey)
      }

      addGroup({
        id: groupId,
        name: name.trim(),
        about: about.trim() || undefined,
        creatorPubkey: publicKey,
        memberPubkeys: allMembers,
        relayUrl: writeRelays[0],
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
          {signerCaps.nip44 && (
            <label className="flex items-start gap-3 bg-gray-800/60 border border-gray-700 rounded-xl px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={privateRoom}
                onChange={e => { setPrivateRoom(e.target.checked); setError('') }}
                className="mt-0.5 accent-purple-600"
              />
              <span className="text-sm">
                <span className="block text-white font-medium">Private group (NIP-17)</span>
                <span className="block text-gray-400 text-xs mt-0.5">
                  Up to {MAX_ROOM_SIZE} people. Hides who's in it from relays and works with other NIP-17 apps. Members can't be changed later.
                </span>
              </span>
            </label>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">{privateRoom ? 'Group name' : 'Group name *'}</label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              placeholder="e.g. Team Alpha"
              className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/60 rounded-xl px-3 py-2.5 text-white text-sm outline-none transition-colors"
            />
          </div>
          {!privateRoom && <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Description</label>
            <input
              value={about}
              onChange={e => { setAbout(e.target.value); setError('') }}
              placeholder="Optional"
              className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/60 rounded-xl px-3 py-2.5 text-white text-sm outline-none transition-colors"
            />
          </div>}
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
            disabled={creating || (!privateRoom && !name.trim())}
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
