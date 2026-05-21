'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface StatusMessage {
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
  transcription?: string;
  actions?: Array<{ intent: string; createdEntityId?: string }>;
}

export default function MicRecorder() {
  const router = useRouter()
  const [isRecording, setIsRecording] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [uploadedKey, setUploadedKey] = useState<string | null>(null)
  const [volume, setVolume] = useState<number>(0)
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null)

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
      setStatusMessage({
        type: 'error',
        title: 'Microphone Error',
        description: 'Microphone access failed. Please ensure microphone permissions are granted.'
      })
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
      const form = new FormData()
      // Explicitly send as audio_command.webm matching backend boundaries
      form.append('file', blob, 'audio_command.webm')
      
      const response = await fetch('/api/voice-command', {
        method: 'POST',
        body: form
      })
      
      const data = await response.json()
      
      if (data.success) {
        console.log("[SYSTEM] Voice orchestration complete:", data.meta)
        
        setStatusMessage({
          type: 'success',
          title: 'Voice Command Executed',
          transcription: data.meta.transcription,
          actions: data.meta.results
        })
        
        // TRICK TO TRIGGER AUTOMATIC REAL-TIME REFRESH OF PRISMA COUNTERS WITHOUT FULL PAGE RELOAD
        router.refresh()
      } else {
        setStatusMessage({
          type: 'error',
          title: 'AI Processing Error',
          description: data.error
        })
      }
    } catch (e) {
      console.error('[CORE] Global upload failure:', e)
      setStatusMessage({
        type: 'error',
        title: 'Network Error',
        description: 'Network layer connection drop.'
      })
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

      {statusMessage && (
        <div className={`w-full p-4 rounded-xl border relative text-sm transition-all duration-300 ${
          statusMessage.type === 'success'
            ? 'bg-green-50/70 border-green-200 text-green-950 dark:bg-green-950/20 dark:border-green-800/40 dark:text-green-100'
            : 'bg-red-50/70 border-red-200 text-red-950 dark:bg-red-950/20 dark:border-red-800/40 dark:text-red-100'
        }`}>
          <button
            onClick={() => setStatusMessage(null)}
            className="absolute top-2.5 right-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-1"
            title="Dismiss"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          <div className="flex items-start gap-2.5">
            {statusMessage.type === 'success' ? (
              <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-sm tracking-tight">{statusMessage.title}</h4>
              
              {statusMessage.description && (
                <p className="mt-1 text-xs opacity-90 leading-relaxed">{statusMessage.description}</p>
              )}
              
              {statusMessage.transcription && (
                <div className="mt-2.5 bg-white/50 dark:bg-zinc-950/30 p-2.5 rounded-lg border border-zinc-200/50 dark:border-zinc-800/30">
                  <span className="text-[9px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500 block mb-0.5">Transcribed Input</span>
                  <p className="italic text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    "{statusMessage.transcription}"
                  </p>
                </div>
              )}
              
              {statusMessage.actions && statusMessage.actions.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <span className="text-[9px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500 block mb-1">Actions Executed</span>
                  {statusMessage.actions.map((act, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 text-green-500"></span>
                      <span className="font-mono bg-green-100/50 dark:bg-green-900/20 px-1.5 py-0.5 rounded text-[10px] font-bold text-green-700 dark:text-green-400">
                        {act.intent}
                      </span>
                      <span className="text-[10px] opacity-75 truncate">
                        {act.createdEntityId ? `(ID: ${act.createdEntityId.substring(0, 8)}...)` : '(Logged)'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
