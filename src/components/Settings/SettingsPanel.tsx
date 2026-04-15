import { useState } from 'react'
import { X, Plus, Trash2, Wifi, User, Key, Copy, Check, Save, Loader2 } from 'lucide-react'
import { useNostrStore } from '../../store/nostrStore'
import { publishProfile } from '../../hooks/useNostrSubscriptions'
import { Avatar } from '../Chat/Avatar'

interface SettingsPanelProps {
  onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const {
    publicKey, npub, nsec, profile, relays,
    addRelay, removeRelay, updateProfile, getPrivateKey,
  } = useNostrStore()

  const [tab, setTab] = useState<'profile' | 'relays' | 'keys'>('profile')
  const [newRelay, setNewRelay] = useState('')
  const [relayError, setRelayError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Profile form state
  const [displayName, setDisplayName] = useState(profile?.display_name || profile?.name || '')
  const [about, setAbout] = useState(profile?.about || '')
  const [picture, setPicture] = useState(profile?.picture || '')
  const [nip05, setNip05] = useState(profile?.nip05 || '')

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const addRelayHandler = () => {
    setRelayError('')
    const url = newRelay.trim()
    if (!url) return
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      setRelayError('URL must start with wss:// or ws://')
      return
    }
    addRelay(url)
    setNewRelay('')
  }

  const saveProfile = async () => {
    setSaving(true)
    setSaved(false)
    const sk = getPrivateKey()
    if (!sk) { setSaving(false); return }
    try {
      updateProfile({
        display_name: displayName,
        name: displayName,
        about,
        picture,
        nip05,
      })
      await publishProfile(sk, { display_name: displayName, name: displayName, about, picture, nip05 }, relays)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // ignore publish errors
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 flex-shrink-0">
          {(['profile', 'relays', 'keys'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition-colors ${
                tab === t ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-4">
          {/* Profile tab */}
          {tab === 'profile' && (
            <>
              <div className="flex items-center gap-4">
                <Avatar
                  picture={picture || profile?.picture}
                  name={displayName}
                  pubkey={publicKey || ''}
                  size="lg"
                />
                <div>
                  <p className="text-white font-semibold">{displayName || 'Unnamed'}</p>
                  <p className="text-gray-500 text-xs font-mono mt-0.5">{npub?.slice(0, 20)}...</p>
                </div>
              </div>

              <Field label="Display Name">
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="input-field"
                />
              </Field>
              <Field label="About">
                <textarea
                  value={about}
                  onChange={e => setAbout(e.target.value)}
                  placeholder="Tell others about yourself"
                  rows={3}
                  className="input-field resize-none"
                />
              </Field>
              <Field label="Profile Picture URL">
                <input
                  value={picture}
                  onChange={e => setPicture(e.target.value)}
                  placeholder="https://..."
                  className="input-field"
                />
              </Field>
              <Field label="NIP-05 Identifier">
                <input
                  value={nip05}
                  onChange={e => setNip05(e.target.value)}
                  placeholder="you@domain.com"
                  className="input-field"
                />
              </Field>

              <button
                onClick={saveProfile}
                disabled={saving}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={18} className="animate-spin" /> : saved ? <Check size={18} /> : <Save size={18} />}
                {saving ? 'Saving...' : saved ? 'Saved!' : 'Save & Publish'}
              </button>
            </>
          )}

          {/* Relays tab */}
          {tab === 'relays' && (
            <>
              <p className="text-gray-400 text-sm">
                Connected to {relays.length} relay{relays.length !== 1 ? 's' : ''}.
              </p>

              <div className="flex gap-2">
                <input
                  value={newRelay}
                  onChange={e => { setNewRelay(e.target.value); setRelayError('') }}
                  placeholder="wss://relay.example.com"
                  className="flex-1 bg-gray-800 border border-gray-700 focus:border-purple-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 text-sm font-mono outline-none transition-colors"
                  onKeyDown={e => e.key === 'Enter' && addRelayHandler()}
                />
                <button
                  onClick={addRelayHandler}
                  className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>
              {relayError && <p className="text-red-400 text-xs">{relayError}</p>}

              <div className="space-y-2">
                {relays.map(relay => (
                  <div
                    key={relay}
                    className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3"
                  >
                    <Wifi size={16} className="text-green-400 flex-shrink-0" />
                    <span className="flex-1 text-sm font-mono text-gray-200 truncate">{relay}</span>
                    <button
                      onClick={() => removeRelay(relay)}
                      className="text-gray-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-500/10"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Keys tab */}
          {tab === 'keys' && (
            <div className="space-y-4">
              <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-xl p-4">
                <p className="text-yellow-300 text-sm">
                  <strong>Never share your private key (nsec).</strong> Anyone with it has full control of your account.
                </p>
              </div>

              <KeyRow
                label="Public Key (npub)"
                value={npub || ''}
                icon={<User size={16} className="text-purple-400" />}
                onCopy={() => copy(npub || '', 'npub')}
                copied={copied === 'npub'}
              />
              <KeyRow
                label="Public Key (hex)"
                value={publicKey || ''}
                icon={<User size={16} className="text-purple-400" />}
                onCopy={() => copy(publicKey || '', 'pkHex')}
                copied={copied === 'pkHex'}
              />
              <KeyRow
                label="Private Key (nsec) — Keep Secret!"
                value={nsec || ''}
                icon={<Key size={16} className="text-red-400" />}
                onCopy={() => copy(nsec || '', 'nsec')}
                copied={copied === 'nsec'}
                secret
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</label>
      <div className="mt-1 [&_.input-field]:w-full [&_.input-field]:bg-gray-800 [&_.input-field]:border [&_.input-field]:border-gray-700 [&_.input-field]:focus:border-purple-500 [&_.input-field]:rounded-xl [&_.input-field]:px-4 [&_.input-field]:py-2.5 [&_.input-field]:text-white [&_.input-field]:placeholder-gray-500 [&_.input-field]:text-sm [&_.input-field]:outline-none [&_.input-field]:transition-colors">
        {children}
      </div>
    </div>
  )
}

function KeyRow({
  label, value, icon, onCopy, copied, secret = false,
}: {
  label: string
  value: string
  icon: React.ReactNode
  onCopy: () => void
  copied: boolean
  secret?: boolean
}) {
  const [show, setShow] = useState(false)

  return (
    <div>
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
        {icon} {label}
      </label>
      <div className="mt-1 flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
        <span className="flex-1 text-xs font-mono text-gray-300 break-all">
          {secret && !show ? '•'.repeat(40) : value}
        </span>
        {secret && (
          <button
            onClick={() => setShow(!show)}
            className="text-gray-400 hover:text-white transition-colors text-xs"
          >
            {show ? 'Hide' : 'Show'}
          </button>
        )}
        <button onClick={onCopy} className="text-gray-400 hover:text-purple-400 transition-colors flex-shrink-0">
          {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  )
}
