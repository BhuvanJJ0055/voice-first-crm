// lib/utils/scheduler.ts
// Daily digest generator + node-cron scheduler for VoxCRM.
//
// Responsibilities:
//   1. Query Prisma for all OPEN tasks and PENDING leave requests.
//   2. Use Gemini to write a professional HTML admin digest from that data.
//   3. Persist the digest as an ActivityLog row (visible in the dashboard audit trail).
//   4. Deliver via email (falls back to console.log if SMTP is not configured).
//   5. Register a cron job that fires at 08:00 AM IST every day.

import cron from "node-cron"
import { GoogleGenAI } from "@google/genai"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/utils/mailer"

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

// Guard against double-registration (hot-reload in dev can call initScheduler twice)
let schedulerInitialized = false

/**
 * generateDailySummary
 *
 * Fetches live data from Neon and asks Gemini to produce a concise HTML digest.
 * Returns the raw HTML string for email delivery and DB persistence.
 */
export async function generateDailySummary(): Promise<string> {
  const [openTasks, pendingLeaves] = await Promise.all([
    prisma.task.findMany({
      where: { status: "OPEN" },
      include: { assignedTo: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.leave.findMany({
      where: { status: "PENDING" },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const taskList =
    openTasks.length > 0
      ? openTasks
          .map(
            (t, i) =>
              `${i + 1}. "${t.title}" — assigned to ${t.assignedTo?.name ?? "Unassigned"}`,
          )
          .join("\n")
      : "No open tasks."

  const leaveList =
    pendingLeaves.length > 0
      ? pendingLeaves
          .map(
            (l, i) =>
              `${i + 1}. ${l.user.name} (${l.user.email}) — ${l.type.replace("_", " ")}: "${l.reason ?? "No reason"}"`,
          )
          .join("\n")
      : "No pending leave requests."

  const prompt = `You are a CRM assistant generating an HTML admin digest email.

Data:
Open Tasks (${openTasks.length}):
${taskList}

Pending Leave Requests (${pendingLeaves.length}):
${leaveList}

Write a concise, professional HTML email body (no <html> or <body> wrapper tags).
Structure it with:
- A one-line executive summary
- An <ul> of critical open tasks
- An <ul> of pending leave requests needing approval
- A short closing recommendation
Use inline styles for basic formatting. Keep it under 250 words.`

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [prompt],
  })

  return response.text ?? "<p>Summary generation failed — check Gemini API key.</p>"
}

/**
 * runDailySummary
 *
 * Orchestrates the full summary pipeline:
 *   generate → persist to DB audit log → send email
 * Safe to call from both the cron and the manual API endpoint.
 */
export async function runDailySummary(): Promise<{
  summary: string
  emailSent: boolean
}> {
  console.log("[SCHEDULER] Starting daily summary pipeline...")

  const summaryHtml = await generateDailySummary()

  // Persist to DB so the digest appears in the dashboard audit trail
  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } })
  if (adminUser) {
    await prisma.activityLog.create({
      data: {
        userId: adminUser.id,
        action: "DAILY_SUMMARY",
        voiceInput: "[Automated Daily Digest]",
        intentJson: {
          type: "scheduled_digest",
          generatedAt: new Date().toISOString(),
        },
        status: "SUCCESS",
      },
    })
  }

  // Deliver via email (or console.log if SMTP is absent)
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@voxcrm.com"
  const dateLabel = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  await sendEmail(adminEmail, `VoxCRM Daily Digest — ${dateLabel}`, summaryHtml)

  console.log("[SCHEDULER] Daily summary pipeline complete.")
  return { summary: summaryHtml, emailSent: !!process.env.SMTP_USER }
}

/**
 * initScheduler
 *
 * Registers the 8:00 AM IST cron job. Called once from instrumentation.ts
 * on server boot. The schedulerInitialized guard prevents duplicate
 * registrations during Next.js hot-reload in development.
 */
export function initScheduler(): void {
  if (schedulerInitialized) return
  schedulerInitialized = true

  // "0 8 * * *" with timezone Asia/Kolkata = exactly 08:00 IST every day
  cron.schedule(
    "0 8 * * *",
    async () => {
      try {
        await runDailySummary()
      } catch (err) {
        console.error("[SCHEDULER] Daily summary cron failed:", err)
      }
    },
    { timezone: "Asia/Kolkata" },
  )

  console.log(
    "[SCHEDULER] Daily digest cron registered — fires at 08:00 IST daily.",
  )
}
