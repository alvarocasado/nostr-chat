import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Loader2, Check, Save, Mic, Video, ChevronDown, AlertCircle, Wifi } from 'lucide-react'
import { getIceServers } from '../../lib/webrtc'
import { getSetting, setSetting, deleteSetting } from '../../lib/userDb'

type TurnMode = 'none' | 'metered' | 'custom'
type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

const SK = {
  TURN_MODE:    'turn_mode',
  TURN_CONFIG:  'turn_config',
  TURN_METERED: 'turn_metered_config',
  TURN_CUSTOM:  'turn_custom_config',
  AUDIO_DEVICE: 'media_audio_device',
  VIDEO_DEVICE: 'media_video_device',
}

async function testRelayConnection(): Promise<'relay' | 'fail'> {
  const iceServers = await getIceServers()
  return new Promise((resolve) => {
    let resolved = false
    const done = (r: 'relay' | 'fail') => { if (!resolved) { resolved = true; resolve(r) } }

    let pc: RTCPeerConnection
    try {
      pc = new RTCPeerConnection({ iceServers })
    } catch {
      resolve('fail')
      return
    }

    const timeout = setTimeout(() => { try { pc.close() } catch {} done('fail') }, 10_000)

    pc.onicecandidate = ({ candidate }) => {
      if (candidate?.type === 'relay') {
        clearTimeout(timeout)
        try { pc.close() } catch {}
        done('relay')
      } else if (candidate === null) {
        clearTimeout(timeout)
        try { pc.close() } catch {}
        done('fail')
      }
    }

    pc.createDataChannel('test')
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .catch(() => { clearTimeout(timeout); try { pc.close() } catch {} done('fail') })
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 space-y-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pb-1">{title}</p>
      {children}
    </div>
  )
}

function RadioRow({
  checked, onSelect, label, children,
}: { checked: boolean; onSelect: () => void; label: string; children?: ReactNode }) {
  return (
    <div>
      <button
        onClick={onSelect}
        className="flex items-center gap-3 py-2 w-full text-left"
      >
        <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${checked ? 'border-purple-500' : 'border-gray-600'}`}>
          {checked && <span className="w-2 h-2 rounded-full bg-purple-500 block" />}
        </span>
        <span className={`text-sm transition-colors ${checked ? 'text-white font-medium' : 'text-gray-400'}`}>{label}</span>
      </button>
      {checked && children && (
        <div className="ml-7 space-y-2 pb-1">{children}</div>
      )}
    </div>
  )
}

function InputRow({
  label, value, onChange, placeholder, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="text-xs text-gray-400 mb-1 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-gray-900 border border-gray-700 focus:border-purple-500 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition-colors"
      />
    </div>
  )
}

function DeviceSelect({
  icon, label, devices, value, onChange,
}: { icon: ReactNode; label: string; devices: MediaDeviceInfo[]; value: string; onChange: (id: string) => void }) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
        {icon} {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 focus:border-purple-500 rounded-xl px-3 py-2.5 text-sm text-white outline-none transition-colors appearance-none pr-8"
        >
          <option value="">Default</option>
          {devices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Device ${d.deviceId.slice(0, 8)}`}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function CallsTab() {
  const [mode, setMode]                     = useState<TurnMode>('none')
  const [meteredSubdomain, setMeteredSubdomain] = useState('')
  const [meteredApiKey, setMeteredApiKey]       = useState('')
  const [customUrl, setCustomUrl]               = useState('')
  const [customUsername, setCustomUsername]     = useState('')
  const [customCredential, setCustomCredential] = useState('')
  const [hasTurnConfig, setHasTurnConfig]       = useState(false)

  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [saveError, setSaveError] = useState('')
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [audioDevice, setAudioDevice]   = useState('')
  const [videoDevice, setVideoDevice]   = useState('')
  const [devicesLabelled, setDevicesLabelled] = useState(false)
  const [permRequesting, setPermRequesting]   = useState(false)

  // Load all settings from Dexie on mount
  useEffect(() => {
    async function load() {
      const [m, metered, custom, audio, video, config] = await Promise.all([
        getSetting<string>(SK.TURN_MODE, 'none'),
        getSetting<{ subdomain: string; apiKey: string }>(SK.TURN_METERED, { subdomain: '', apiKey: '' }),
        getSetting<{ url: string; username: string; credential: string }>(SK.TURN_CUSTOM, { url: '', username: '', credential: '' }),
        getSetting<string>(SK.AUDIO_DEVICE, ''),
        getSetting<string>(SK.VIDEO_DEVICE, ''),
        getSetting<string>(SK.TURN_CONFIG, ''),
      ])
      setMode((m === 'metered' || m === 'custom') ? m : 'none')
      setMeteredSubdomain(metered.subdomain)
      setMeteredApiKey(metered.apiKey)
      setCustomUrl(custom.url)
      setCustomUsername(custom.username)
      setCustomCredential(custom.credential)
      setAudioDevice(audio)
      setVideoDevice(video)
      setHasTurnConfig(!!config)
    }
    void load()
  }, [])

  const enumerateDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const audio = all.filter(d => d.kind === 'audioinput')
      const video = all.filter(d => d.kind === 'videoinput')
      setAudioDevices(audio)
      setVideoDevices(video)
      setDevicesLabelled(audio.some(d => !!d.label) || video.some(d => !!d.label))
    } catch {}
  }, [])

  useEffect(() => { void enumerateDevices() }, [enumerateDevices])

  const requestPermission = async () => {
    setPermRequesting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      stream.getTracks().forEach(t => t.stop())
    } catch { /* user denied or no devices */ }
    await enumerateDevices()
    setPermRequesting(false)
  }

  const handleDeviceChange = async (type: 'audio' | 'video', deviceId: string) => {
    if (type === 'audio') {
      setAudioDevice(deviceId)
      await setSetting(SK.AUDIO_DEVICE, deviceId)
    } else {
      setVideoDevice(deviceId)
      await setSetting(SK.VIDEO_DEVICE, deviceId)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    setSaved(false)

    try {
      if (mode === 'none') {
        await deleteSetting(SK.TURN_CONFIG)
        await setSetting(SK.TURN_MODE, 'none')
        setHasTurnConfig(false)
      } else if (mode === 'metered') {
        const sub = meteredSubdomain.trim().replace(/\.metered\.live$/i, '')
        const key = meteredApiKey.trim()
        if (!sub || !key) { setSaveError('Subdomain and API key are required.'); return }

        const url = `https://${sub}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`API returned ${res.status} — check your subdomain and key.`)
        const servers = await res.json() as RTCIceServer[]
        if (!Array.isArray(servers)) throw new Error('Unexpected response from Metered API.')

        await setSetting(SK.TURN_CONFIG, JSON.stringify(servers))
        await setSetting(SK.TURN_MODE, 'metered')
        await setSetting(SK.TURN_METERED, { subdomain: sub, apiKey: key })
        setHasTurnConfig(true)
      } else if (mode === 'custom') {
        const turnUrl = customUrl.trim()
        if (!turnUrl) { setSaveError('TURN URL is required.'); return }
        if (!/^turns?:/.test(turnUrl)) { setSaveError('URL must start with turn: or turns:'); return }

        const server: RTCIceServer = {
          urls: turnUrl,
          username: customUsername.trim() || undefined,
          credential: customCredential.trim() || undefined,
        }
        await setSetting(SK.TURN_CONFIG, JSON.stringify([server]))
        await setSetting(SK.TURN_MODE, 'custom')
        await setSetting(SK.TURN_CUSTOM, {
          url: turnUrl,
          username: customUsername.trim(),
          credential: customCredential.trim(),
        })
        setHasTurnConfig(true)
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTestStatus('testing')
    const result = await testRelayConnection()
    setTestStatus(result === 'relay' ? 'ok' : 'fail')
    setTimeout(() => setTestStatus('idle'), 6000)
  }

  return (
    <div className="space-y-4">
      {/* TURN Server */}
      <Section title="TURN Server">
        <p className="text-xs text-gray-500 pb-1">
          Only needed if calls fail on restricted networks. Most users won't need this.
        </p>

        <div className="border-t border-gray-700/50 pt-1 space-y-0.5">
          <RadioRow checked={mode === 'none'} onSelect={() => setMode('none')} label="None — use public STUN only (default)" />

          <RadioRow checked={mode === 'metered'} onSelect={() => setMode('metered')} label="Metered.ca">
            <InputRow
              label="Subdomain"
              value={meteredSubdomain}
              onChange={setMeteredSubdomain}
              placeholder="openrelay"
            />
            <p className="text-xs text-gray-600 -mt-1">Your project subdomain from app.metered.ca/dashboard</p>
            <InputRow
              label="API Key"
              value={meteredApiKey}
              onChange={setMeteredApiKey}
              placeholder="••••••••••••••••••••••••••"
              type="password"
            />
          </RadioRow>

          <RadioRow checked={mode === 'custom'} onSelect={() => setMode('custom')} label="Custom TURN server">
            <InputRow
              label="TURN URL"
              value={customUrl}
              onChange={setCustomUrl}
              placeholder="turn:hostname:3478"
            />
            <InputRow
              label="Username"
              value={customUsername}
              onChange={setCustomUsername}
              placeholder="optional"
            />
            <InputRow
              label="Password"
              value={customCredential}
              onChange={setCustomCredential}
              placeholder="optional"
              type="password"
            />
          </RadioRow>
        </div>

        {saveError && (
          <p className="text-red-400 text-xs pt-1">{saveError}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {saving
              ? <Loader2 size={15} className="animate-spin" />
              : saved
                ? <Check size={15} />
                : <Save size={15} />}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
          </button>

          <button
            onClick={handleTest}
            disabled={testStatus === 'testing' || !hasTurnConfig}
            title={!hasTurnConfig ? 'Save a TURN configuration first' : undefined}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {testStatus === 'testing'
              ? <><Loader2 size={15} className="animate-spin" />Testing…</>
              : testStatus === 'ok'
                ? <><Check size={15} className="text-green-400" />Relay reachable</>
                : testStatus === 'fail'
                  ? <><AlertCircle size={15} className="text-red-400" />Could not reach relay</>
                  : <><Wifi size={15} />Test Connection</>}
          </button>
        </div>

        {testStatus === 'idle' && hasTurnConfig && (
          <p className="text-xs text-gray-600">Save any changes before testing.</p>
        )}
      </Section>

      {/* Media Devices */}
      <Section title="Media Devices">
        {!devicesLabelled && (
          <button
            onClick={requestPermission}
            disabled={permRequesting}
            className="w-full flex items-center justify-center gap-2 py-2 bg-gray-900 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-xs font-semibold rounded-xl transition-colors mb-2"
          >
            {permRequesting
              ? <><Loader2 size={13} className="animate-spin" />Requesting…</>
              : 'Grant permission to see device names'}
          </button>
        )}

        <DeviceSelect
          icon={<Mic size={13} />}
          label="Microphone"
          devices={audioDevices}
          value={audioDevice}
          onChange={id => { void handleDeviceChange('audio', id) }}
        />

        <div className="border-t border-gray-700/50 pt-2">
          <DeviceSelect
            icon={<Video size={13} />}
            label="Camera"
            devices={videoDevices}
            value={videoDevice}
            onChange={id => { void handleDeviceChange('video', id) }}
          />
        </div>
      </Section>
    </div>
  )
}
