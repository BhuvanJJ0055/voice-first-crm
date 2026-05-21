import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import MicRecorder from "@/components/voice/MicRecorder"

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // 1. Check if the user is authenticated
  const session = await auth()

  if (!session || !session.user) {
    redirect("/login")
  }

  const userId = (session.user as any).id
  const userRole = (session.user as any).role

  // 2–4. Fetch all dashboard data in a single parallel Promise.all() batch.
  // Previously 5 sequential round-trips to Neon; now resolved in one parallel wave.
  const [
    openTasksCount,
    pendingLeavesCount,
    recentLogs,
    openTasks,
    pendingLeaves,
  ] = await Promise.all([
    prisma.task.count({
      where: {
        status: "OPEN",
        ...(userRole === "EMPLOYEE" ? { assignedToId: userId } : {}),
      },
    }),
    prisma.leave.count({
      where: {
        status: "PENDING",
        ...(userRole === "EMPLOYEE" ? { userId: userId } : {}),
      },
    }),
    prisma.activityLog.findMany({
      where: { userId: userId },
      orderBy: { timestamp: "desc" },
      take: 5,
    }),
    prisma.task.findMany({
      where: {
        status: "OPEN",
        ...(userRole === "EMPLOYEE" ? { assignedToId: userId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.leave.findMany({
      where: {
        status: "PENDING",
        ...(userRole === "EMPLOYEE" ? { userId: userId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ])

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex justify-between items-center bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">VoxCRM Dashboard</h1>
            <p className="text-zinc-500 mt-1">
              Welcome back, <span className="font-semibold text-blue-600">{session.user.name}</span>
            </p>
          </div>
          <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold tracking-wider uppercase">
            {userRole}
          </span>
        </header>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Panel */}
          <div className="col-span-1 lg:col-span-2 space-y-8">
            {/* Audio Recorder Card */}
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800">
              <h2 className="text-xl font-bold mb-4 text-zinc-900 dark:text-white">AI Voice Assistant</h2>
              <p className="text-zinc-500 mb-6 text-sm"> Speak orders clearly to manage records dynamically.</p>
              <div className="bg-zinc-50 dark:bg-zinc-950 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <MicRecorder />
              </div>
            </div>

            {/* Professional Real-Time Audit Feed */}
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800">
              <h2 className="text-xl font-bold mb-4 text-zinc-900 dark:text-white">Recent Voice Operations</h2>
              <div className="flow-root">
                <ul className="-my-5 divide-y divide-zinc-200 dark:divide-zinc-800">
                  {recentLogs.length === 0 ? (
                    <p className="text-sm text-zinc-400 py-4 text-center">No voice operations logged yet.</p>
                  ) : (
                    recentLogs.map((log) => (
                      <li key={log.id} className="py-4">
                        <div className="flex items-center space-x-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                              {log.voiceInput ? `"${log.voiceInput}"` : "[Scheduled Background Operation]"}
                            </p>
                            <p className="text-xs text-zinc-400 mt-0.5">
                              Intent Target: <span className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-600 dark:text-zinc-300">{log.action}</span>
                            </p>
                          </div>
                          <div>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              log.status === "SUCCESS" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                            }`}>
                              {log.status}
                            </span>
                          </div>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>

          </div>

          {/* Right Panel: Quick Stats & Live Feeds */}
          <div className="col-span-1 space-y-8">
            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl shadow-sm border border-zinc-200/80 dark:border-zinc-800 flex justify-between items-start hover:shadow-md transition-all">
                <div>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-wider">
                    {userRole === "ADMIN" ? "Open Tasks" : "My Tasks"}
                  </p>
                  <p className="text-3xl font-black text-zinc-900 dark:text-white mt-2 font-sans tracking-tight">
                    {openTasksCount}
                  </p>
                </div>
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 rounded-xl text-blue-600 dark:text-blue-400">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
              </div>
              
              <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl shadow-sm border border-zinc-200/80 dark:border-zinc-800 flex justify-between items-start hover:shadow-md transition-all">
                <div>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-wider">
                    {userRole === "ADMIN" ? "Pending Leaves" : "My Leaves"}
                  </p>
                  <p className="text-3xl font-black text-zinc-900 dark:text-white mt-2 font-sans tracking-tight">
                    {pendingLeavesCount}
                  </p>
                </div>
                <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 rounded-xl text-amber-600 dark:text-amber-400">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Active Open Tasks Card */}
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Active Open Tasks
                </h2>
                <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 font-mono px-2 py-0.5 rounded-full font-bold">
                  {openTasks.length}
                </span>
              </div>
              <div className="space-y-3.5">
                {openTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center text-zinc-400 dark:text-zinc-650">
                    <svg className="w-8 h-8 opacity-40 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-sm font-medium">All caught up! No active tasks.</p>
                  </div>
                ) : (
                  openTasks.map((task) => (
                    <div key={task.id} className="group p-4 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200/60 dark:border-zinc-800/80 border-l-4 border-l-blue-500 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {task.title}
                        </h3>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200/50 dark:border-blue-900/40">
                          {task.status}
                        </span>
                      </div>
                      {task.description && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 line-clamp-2 leading-relaxed">
                          {task.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-zinc-200/50 dark:border-zinc-800/50 text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          Created {new Date(task.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Pending Leaves Card */}
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Pending Leaves
                </h2>
                <span className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 font-mono px-2 py-0.5 rounded-full font-bold">
                  {pendingLeaves.length}
                </span>
              </div>
              <div className="space-y-3.5">
                {pendingLeaves.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center text-zinc-400 dark:text-zinc-650">
                    <svg className="w-8 h-8 opacity-40 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm font-medium">No pending leave requests.</p>
                  </div>
                ) : (
                  pendingLeaves.map((leave) => (
                    <div key={leave.id} className="group p-4 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200/60 dark:border-zinc-800/80 border-l-4 border-l-amber-500 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                      <div className="flex justify-between items-start gap-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/30">
                          {leave.type.replace('_', ' ')}
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
                          {leave.status}
                        </span>
                      </div>
                      {leave.reason && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2.5 line-clamp-2 leading-relaxed">
                          {leave.reason}
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-zinc-200/50 dark:border-zinc-800/50 text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Date: {new Date(leave.date).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
