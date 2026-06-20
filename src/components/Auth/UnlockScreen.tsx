import { useState } from 'react'
import { Lock } from 'lucide-react'
import { LocalSigner, setSigner } from '../../lib/signer'
import { loadLocalKey } from '../../lib/keyStore'
import { encodeNsec } from '../../lib/nostr'
import { useNostrStore } from '../../store/nostrStore'

export function UnlockScreen({ onUnlocked, onLogout }: { onUnlocked: () => void; onLogout: () => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!passphrase || busy) return
    setBusy(true); setError('')
    const sk = await loadLocalKey({ passphrase })
    setBusy(false)
    if (!sk) { setError('Incorrect passphrase'); return }
    setSigner(new LocalSigner(sk))
    useNostrStore.setState({ nsec: encodeNsec(sk) })
    onUnlocked()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-purple-950 to-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm glass rounded-2xl p-8 space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-3">
            <Lock size={24} className="text-white" />
          </div>
          <h2 className="text-xl font-bold text-white">Unlock</h2>
          <p className="text-gray-400 text-sm mt-1">Enter your passphrase to decrypt your key.</p>
        </div>
        <input
          type="password"
          autoFocus
          value={passphrase}
          onChange={e => { setPassphrase(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Passphrase"
          className="w-full bg-gray-900 border border-gray-700 focus:border-purple-500 rounded-xl px-4 py-3 text-white outline-none"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button onClick={submit} disabled={busy} className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors">
          {busy ? 'Unlocking...' : 'Unlock'}
        </button>
        <button onClick={onLogout} className="w-full text-gray-400 hover:text-white text-sm transition-colors">
          Use a different account
        </button>
      </div>
    </div>
  )
}
