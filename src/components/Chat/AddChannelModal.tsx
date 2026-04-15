import { useState } from 'react'
import { X, Hash, Search, Plus, Loader2 } from 'lucide-react'
import { useNostrStore } from '../../store/nostrStore'
import { useChannelDiscovery, createChannel } from '../../hooks/useNostrSubscriptions'

interface AddChannelModalProps {
  onClose: () => void
}

export function AddChannelModal({ onClose }: AddChannelModalProps) {
  const { channels, relays, getPrivateKey, addChannel, joinChannel, setActiveChat } = useNostrStore()
  const [tab, setTab] = useState<'discover' | 'create'>('discover')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [error, setError] = useState('')

  useChannelDiscovery()

  const filtered = channels.filter(ch =>
    ch.name.toLowerCase().includes(search.toLowerCase()) ||
    (ch.about || '').toLowerCase().includes(search.toLowerCase())
  )

  const handleJoin = (channelId: string) => {
    joinChannel(channelId)
    setActiveChat(channelId, 'channel')
    onClose()
  }

  const handleCreate = async () => {
    if (!name.trim()) { setError('Channel name is required'); return }
    const sk = getPrivateKey()
    if (!sk) return
    setCreating(true)
    setError('')
    try {
      const event = await createChannel(sk, name.trim(), about.trim(), relays)
      addChannel({
        id: event.id,
        name: name.trim(),
        about: about.trim(),
        creatorPubkey: event.pubkey,
        relayUrl: relays[0],
      })
      joinChannel(event.id)
      setActiveChat(event.id, 'channel')
      onClose()
    } catch {
      setError('Failed to create channel. Check relay connection.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Channels</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-6 pt-4">
          <button
            onClick={() => setTab('discover')}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === 'discover' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Discover
          </button>
          <button
            onClick={() => setTab('create')}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === 'create' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Create New
          </button>
        </div>

        <div className="p-6 pt-4 space-y-4 overflow-y-auto scrollbar-thin">
          {tab === 'discover' && (
            <>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search channels..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white placeholder-gray-500 text-sm outline-none focus:border-purple-500 transition-colors"
                />
              </div>

              <div className="space-y-1 max-h-80 overflow-y-auto scrollbar-thin">
                {filtered.length === 0 && (
                  <div className="text-center py-8">
                    <Loader2 size={24} className="animate-spin text-purple-500 mx-auto mb-2" />
                    <p className="text-gray-500 text-sm">Fetching channels from relays...</p>
                  </div>
                )}
                {filtered.map(ch => (
                  <button
                    key={ch.id}
                    onClick={() => handleJoin(ch.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors text-left group"
                  >
                    <div className="w-10 h-10 bg-gray-800 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-purple-600/20 transition-colors">
                      <Hash size={18} className="text-gray-400 group-hover:text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{ch.name}</p>
                      {ch.about && (
                        <p className="text-gray-500 text-xs truncate mt-0.5">{ch.about}</p>
                      )}
                    </div>
                    <span className="text-purple-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      Join →
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'create' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Channel Name *
                </label>
                <input
                  value={name}
                  onChange={e => { setName(e.target.value); setError('') }}
                  placeholder="e.g. general"
                  className="mt-1 w-full bg-gray-800 border border-gray-700 focus:border-purple-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 text-sm outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Description
                </label>
                <textarea
                  value={about}
                  onChange={e => setAbout(e.target.value)}
                  placeholder="What's this channel about?"
                  rows={3}
                  className="mt-1 w-full bg-gray-800 border border-gray-700 focus:border-purple-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 text-sm outline-none transition-colors resize-none"
                />
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <button
                onClick={handleCreate}
                disabled={creating}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {creating ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                {creating ? 'Creating...' : 'Create Channel'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
