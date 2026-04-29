import { useState } from 'react'
import { Zap, Key, Eye, EyeOff, Copy, Check, Shield } from 'lucide-react'
import { useNostrStore } from '../../store/nostrStore'

export function LoginScreen() {
  const { generateAndLogin, loginFromNsec, loginFromHex } = useNostrStore()
  const [mode, setMode] = useState<'welcome' | 'import' | 'newKey'>('welcome')
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState('')
  const [newKeys, setNewKeys] = useState<{ nsec: string; npub: string } | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    const keys = await generateAndLogin()
    setNewKeys(keys)
    setMode('newKey')
  }

  const handleImport = async () => {
    setError('')
    const val = inputValue.trim()
    if (!val) {
      setError('Please enter your private key')
      return
    }
    let ok = false
    if (val.startsWith('nsec1')) {
      ok = await loginFromNsec(val)
    } else if (/^[0-9a-fA-F]{64}$/.test(val)) {
      ok = await loginFromHex(val)
    } else {
      setError('Invalid key format. Use nsec1... or 64-char hex')
      return
    }
    if (!ok) setError('Invalid private key')
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (mode === 'newKey' && newKeys) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-purple-950 to-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="glass rounded-2xl p-8 space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Key size={28} className="text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white">Your New Keys</h2>
              <p className="text-gray-400 text-sm mt-1">Save your private key securely — you can't recover it!</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-purple-400 uppercase tracking-wider">
                  Private Key (nsec) — Keep Secret!
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1 bg-gray-900 border border-red-500/30 rounded-xl px-4 py-3 font-mono text-sm text-red-300 break-all">
                    {showKey ? newKeys.nsec : '•'.repeat(60)}
                  </div>
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                  >
                    {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                  <button
                    onClick={() => copyToClipboard(newKeys.nsec)}
                    className="p-2 text-gray-400 hover:text-purple-400 transition-colors"
                  >
                    {copied ? <Check size={18} className="text-green-400" /> : <Copy size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-purple-400 uppercase tracking-wider">
                  Public Key (npub) — Share with others
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1 bg-gray-900 border border-purple-500/30 rounded-xl px-4 py-3 font-mono text-xs text-purple-300 break-all">
                    {newKeys.npub}
                  </div>
                  <button
                    onClick={() => copyToClipboard(newKeys.npub)}
                    className="p-2 text-gray-400 hover:text-purple-400 transition-colors"
                  >
                    <Copy size={18} />
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-xl p-4 flex gap-3">
              <Shield size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-yellow-300 text-sm">
                Write down or store your <strong>nsec</strong> in a password manager. It's the only way to recover access to your account.
              </p>
            </div>

            <button
              onClick={() => {/* already logged in via generateAndLogin */}}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              I've saved my key — Enter Chat
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'import') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-purple-950 to-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="glass rounded-2xl p-8 space-y-6">
            <button
              onClick={() => { setMode('welcome'); setError(''); setInputValue('') }}
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              ← Back
            </button>

            <div className="text-center">
              <div className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Key size={28} className="text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white">Import Key</h2>
              <p className="text-gray-400 text-sm mt-1">Enter your nsec or hex private key</p>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={inputValue}
                  onChange={e => { setInputValue(e.target.value); setError('') }}
                  placeholder="nsec1... or 64-char hex"
                  className="w-full bg-gray-900 border border-gray-700 focus:border-purple-500 rounded-xl px-4 py-3 text-white placeholder-gray-500 font-mono text-sm outline-none transition-colors pr-12"
                  onKeyDown={e => e.key === 'Enter' && handleImport()}
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}

              <button
                onClick={handleImport}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Import & Login
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-purple-950 to-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-purple-600 to-violet-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-2xl shadow-purple-900">
            <Zap size={36} className="text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">NostrChat</h1>
          <p className="text-gray-400 mt-2">Decentralized. Censorship-resistant. Yours.</p>
        </div>

        <div className="glass rounded-2xl p-8 space-y-4">
          <h2 className="text-lg font-semibold text-center text-gray-200 mb-6">
            Get started
          </h2>

          <button
            onClick={handleGenerate}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-4 rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-3"
          >
            <Zap size={20} />
            Create New Account
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 text-gray-500 text-sm bg-transparent">or</span>
            </div>
          </div>

          <button
            onClick={() => setMode('import')}
            className="w-full bg-gray-800 hover:bg-gray-700 text-white font-semibold py-4 rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-3 border border-gray-700"
          >
            <Key size={20} />
            Login with Private Key
          </button>

          <p className="text-gray-500 text-xs text-center mt-4">
            Built on the{' '}
            <a
              href="https://nostr.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:underline"
            >
              Nostr protocol
            </a>
            . Your keys, your identity.
          </p>
        </div>
      </div>
    </div>
  )
}
