import { auth } from "@/auth"
import { redirect } from "next/navigation"
import MicRecorder from "@/components/voice/MicRecorder"

export default async function DashboardPage() {
  // 1. Check if the user is logged in
  const session = await auth()

  // 2. If no session exists, kick them back to the login page
  if (!session) {
    redirect("/login")
  }

  // 3. Render the Dashboard
  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 md:p-8 relative overflow-hidden">
      {/* Premium Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[800px] h-[600px] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto space-y-8 relative z-10">
        
        {/* Header Section */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center bg-zinc-900/40 backdrop-blur-xl p-6 rounded-3xl border border-zinc-800/50 shadow-2xl">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
              VoxCRM Dashboard
            </h1>
            <p className="text-zinc-400 mt-1">
              Welcome back, <span className="font-semibold text-blue-400">{session.user?.name}</span>
            </p>
          </div>
          <div className="mt-4 md:mt-0">
            <span className="inline-flex items-center px-4 py-1.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-sm font-bold tracking-widest uppercase shadow-[0_0_15px_rgba(59,130,246,0.2)]">
              {(session.user as any)?.role}
            </span>
          </div>
        </header>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: AI Voice Assistant */}
          <div className="col-span-1 lg:col-span-2 space-y-8">
            <div className="bg-zinc-900/40 backdrop-blur-xl p-8 rounded-3xl border border-zinc-800/50 shadow-2xl relative overflow-hidden group hover:border-blue-500/30 transition-colors duration-500">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
              <div className="relative z-10">
                <h2 className="text-2xl font-bold mb-2 flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </span>
                  AI Voice Assistant
                </h2>
                <p className="text-zinc-400 mb-8 text-sm">
                  Use your microphone to create tasks, update CRM records, or log activities automatically.
                </p>
                
                {/* The Working AI Voice Component */}
                <div className="flex justify-center p-6 bg-zinc-950/50 rounded-2xl border border-zinc-800/50">
                  <MicRecorder />
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Quick Stats */}
          <div className="col-span-1 space-y-6">
            <div className="bg-zinc-900/40 backdrop-blur-xl p-8 rounded-3xl border border-zinc-800/50 shadow-2xl hover:border-purple-500/30 transition-colors duration-500">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </span>
                Quick Stats
              </h2>
              <div className="space-y-4">
                <div className="p-5 bg-zinc-950/50 rounded-2xl border border-zinc-800/50 hover:bg-zinc-800/50 transition-colors group">
                  <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider mb-1">Open Tasks</p>
                  <p className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-zinc-500 group-hover:from-white group-hover:to-blue-400 transition-all duration-300">0</p>
                </div>
                <div className="p-5 bg-zinc-950/50 rounded-2xl border border-zinc-800/50 hover:bg-zinc-800/50 transition-colors group">
                  <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider mb-1">Pending Leaves</p>
                  <p className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-zinc-500 group-hover:from-white group-hover:to-purple-400 transition-all duration-300">0</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
