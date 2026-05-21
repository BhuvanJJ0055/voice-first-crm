// app/api/cron/daily-summary/route.ts
// Manual trigger endpoint for the daily admin digest.
//
// Usage:
//   curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/daily-summary
//
// This endpoint is functionally identical to the automated cron — it calls the
// same runDailySummary() pipeline, so any manual test is an exact production rehearsal.
// Secure with CRON_SECRET to prevent unauthorized triggers in staging/production.

import { NextRequest, NextResponse } from "next/server"
import { runDailySummary } from "@/lib/utils/scheduler"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  // Authenticate with bearer token
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized — valid CRON_SECRET bearer token required." },
      { status: 401 },
    )
  }

  try {
    console.log("[CRON API] Manual daily summary trigger received.")
    const result = await runDailySummary()

    return NextResponse.json({
      success: true,
      emailSent: result.emailSent,
      summaryLength: result.summary.length,
      message: result.emailSent
        ? "Digest generated and email dispatched."
        : "Digest generated. Email logged to console (SMTP not configured).",
    })
  } catch (error: any) {
    console.error("[CRON API] Daily summary failed:", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    )
  }
}
