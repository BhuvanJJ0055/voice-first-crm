import cron from 'node-cron'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/utils/mailer'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
let schedulerInitialized = false

export async function generateDailySummary(): Promise<string> {
  // Fetch all data in parallel — same wave pattern as DAG
  const [openTasks, pendingLeaves, todayMeetings] = await Promise.all([
    prisma.task.findMany({
      where: { status: 'OPEN' },
      include: { assignedTo: { select: { name: true } } },
    }),
    prisma.leave.findMany({
      where: { status: 'PENDING' },
      include: { user: { select: { name: true } } },
    }),
    prisma.meeting.findMany({
      where: {
        startTime: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lte: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      },
      include: { participants: { select: { name: true } } },
    }),
  ])

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `You are Orion, VoxCRM daily briefing assistant.
      Open tasks (${openTasks.length}):
      ${openTasks.map(t => `- "${t.title}" → ${t.assignedTo?.name || 'Unassigned'}`).join('\n')}

      Pending leaves (${pendingLeaves.length}):
      ${pendingLeaves.map(l => `- ${l.user.name}: ${l.type}`).join('\n')}

      Today's meetings (${todayMeetings.length}):
      ${todayMeetings.map(m => `- "${m.title}" at ${new Date(m.startTime).toLocaleTimeString('en-IN')}`).join('\n')}

      Write a concise professional HTML summary under 200 words. Inline CSS only, no html/body tags.`
    }],
  })

  return completion.choices[0].message.content || '<p>No summary generated.</p>'
}

export async function runDailySummary() {
  const summaryHtml = await generateDailySummary()
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } })

  if (admins.length > 0) {
    await prisma.activityLog.create({
      data: {
        userId: admins[0].id,
        action: 'DAILY_SUMMARY',
        voiceInput: '[Scheduled Daily Digest]',
        intentJson: { generatedAt: new Date().toISOString(), adminsNotified: admins.length },
        status: 'SUCCESS',
      },
    })

    await Promise.all(
      admins.map((admin) =>
        sendEmail(
          admin.email,
          `VoxCRM Daily Briefing — ${new Date().toDateString()}`,
          summaryHtml
        ).catch((err) => console.error(`[CRON] Failed to email admin ${admin.email}:`, err.message))
      )
    )
  }

  return { summary: summaryHtml, emailSent: !!process.env.RESEND_API_KEY }
}

// Automatic scheduler — 8 AM IST every day
export function initScheduler() {
  if (schedulerInitialized) return
  schedulerInitialized = true

  cron.schedule('0 8 * * *', async () => {
    try {
      await runDailySummary()
      console.log('[CRON] Daily digest sent.')
    } catch (err) {
      console.error('[CRON] Daily digest failed:', err)
    }
  }, { timezone: 'Asia/Kolkata' })

  console.log('[SCHEDULER] Daily digest cron registered — 08:00 AM IST.')
}
