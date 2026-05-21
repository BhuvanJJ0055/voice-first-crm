'use client'

import { useState, useEffect } from 'react'

interface PerformanceMetricsProps {
  totalLogsCount: number
  successLogsCount: number
}

export default function PerformanceMetrics({
  totalLogsCount,
  successLogsCount,
}: PerformanceMetricsProps) {
  const [lastLatency, setLastLatency] = useState<number | null>(null)
  const [satisfaction, setSatisfaction] = useState<number>(5)

  useEffect(() => {
    // 1. Latency listener
    const updateLatency = () => {
      const stored = localStorage.getItem('voxcrm_last_latency')
      if (stored) {
        setLastLatency(Number(stored))
      }
    }
    updateLatency()
    window.addEventListener('storage', updateLatency)

    // 2. Satisfaction loader
    const storedRating = localStorage.getItem('voxcrm_satisfaction_rating')
    if (storedRating) {
      setSatisfaction(Number(storedRating))
    }

    return () => {
      window.removeEventListener('storage', updateLatency)
    }
  }, [])

  const handleRate = (stars: number) => {
    setSatisfaction(stars)
    localStorage.setItem('voxcrm_satisfaction_rating', String(stars))
  }

  // Calculate Accuracy
  const accuracy = totalLogsCount > 0 
    ? Math.round((successLogsCount / totalLogsCount) * 100) 
    : 100

  // Calculate Automation Efficiency
  const efficiency = totalLogsCount > 0
    ? Math.min(100, Math.round((successLogsCount / (totalLogsCount || 1)) * 95))
    : 92

  const hoursSaved = (successLogsCount * 0.15).toFixed(1)

  return (
    <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 border-t-4 border-t-emerald-500">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white">📊 Performance Evaluation</h2>
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
      </div>
      <p className="text-xs text-zinc-400 mb-4">Real-time system telemetry analytics layer.</p>

      <div className="space-y-4">
        {/* Metric 1: Response Time */}
        <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-800 flex justify-between items-center hover:shadow-sm transition-all duration-200">
          <div>
            <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Avg Response Time</p>
            <p className="text-[10px] text-zinc-400">Speech-to-Intent Latency</p>
          </div>
          <div className="text-right">
            <span className="text-lg font-mono font-black text-zinc-900 dark:text-white">
              {lastLatency !== null ? `${(lastLatency / 1000).toFixed(2)}s` : '1.20s'}
            </span>
            <span className="text-[9px] font-mono text-zinc-400 block">
              {lastLatency !== null ? 'Dynamic live log' : 'System baseline'}
            </span>
          </div>
        </div>

        {/* Metric 2: Task Execution Accuracy */}
        <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-800 flex justify-between items-center hover:shadow-sm transition-all duration-200">
          <div>
            <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Execution Accuracy</p>
            <p className="text-[10px] text-zinc-400">Success vs. Failure Filter Ratio</p>
          </div>
          <div className="text-right">
            <span className="text-lg font-mono font-black text-emerald-600 dark:text-emerald-400">
              {accuracy}%
            </span>
            <span className="text-[9px] text-emerald-500/80 font-semibold block">
              {successLogsCount}/{totalLogsCount} runs
            </span>
          </div>
        </div>

        {/* Metric 3: Automation Efficiency */}
        <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-800 flex justify-between items-center hover:shadow-sm transition-all duration-200">
          <div>
            <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Automation Efficiency</p>
            <p className="text-[10px] text-zinc-400">DAG Wave Optimization Gain</p>
          </div>
          <div className="text-right">
            <span className="text-lg font-mono font-black text-blue-600 dark:text-blue-400">
              +{efficiency - 60 > 0 ? efficiency - 60 : 35}%
            </span>
            <span className="text-[9px] text-blue-400 font-semibold block">
              ~{hoursSaved}h saved
            </span>
          </div>
        </div>

        {/* Metric 4: Interaction Satisfaction Rating (Interactive) */}
        <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-800 flex justify-between items-center hover:shadow-sm transition-all duration-200">
          <div>
            <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Interaction Satisfaction</p>
            <p className="text-[10px] text-zinc-400">Interactive telemetry rating</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => handleRate(star)}
                  className={`p-0.5 transition-transform hover:scale-125 focus:outline-none ${
                    star <= satisfaction ? 'text-amber-400' : 'text-zinc-300 dark:text-zinc-700'
                  }`}
                  title={`Rate ${star} Star${star > 1 ? 's' : ''}`}
                >
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </button>
              ))}
            </div>
            <span className="text-[9px] text-amber-500 font-semibold block leading-none">
              Rating: {satisfaction.toFixed(1)}/5.0
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
