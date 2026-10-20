// Tap-to-talk: record with MediaRecorder, show a live level, stop at the cap,
// then send the audio to /api/agent/transcribe (OpenRouter speech-to-text).
// The transcript is handed back for the person to check before sending:
// a misheard "3%" must not silently become 30%.

import { useCallback, useEffect, useRef, useState } from 'react'
import { agentApi } from '../api/endpoints'
import { apiErrorMessage } from '../api/client'

export const MAX_SECONDS = 120

export type RecorderState = 'idle' | 'recording' | 'transcribing'

function formatOf(mime: string): string {
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'mp4'
  return 'webm'
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export const recordingSupported = () => typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export function useRecorder(onText: (text: string) => void) {
  const [state, setState] = useState<RecorderState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const cleanup = useRef<() => void>(() => {})
  const cancelled = useRef(false)

  const release = useCallback(() => {
    cleanup.current()
    cleanup.current = () => {}
    setLevel(0)
  }, [])

  useEffect(() => () => {
    cancelled.current = true
    rec.current?.state === 'recording' && rec.current.stop()
    release()
  }, [release])

  const stop = useCallback(() => {
    if (rec.current?.state === 'recording') rec.current.stop()
  }, [])

  const start = useCallback(async () => {
    setError(null)
    if (!recordingSupported()) {
      setError('This browser can’t record audio.')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone access was blocked. Allow it in the browser to talk to the agent.')
      return
    }
    cancelled.current = false
    chunks.current = []
    const recorder = new MediaRecorder(stream)
    rec.current = recorder

    // Live level for the meter.
    let raf = 0
    let ctx: AudioContext | null = null
    try {
      ctx = new AudioContext()
      // Browsers may start it suspended (autoplay rules); the mic tap counts as the gesture.
      ctx.resume().catch(() => {})
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
        setLevel(Math.min(1, peak / 64))
        raf = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      // No meter; recording still works.
    }
    const began = Date.now()
    const timer = window.setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000)
      setSeconds(s)
      if (s >= MAX_SECONDS) recorder.state === 'recording' && recorder.stop()
    }, 250)
    cleanup.current = () => {
      window.clearInterval(timer)
      cancelAnimationFrame(raf)
      ctx?.close().catch(() => {})
      stream.getTracks().forEach((t) => t.stop())
    }

    recorder.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    recorder.onstop = async () => {
      release()
      if (cancelled.current) {
        setState('idle')
        return
      }
      const blob = new Blob(chunks.current, { type: recorder.mimeType || 'audio/webm' })
      if (blob.size < 1000) {
        setState('idle')
        setError('That was too short to hear anything.')
        return
      }
      setState('transcribing')
      try {
        const { text } = await agentApi.transcribe(await toBase64(blob), formatOf(blob.type))
        if (text) onText(text)
        else setError('Nothing was heard. Try again a little closer to the mic.')
      } catch (e) {
        setError(apiErrorMessage(e, 'Couldn’t transcribe that. Try again.'))
      } finally {
        setState('idle')
      }
    }
    setSeconds(0)
    recorder.start(250)
    setState('recording')
  }, [onText, release])

  const cancel = useCallback(() => {
    cancelled.current = true
    stop()
  }, [stop])

  return { state, seconds, level, error, start, stop, cancel, clearError: () => setError(null) }
}
