import { useState } from 'react'
import { X, Copy, Check, MessageCircle } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useNostrStore } from '../../store/nostrStore'
import { Avatar } from './Avatar'
import { getDisplayName } from '../../lib/fileUtils'

export function ProfileCard() {
  const {
    viewingProfilePubkey, setViewingProfilePubkey,
    profiles, contacts, publicKey,
    setActiveChat, addContact,
  } = useNostrStore()
  const [copied, setCopied] = useState<string | null>(null)

  if (!viewingProfilePubkey) return null

  const profile = profiles[viewingProfilePubkey] ?? contacts.find(c => c.pubkey === viewingProfilePubkey)?.profile
  const name = getDisplayName(profile, viewingProfilePubkey, 16)
  const isOwnProfile = viewingProfilePubkey === publicKey

  let npub = ''
  try { npub = nip19.npubEncode(viewingProfilePubkey) } catch { /* ignore */ }

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleSendMessage = () => {
    addContact(viewingProfilePubkey)
    setActiveChat(viewingProfilePubkey, 'dm')
    setViewingProfilePubkey(null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => setViewingProfilePubkey(null)}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">Profile</h2>
          <button
            onClick={() => setViewingProfilePubkey(null)}
            className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar picture={profile?.picture} name={name} pubkey={viewingProfilePubkey} size="lg" />
            <div className="min-w-0">
              <p className="text-white font-semibold text-base truncate">{name}</p>
              {profile?.nip05 && (
                <p className="text-green-400 text-sm truncate">{profile.nip05}</p>
              )}
            </div>
          </div>

          {profile?.about && (
            <p className="text-gray-400 text-sm leading-relaxed line-clamp-4">{profile.about}</p>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Public Key</p>
            <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5">
              <span className="flex-1 text-xs font-mono text-gray-300 truncate">{npub}</span>
              <button
                onClick={() => copy(npub, 'npub')}
                className="text-gray-400 hover:text-purple-400 transition-colors flex-shrink-0"
                title="Copy public key"
              >
                {copied === 'npub' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          {!isOwnProfile && (
            <button
              onClick={handleSendMessage}
              className="w-full flex items-center justify-center gap-2 py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors"
            >
              <MessageCircle size={16} />
              Send Message
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
