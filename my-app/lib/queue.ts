import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
let connection: IORedis | null = null
let notificationQueue: Queue | null = null

try {
  connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  })

  connection.on('error', (err) => {
    console.warn('[QUEUE] Redis unavailable — using synchronous fallback:', err.message)
  })

  notificationQueue = new Queue('notifications', {
    connection: connection as any,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    },
  })
  console.log('[QUEUE] BullMQ connected to Redis.')
} catch (e) {
  console.warn('[QUEUE] Redis not running. Notifications will log to console.')
}

export { notificationQueue }

if (connection) {
  const worker = new Worker('notifications', async (job) => {
    const { event, userId, type, reason } = job.data

    // 1. Forward to n8n webhook
    const webhookUrl = process.env.N8N_WEBHOOK_URL
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(job.data),
        })
      } catch (err) {
        console.warn('[WORKER] n8n webhook failed (non-fatal):', err)
      }
    }

    // 2. Send email via Resend
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const { Resend } = await import('resend')
      const resend = new Resend(resendKey)
      await resend.emails.send({
        from: 'VoxCRM <notifications@voxcrm.com>',
        to: process.env.ADMIN_EMAIL || 'admin@voxcrm.com',
        subject: `VoxCRM — ${event}`,
        html: `<p>Event: <strong>${event}</strong></p>
               <p>User: ${userId} | Type: ${type || 'N/A'} | Reason: ${reason || 'N/A'}</p>`,
      })
    }
  }, { connection: connection as any })

  worker.on('failed', (job, err) => {
    console.error(`[WORKER] Job ${job?.id} failed:`, err.message)
  })
}
