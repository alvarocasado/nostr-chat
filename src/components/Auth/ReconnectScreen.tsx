import { Shield } from 'lucide-react'

interface ReconnectScreenProps {
  onRetry: () => void
  onLogout: () => void
}

export function ReconnectScreen({ onRetry, onLogout }: ReconnectScreenProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-purple-950 to-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="glass rounded-2xl p-8 space-y-6 text-center">
          <div className="w-16 h-16 bg-gray-800 border border-gray-700 rounded-full flex items-center justify-center mx-auto">
            <Shield size={28} className="text-purple-400" />
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white">Reconnect your signer extension</h2>
            <p className="text-gray-400 text-sm mt-2">
              Your NIP-07 browser extension is not available. Make sure it is installed and unlocked, then try again.
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={onRetry}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Retry
            </button>

            <button
              onClick={onLogout}
              className="w-full bg-transparent hover:bg-gray-800 text-gray-400 hover:text-white font-semibold py-3 rounded-xl transition-colors border border-gray-700"
            >
              Use a different account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
