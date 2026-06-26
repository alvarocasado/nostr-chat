import { useState, useEffect } from 'react'
import { Loader2, Check, Save } from 'lucide-react'
import { getSetting, setSetting } from '../../lib/userDb'
import { DEFAULT_MEDIA_SERVER, MEDIA_SERVER_KEY } from '../../lib/blossom'
import { useNostrStore } from '../../store/nostrStore'

export function FilesTab() {
  const triggerSettingsSync = useNostrStore(s => s.triggerSettingsSync)
  const [server, setServer] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void getSetting<string>(MEDIA_SERVER_KEY, DEFAULT_MEDIA_SERVER).then(setServer)
  }, [])

  const handleSave = async () => {
    setError('')
    const value = server.trim()
    if (!/^https:\/\/.+/.test(value)) { setError('Enter a valid https:// URL.'); return }
    setSaving(true)
    try {
      await setSetting(MEDIA_SERVER_KEY, value)
      setSaved(true)
      triggerSettingsSync()
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pb-1">Media Server</p>
        <p className="text-xs text-gray-500 pb-1">
          Files larger than 150 KB are uploaded here instead of being sent over relays. Direct-message and
          group files are encrypted before upload. Recipients download from the link in the message, so they
          do not need the same server.
        </p>
        <label className="text-xs text-gray-400 mb-1 block">Blossom server URL</label>
        <input
          type="text"
          value={server}
          onChange={e => setServer(e.target.value)}
          placeholder={DEFAULT_MEDIA_SERVER}
          className="w-full bg-gray-900 border border-gray-700 focus:border-purple-500 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition-colors"
        />
        {error && <p className="text-red-400 text-xs pt-1">{error}</p>}
        <div className="pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : <Save size={15} />}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
