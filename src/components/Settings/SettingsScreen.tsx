import { useState, useEffect } from 'react'
import { Plus, Trash2, Wifi, User, Key, Copy, Check, Save, Loader2, QrCode, ChevronDown, ChevronUp, Link, Share2, Eye, EyeOff } from 'lucide-react'
import { useNostrStore } from '../../store/nostrStore'
import { publishProfile } from '../../hooks/useNostrSubscriptions'
import { getSigner } from '../../lib/signer'
import { Avatar } from '../Chat/Avatar'
import { QRCodeDisplay } from './QRCodeDisplay'
import { NotificationsTab } from './NotificationsTab'
import { CallsTab } from './CallsTab'
import { FilesTab } from './FilesTab'
import { PrivacyTab } from './PrivacyTab'
import { keyProtection, loadLocalKey, setPassphrase } from '../../lib/keyStore'
import { getAuthMethod } from '../../lib/userDb'

const TAB_LABELS: Record<string, string> = {
  profile: 'Profile',
  relays: 'Relays',
  keys: 'Keys',
  calls: 'Calls',
  files: 'Files',
  notifications: 'Notifications',
  privacy: 'Privacy',
}

export function SettingsScreen() {
  const {
    publicKey, npub, nsec, profile, relays,
    activeSettingsTab,
    addRelay, removeRelay, updateProfile,
  } = useNostrStore()

  const [newRelay, setNewRelay] = useState('')
  const [relayError, setRelayError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showQR, setShowQR] = useState(false)

  // Key protection state
  const authMethod = getAuthMethod()
  const [protection, setProtection] = useState<'none' | 'device' | 'passphrase' | null>(null)

  // Set passphrase form (device -> passphrase)
  const [setNewPass, setSetNewPass] = useState('')
  const [setConfirmPass, setSetConfirmPass] = useState('')
  const [setPassError, setSetPassError] = useState('')
  const [setPassSuccess, setSetPassSuccess] = useState('')
  const [setPassBusy, setSetPassBusy] = useState(false)
  const [showSetNew, setShowSetNew] = useState(false)
  const [showSetConfirm, setShowSetConfirm] = useState(false)

  // Change passphrase form (passphrase -> passphrase)
  const [changeCurrent, setChangeCurrent] = useState('')
  const [changeNew, setChangeNew] = useState('')
  const [changeConfirm, setChangeConfirm] = useState('')
  const [changeError, setChangeError] = useState('')
  const [changeSuccess, setChangeSuccess] = useState('')
  const [changeBusy, setChangeBusy] = useState(false)
  const [showChangeCurrent, setShowChangeCurrent] = useState(false)
  const [showChangeNew, setShowChangeNew] = useState(false)
  const [showChangeConfirm, setShowChangeConfirm] = useState(false)

  // Remove passphrase form (passphrase -> device)
  const [removeCurrent, setRemoveCurrent] = useState('')
  const [removeError, setRemoveError] = useState('')
  const [removeSuccess, setRemoveSuccess] = useState('')
  const [removeBusy, setRemoveBusy] = useState(false)
  const [showRemoveCurrent, setShowRemoveCurrent] = useState(false)

  useEffect(() => {
    if (activeSettingsTab === 'keys' && authMethod !== 'nip07') {
      keyProtection().then(setProtection)
    }
  }, [activeSettingsTab, authMethod])

  const [displayName, setDisplayName] = useState(profile?.display_name || profile?.name || '')
  const [about, setAbout] = useState(profile?.about || '')
  const [picture, setPicture] = useState(profile?.picture || '')
  const [nip05, setNip05] = useState(profile?.nip05 || '')

  const contactLink = npub
    ? `${window.location.origin}${import.meta.env.BASE_URL}?contact=${npub}`
    : ''

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const addRelayHandler = () => {
    setRelayError('')
    const url = newRelay.trim()
    if (!url) return
    let parsed: URL
    try { parsed = new URL(url) } catch {
      setRelayError('Invalid URL — must be a valid wss:// address')
      return
    }
    if (parsed.protocol !== 'wss:') {
      setRelayError('Only wss:// (secure WebSocket) relays are allowed')
      return
    }
    if (relays.includes(parsed.toString())) {
      setRelayError('Relay already added')
      return
    }
    addRelay(parsed.toString())
    setNewRelay('')
  }

  const saveProfile = async () => {
    setSaving(true)
    setSaved(false)
    if (!getSigner()) { setSaving(false); return }
    try {
      updateProfile({ display_name: displayName, name: displayName, about, picture, nip05 })
      await publishProfile({ display_name: displayName, name: displayName, about, picture, nip05 }, relays)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore publish errors */ }
    finally { setSaving(false) }
  }

  const refreshProtection = async () => {
    const p = await keyProtection()
    setProtection(p)
  }

  const handleSetPassphrase = async () => {
    setSetPassError('')
    setSetPassSuccess('')
    if (!setNewPass) { setSetPassError('Passphrase must not be empty.'); return }
    if (setNewPass !== setConfirmPass) { setSetPassError('Passphrases do not match.'); return }
    setSetPassBusy(true)
    try {
      const sk = await loadLocalKey()
      if (!sk) { setSetPassError('Could not load local key. Try again.'); return }
      await setPassphrase(sk, setNewPass)
      setSetNewPass('')
      setSetConfirmPass('')
      setSetPassSuccess('Passphrase set successfully.')
      await refreshProtection()
    } catch {
      setSetPassError('Failed to set passphrase. Try again.')
    } finally {
      setSetPassBusy(false)
    }
  }

  const handleChangePassphrase = async () => {
    setChangeError('')
    setChangeSuccess('')
    if (!changeCurrent) { setChangeError('Current passphrase is required.'); return }
    if (!changeNew) { setChangeError('New passphrase must not be empty.'); return }
    if (changeNew !== changeConfirm) { setChangeError('New passphrases do not match.'); return }
    setChangeBusy(true)
    try {
      const sk = await loadLocalKey({ passphrase: changeCurrent })
      if (!sk) { setChangeError('Incorrect current passphrase.'); return }
      await setPassphrase(sk, changeNew)
      setChangeCurrent('')
      setChangeNew('')
      setChangeConfirm('')
      setChangeSuccess('Passphrase changed successfully.')
      await refreshProtection()
    } catch {
      setChangeError('Failed to change passphrase. Try again.')
    } finally {
      setChangeBusy(false)
    }
  }

  const handleRemovePassphrase = async () => {
    setRemoveError('')
    setRemoveSuccess('')
    if (!removeCurrent) { setRemoveError('Current passphrase is required.'); return }
    setRemoveBusy(true)
    try {
      const sk = await loadLocalKey({ passphrase: removeCurrent })
      if (!sk) { setRemoveError('Incorrect current passphrase.'); return }
      await setPassphrase(sk, null)
      setRemoveCurrent('')
      setRemoveSuccess('Passphrase removed. Key is now protected by device only.')
      await refreshProtection()
    } catch {
      setRemoveError('Failed to remove passphrase. Try again.')
    } finally {
      setRemoveBusy(false)
    }
  }

  if (!activeSettingsTab) return null

  return (
    <div className="flex-1 flex flex-col bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <h1 className="text-lg font-semibold text-white">{TAB_LABELS[activeSettingsTab]}</h1>
      </div>

      {/* Content — centered, max readable width */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-lg mx-auto px-6 py-6 space-y-4">

          {/* Profile */}
          {activeSettingsTab === 'profile' && (
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

          {/* Relays */}
          {activeSettingsTab === 'relays' && (
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
                  <div key={relay} className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3">
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

          {/* Keys */}
          {activeSettingsTab === 'keys' && (
            <div className="space-y-4">
              {authMethod === 'nip07' ? (
                <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Key size={16} className="text-purple-400" />
                    <span className="text-sm font-semibold text-white">Signed in with browser extension</span>
                  </div>
                  <p className="text-gray-400 text-sm">
                    Your key is managed by your Nostr browser extension. Passphrase controls and private key export are not available.
                  </p>
                </div>
              ) : (
                <>
                  <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-xl p-4">
                    <p className="text-yellow-300 text-sm">
                      <strong>Never share your private key (nsec).</strong> Anyone with it has full control of your account.
                    </p>
                  </div>

                  <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setShowQR(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <QrCode size={16} className="text-purple-400" />
                        Share Public Key via QR Code
                      </div>
                      {showQR ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                    </button>
                    {showQR && npub && (
                      <div className="px-4 pb-5 pt-1 border-t border-gray-700">
                        <p className="text-gray-400 text-xs mb-4 text-center">
                          Anyone can scan this to find and message you on Nostr.
                        </p>
                        <QRCodeDisplay
                          value={`nostr:${npub}`}
                          label={`nostr:${npub.slice(0, 16)}...${npub.slice(-8)}`}
                        />
                      </div>
                    )}
                  </div>

                  <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Link size={16} className="text-purple-400 flex-shrink-0" />
                      <span className="text-sm font-semibold text-white">Share Contact Link</span>
                    </div>
                    <p className="text-gray-400 text-xs">
                      Anyone who opens this link will be prompted to add you as a contact on NostrChat.
                    </p>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Web Link</p>
                      <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5">
                        <span className="flex-1 text-xs font-mono text-gray-300 truncate">{contactLink}</span>
                        <button onClick={() => copy(contactLink, 'contactLink')} className="text-gray-400 hover:text-purple-400 transition-colors flex-shrink-0" title="Copy link">
                          {copied === 'contactLink' ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Nostr URI</p>
                      <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5">
                        <span className="flex-1 text-xs font-mono text-gray-300 truncate">nostr:{npub}</span>
                        <button onClick={() => copy(`nostr:${npub}`, 'nostrUri')} className="text-gray-400 hover:text-purple-400 transition-colors flex-shrink-0" title="Copy Nostr URI">
                          {copied === 'nostrUri' ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
                        </button>
                      </div>
                    </div>
                    {typeof navigator !== 'undefined' && !!navigator.share && (
                      <button
                        onClick={async () => {
                          try {
                            await navigator.share({ title: 'Add me on NostrChat', text: `Add me on NostrChat (nostr:${npub})`, url: contactLink })
                          } catch { /* user cancelled */ }
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 text-sm font-semibold rounded-xl transition-colors"
                      >
                        <Share2 size={15} />
                        Share via…
                      </button>
                    )}
                  </div>

                  <KeyRow label="Public Key (npub)" value={npub || ''} icon={<User size={16} className="text-purple-400" />} onCopy={() => copy(npub || '', 'npub')} copied={copied === 'npub'} />
                  <KeyRow label="Public Key (hex)" value={publicKey || ''} icon={<User size={16} className="text-purple-400" />} onCopy={() => copy(publicKey || '', 'pkHex')} copied={copied === 'pkHex'} />
                  <KeyRow label="Private Key (nsec) — Keep Secret!" value={nsec || ''} icon={<Key size={16} className="text-red-400" />} onCopy={() => copy(nsec || '', 'nsec')} copied={copied === 'nsec'} secret />

                  {/* Key protection section */}
                  <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <Key size={16} className="text-purple-400 flex-shrink-0" />
                      <span className="text-sm font-semibold text-white">Key protection</span>
                      {protection !== null && (
                        <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300 font-mono">
                          {protection === 'passphrase' ? 'Passphrase' : 'Device'}
                        </span>
                      )}
                    </div>

                    {protection === 'device' || protection === 'none' ? (
                      /* Set passphrase */
                      <div className="space-y-3">
                        <p className="text-gray-400 text-xs">
                          Your key is currently protected by this device only. Set a passphrase so you are prompted for it on each login.
                        </p>
                        <PassField
                          label="New passphrase"
                          value={setNewPass}
                          onChange={setSetNewPass}
                          show={showSetNew}
                          onToggleShow={() => setShowSetNew(v => !v)}
                        />
                        <PassField
                          label="Confirm passphrase"
                          value={setConfirmPass}
                          onChange={setSetConfirmPass}
                          show={showSetConfirm}
                          onToggleShow={() => setShowSetConfirm(v => !v)}
                        />
                        {setPassError && <p className="text-red-400 text-xs">{setPassError}</p>}
                        {setPassSuccess && <p className="text-green-400 text-xs">{setPassSuccess}</p>}
                        <button
                          onClick={handleSetPassphrase}
                          disabled={setPassBusy}
                          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
                        >
                          {setPassBusy ? <Loader2 size={15} className="animate-spin" /> : null}
                          Set passphrase
                        </button>
                      </div>
                    ) : protection === 'passphrase' ? (
                      /* Change + Remove passphrase */
                      <div className="space-y-5">
                        <div className="space-y-3">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Change passphrase</p>
                          <PassField
                            label="Current passphrase"
                            value={changeCurrent}
                            onChange={setChangeCurrent}
                            show={showChangeCurrent}
                            onToggleShow={() => setShowChangeCurrent(v => !v)}
                          />
                          <PassField
                            label="New passphrase"
                            value={changeNew}
                            onChange={setChangeNew}
                            show={showChangeNew}
                            onToggleShow={() => setShowChangeNew(v => !v)}
                          />
                          <PassField
                            label="Confirm new passphrase"
                            value={changeConfirm}
                            onChange={setChangeConfirm}
                            show={showChangeConfirm}
                            onToggleShow={() => setShowChangeConfirm(v => !v)}
                          />
                          {changeError && <p className="text-red-400 text-xs">{changeError}</p>}
                          {changeSuccess && <p className="text-green-400 text-xs">{changeSuccess}</p>}
                          <button
                            onClick={handleChangePassphrase}
                            disabled={changeBusy}
                            className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
                          >
                            {changeBusy ? <Loader2 size={15} className="animate-spin" /> : null}
                            Change passphrase
                          </button>
                        </div>

                        <div className="border-t border-gray-700 pt-4 space-y-3">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Remove passphrase</p>
                          <p className="text-gray-400 text-xs">
                            Revert to device-only protection. You will no longer be prompted for a passphrase on login.
                          </p>
                          <PassField
                            label="Current passphrase"
                            value={removeCurrent}
                            onChange={setRemoveCurrent}
                            show={showRemoveCurrent}
                            onToggleShow={() => setShowRemoveCurrent(v => !v)}
                          />
                          {removeError && <p className="text-red-400 text-xs">{removeError}</p>}
                          {removeSuccess && <p className="text-green-400 text-xs">{removeSuccess}</p>}
                          <button
                            onClick={handleRemovePassphrase}
                            disabled={removeBusy}
                            className="w-full bg-red-700/60 hover:bg-red-700/80 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
                          >
                            {removeBusy ? <Loader2 size={15} className="animate-spin" /> : null}
                            Remove passphrase
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Loading state */
                      <p className="text-gray-500 text-xs">Loading...</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Calls */}
          {activeSettingsTab === 'calls' && <CallsTab />}

          {/* Files */}
          {activeSettingsTab === 'files' && <FilesTab />}

          {/* Notifications */}
          {activeSettingsTab === 'notifications' && <NotificationsTab />}

          {/* Privacy */}
          {activeSettingsTab === 'privacy' && <PrivacyTab />}

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

function KeyRow({ label, value, icon, onCopy, copied, secret = false }: {
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
          <button onClick={() => setShow(!show)} className="text-gray-400 hover:text-white transition-colors text-xs">
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

function PassField({ label, value, onChange, show, onToggleShow }: {
  label: string
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggleShow: () => void
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</label>
      <div className="mt-1 flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete="new-password"
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
          tabIndex={-1}
          aria-label={show ? 'Hide passphrase' : 'Show passphrase'}
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  )
}
