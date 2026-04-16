import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X } from 'lucide-react'

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-800 border border-purple-500/40 rounded-2xl px-4 py-3 shadow-2xl max-w-sm w-[calc(100%-2rem)]">
      <RefreshCw size={18} className="text-purple-400 flex-shrink-0" />
      <p className="flex-1 text-sm text-white">New version available</p>
      <button
        onClick={() => updateServiceWorker(true)}
        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-colors flex-shrink-0"
      >
        Update
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  )
}
