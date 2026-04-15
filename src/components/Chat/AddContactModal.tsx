import { useState } from 'react'
import { X, Search, UserPlus, Loader2 } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useNostrStore } from '../../store/nostrStore'
import { fetchEvent } from '../../lib/nostr'
import { parseProfile } from '../../lib/nostr'
import { Avatar } from './Avatar'

interface AddContactModalProps {
  onClose: () => void
}

export function AddContactModal({ onClose }: AddContactModalProps) {
  const { relays, addContact, setProfile, setActiveChat, setSidebarTab } = useNostrStore()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [found, setFound] = useState<{ pubkey: string; name?: string; about?: string; picture?: string } | null>(null)
  const [error, setError] = useState('')

  const resolvePubkey = (val: string): string | null => {
    val = val.trim()
    if (/^[0-9a-fA-F]{64}$/.test(val)) return val
    try {
      const decoded = nip19.decode(val)
      if (decoded.type === 'npub') return decoded.data as string
    } catch {}
    return null
  }

  const handleSearch = async () => {
    setError('')
    setFound(null)
    const pk = resolvePubkey(input)
    if (!pk) {
      setError('Enter a valid npub or 64-char hex pubkey')
      return
    }

    setLoading(true)
    try {
      const event = await fetchEvent(relays, { kinds: [0], authors: [pk] })
      if (event) {
        const profile = parseProfile(event)
        setFound({ pubkey: pk, name: profile.display_name || profile.name, about: profile.about, picture: profile.picture })
        setProfile(pk, profile)
      } else {
        setFound({ pubkey: pk })
      }
    } catch {
      setFound({ pubkey: pk })
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    if (!found) return
    addContact(found.pubkey)
    setSidebarTab('dms')
    setActiveChat(found.pubkey, 'dm')
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">New Message</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Nostr Public Key
            </label>
            <div className="mt-1 flex gap-2">
              <input
                value={input}
                onChange={e => { setInput(e.target.value); setError(''); setFound(null) }}
                placeholder="npub1... or hex pubkey"
                className="flex-1 bg-gray-800 border border-gray-700 focus:border-purple-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 text-sm font-mono outline-none transition-colors"
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
              <button
                onClick={handleSearch}
                disabled={loading || !input.trim()}
                className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-2 text-sm font-semibold"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                {loading ? '' : 'Find'}
              </button>
            </div>
            {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
          </div>

          {found && (
            <div className="bg-gray-800 rounded-xl p-4 flex items-center gap-4">
              <Avatar
                picture={found.picture}
                name={found.name}
                pubkey={found.pubkey}
                size="lg"
              />
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold truncate">
                  {found.name || 'Unknown User'}
                </p>
                <p className="text-gray-400 text-xs font-mono truncate mt-0.5">
                  {found.pubkey.slice(0, 16)}...
                </p>
                {found.about && (
                  <p className="text-gray-500 text-xs mt-1 line-clamp-2">{found.about}</p>
                )}
              </div>
              <button
                onClick={handleAdd}
                className="flex-shrink-0 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-xl transition-colors flex items-center gap-2"
              >
                <UserPlus size={15} />
                Message
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
