import MicRecorder from "@/components/voice/MicRecorder"

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-6">
      <div className="text-center mb-8">
        <h1 className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent mb-2">
          VoxCRM
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 font-medium">
          Voice-First Intelligent Workspace
        </p>
      </div>

      <MicRecorder />
    </main>
  )
}
