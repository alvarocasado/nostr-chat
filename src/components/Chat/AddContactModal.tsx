import { useState, useEffect } from 'react'
import { X, Search, UserPlus, Loader2, QrCode, CameraOff, ScanLine } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useNostrStore } from '../../store/nostrStore'
import { fetchEvent, parseProfile } from '../../lib/nostr'
import { Avatar } from './Avatar'
import { useQRScanner } from '../../hooks/useQRScanner'

interface AddContactModalProps {
  onClose: () => void
  initialNpub?: string
}

// Extract a nostr pubkey from various QR payload formats:
//   npub1...  /  nostr:npub1...  /  hex (64 chars)
function extractPubkey(raw: string): string | null {
  const s = raw.trim()
  // nostr:npub1... or npub1...
  const npubMatch = s.match(/npub1[a-z0-9]+/)
  if (npubMatch) {
    try {
      const decoded = nip19.decode(npubMatch[0])
      if (decoded.type === 'npub') return decoded.data as string
    } catch { /* ignore */ }
  }
  // nostr:nprofile1...
  const nprofileMatch = s.match(/nprofile1[a-z0-9]+/)
  if (nprofileMatch) {
    try {
      const decoded = nip19.decode(nprofileMatch[0])
      if (decoded.type === 'nprofile') return (decoded.data as { pubkey: string }).pubkey
    } catch { /* ignore */ }
  }
  // raw hex pubkey
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s
  return null
}

function QRScannerView({ onDetected, onCancel }: { onDetected: (pk: string) => void; onCancel: () => void }) {
  const [scanError, setScanError] = useState('')

  const handleResult = (data: string) => {
    const pk = extractPubkey(data)
    if (pk) {
      onDetected(pk)
    } else {
      setScanError('No Nostr pubkey found in QR code. Try again.')
      start()
    }
  }

  const { videoRef, canvasRef, state, errorMsg, start, stop } = useQRScanner(handleResult)

  useEffect(() => {
    start()
    return () => stop()
  }, [])

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Camera viewport */}
      <div className="relative w-full aspect-square max-w-xs rounded-2xl overflow-hidden bg-black border border-gray-700">
        {state === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <CameraOff size={40} className="text-gray-500" />
            <p className="text-gray-400 text-sm">{errorMsg || 'Camera unavailable'}</p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
            />
            {/* Scanning overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-48 h-48">
                {/* Corner brackets */}
                <span className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-purple-400 rounded-tl-md" />
                <span className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-purple-400 rounded-tr-md" />
                <span className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-purple-400 rounded-bl-md" />
                <span className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-purple-400 rounded-br-md" />
                {/* Scan line */}
                {state === 'scanning' && (
                  <span className="absolute left-2 right-2 h-0.5 bg-purple-400/70 animate-scan-line" />
                )}
              </div>
            </div>
          </>
        )}
        {/* hidden canvas used for decoding */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {scanError && (
        <p className="text-yellow-400 text-sm text-center px-2">{scanError}</p>
      )}

      {state === 'scanning' && !scanError && (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <ScanLine size={16} className="text-purple-400" />
          Point camera at a Nostr QR code
        </div>
      )}

      <button
        onClick={() => { stop(); onCancel() }}
        className="text-gray-400 hover:text-white text-sm transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}

export function AddContactModal({ onClose, initialNpub }: AddContactModalProps) {
  const { relays, addContact, setProfile, setActiveChat, setSidebarTab } = useNostrStore()
  const [tab, setTab] = useState<'manual' | 'qr'>('manual')
  const [input, setInput] = useState(initialNpub ?? '')
  const [loading, setLoading] = useState(false)
  const [found, setFound] = useState<{ pubkey: string; name?: string; about?: string; picture?: string } | null>(null)
  const [error, setError] = useState('')

  // Auto-lookup when opened with a pre-filled npub (e.g. from a share link)
  useEffect(() => {
    if (initialNpub) {
      const pk = resolvePubkey(initialNpub)
      if (pk) lookupPubkey(pk)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const resolvePubkey = (val: string): string | null => {
    val = val.trim()
    if (/^[0-9a-fA-F]{64}$/.test(val)) return val
    try {
      const decoded = nip19.decode(val)
      if (decoded.type === 'npub') return decoded.data as string
    } catch { /* ignore */ }
    return null
  }

  const lookupPubkey = async (pk: string) => {
    setError('')
    setFound(null)
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

  const handleSearch = () => {
    const pk = resolvePubkey(input)
    if (!pk) { setError('Enter a valid npub or 64-char hex pubkey'); return }
    lookupPubkey(pk)
  }

  const handleQRDetected = (pk: string) => {
    setTab('manual')
    setInput(nip19.npubEncode(pk))
    lookupPubkey(pk)
  }

  const handleAdd = () => {
    if (!found) return
    addContact(found.pubkey)
    setSidebarTab('dms')
    setActiveChat(found.pubkey, 'dm')
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-2xl max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">New Message</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2 px-6 pt-4">
          <button
            onClick={() => setTab('manual')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === 'manual' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Search size={15} />
            Enter Key
          </button>
          <button
            onClick={() => setTab('qr')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === 'qr' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <QrCode size={15} />
            Scan QR
          </button>
        </div>

        <div className="p-6 pt-4 space-y-4 overflow-y-auto scrollbar-thin">
          {tab === 'qr' ? (
            <QRScannerView
              onDetected={handleQRDetected}
              onCancel={() => setTab('manual')}
            />
          ) : (
            <>
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
            </>
          )}

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
