// instrumentation.ts
// Next.js server-side startup hook.
// This file is loaded once when the Node.js server process starts.
// It is the official Next.js pattern for running server-only startup logic
// (cron registration, background workers, telemetry) without polling.
//
// Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Guard: only execute on the Node.js runtime.
  // Next.js can also run routes on the Edge runtime (V8 isolates) where
  // node-cron and the file system are unavailable.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initScheduler } = await import("./lib/utils/scheduler")
    initScheduler()
  }
}
