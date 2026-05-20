'use client'

import { useState, useRef, useEffect } from 'react'

export default function MicRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [uploadedKey, setUploadedKey] = useState<string | null>(null)
  const [volume, setVolume] = useState<number>(0)

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const animationRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  // Cloned stream used exclusively by the visualizer — never touches the recorder stream
  const vizStreamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    async function initHardware() {
      try {
        if (typeof window !== 'undefined' && navigator.mediaDevices) {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true })
          const allDevices = await navigator.mediaDevices.enumerateDevices()
          const audioInputs = allDevices.filter(d => d.kind === 'audioinput')
          setDevices(audioInputs)
          if (audioInputs.length > 0) setSelectedDeviceId(audioInputs[0].deviceId)
          tempStream.getTracks().forEach(t => t.stop())
        }
      } catch (e) {
        console.error('Mic enumeration error:', e)
      }
    }
    initHardware()
  }, [])

  const startVisualizer = (originalStream: MediaStream) => {
    // CRITICAL: Clone the stream so the AudioContext never touches the recorder's stream
    // This prevents the Chrome bug where createMediaStreamSource causes MediaRecorder silence
    const vizStream = originalStream.clone()
    vizStreamRef.current = vizStream

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const audioCtx = new AudioContextClass()
    audioCtxRef.current = audioCtx

    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    const source = audioCtx.createMediaStreamSource(vizStream)
    source.connect(analyser)

    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length
      setVolume(Math.min(100, Math.round((avg / 128) * 100)))
      animationRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  const stopVisualizer = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    if (audioCtxRef.current) audioCtxRef.current.close()
    if (vizStreamRef.current) vizStreamRef.current.getTracks().forEach(t => t.stop())
    setVolume(0)
  }

  const startRecording = async () => {
    try {
      setUploadedKey(null)
      setAudioUrl(null)
      chunksRef.current = []

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
      })
      streamRef.current = stream

      // Visualizer uses a CLONE — the original stream goes only to MediaRecorder
      startVisualizer(stream)

      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
      }

      recorder.onstop = async () => {
        stopVisualizer()

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        console.log('Recorded blob size:', blob.size, 'type:', blob.type)

        const localUrl = URL.createObjectURL(blob)
        setAudioUrl(localUrl)

        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
        await uploadAudioPayload(blob)
      }

      recorder.start()
      console.log('MediaRecorder started, mimeType:', recorder.mimeType)
      setIsRecording(true)
    } catch (err) {
      console.error('Failed to start recording:', err)
      alert('Microphone access failed.')
    }
  }

  const stopRecording = () => {
    if (recorderRef.current && isRecording) {
      recorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const uploadAudioPayload = async (blob: Blob) => {
    setIsUploading(true)
    try {
      const ext = blob.type.includes('ogg') ? 'ogg' : 'webm'
      const form = new FormData()
      form.append('file', blob, `audio_command.${ext}`)
      const resp = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await resp.json()
      if (data.success || resp.ok) setUploadedKey(data.fileKey || 'Upload Success')
    } catch (e) {
      console.error('Upload error:', e)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 p-8 bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 max-w-sm mx-auto">

      <div className="w-full flex flex-col gap-1.5">
        <label htmlFor="mic-select" className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          Select Microphone Source:
        </label>
        <select
          id="mic-select"
          name="microphoneSource"
          value={selectedDeviceId}
          onChange={e => setSelectedDeviceId(e.target.value)}
          disabled={isRecording}
          className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-medium focus:outline-none"
        >
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone Input ${i + 1}`}
            </option>
          ))}
        </select>
      </div>

      {/* Live volume meter */}
      <div className="w-full flex flex-col gap-1">
        <div className="w-full h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden border border-zinc-200 dark:border-zinc-700">
          <div
            className="h-full bg-green-500 transition-all duration-75 rounded-full"
            style={{ width: `${volume}%` }}
          />
        </div>
        <p className="text-xs text-zinc-400 text-center">
          {isRecording ? `Live Volume: ${volume}%` : 'Press Record to start'}
        </p>
      </div>

      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isUploading}
        className={`w-24 h-24 rounded-full flex items-center justify-center text-white text-xl font-bold transition-transform transform hover:scale-105 active:scale-95 shadow-md ${
          isRecording ? 'bg-red-500 animate-pulse' : 'bg-blue-600 hover:bg-blue-700'
        } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isRecording ? 'Stop' : isUploading ? '...' : 'Record'}
      </button>

      {uploadedKey && (
        <div className="w-full text-center bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50 p-2 rounded-lg text-xs font-semibold text-green-600">
          ✓ Uploaded Successfully
        </div>
      )}

      {audioUrl && !isUploading && (
        <div className="w-full flex flex-col gap-1">
          <p className="text-xs text-zinc-400 text-center">Local playback (before upload)</p>
          <audio controls src={audioUrl} className="w-full h-10" />
        </div>
      )}
    </div>
  )
}
