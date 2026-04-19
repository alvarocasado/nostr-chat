import { useState, useRef, useEffect } from 'react'

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopped'

export const MAX_RECORDING_SECONDS = 60

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

function getSupportedMimeType(): string {
  return (
    PREFERRED_MIME_TYPES.find(t => {
      try { return MediaRecorder.isTypeSupported(t) } catch { return false }
    }) ?? ''
  )
}

export interface UseAudioRecorderResult {
  state: RecorderState
  elapsed: number
  audioBlob: Blob | null
  mimeType: string
  error: string | null
  start: () => Promise<void>
  stop: () => void
  reset: () => void
}

export function useAudioRecorder(): UseAudioRecorderResult {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [mimeType, setMimeType] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const clearTimer = () => {
    if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null }
  }

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  // Cleanup on unmount
  useEffect(() => () => { clearTimer(); stopStream() }, [])

  const start = async () => {
    setError(null)
    setState('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = getSupportedMimeType()
      setMimeType(mime)

      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recorderRef.current = mr
      chunksRef.current = []

      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        stopStream()
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || mime })
        setAudioBlob(blob)
        setState('stopped')
      }

      // No timeslice: iOS Safari fires ondataavailable reliably only on stop()
      mr.start()
      setState('recording')
      setElapsed(0)

      timerRef.current = setInterval(() => {
        setElapsed(prev => {
          const next = prev + 1
          if (next >= MAX_RECORDING_SECONDS) {
            mr.stop()
            clearTimer()
          }
          return next
        })
      }, 1000)
    } catch (err) {
      stopStream()
      setState('idle')
      setError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone access denied. Allow microphone permissions and try again.'
          : 'Could not access microphone.'
      )
    }
  }

  const stop = () => {
    clearTimer()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  const reset = () => {
    clearTimer()
    stopStream()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    recorderRef.current = null
    chunksRef.current = []
    setAudioBlob(null)
    setState('idle')
    setElapsed(0)
    setError(null)
  }

  return { state, elapsed, audioBlob, mimeType, error, start, stop, reset }
}
