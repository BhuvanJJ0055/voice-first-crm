import { Resend } from 'resend'

export async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.log('[MAILER] No API key — printing email:', { to, subject })
    return
  }
  const resend = new Resend(key)
  await resend.emails.send({ from: 'VoxCRM <notifications@voxcrm.com>', to, subject, html })
}
