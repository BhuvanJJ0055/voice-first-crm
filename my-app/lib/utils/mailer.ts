// lib/utils/mailer.ts
// Nodemailer email utility with graceful SMTP degradation.
// If SMTP env vars are absent the message is printed to the server console
// instead — the caller never throws, so the scheduler always completes cleanly.

import nodemailer from "nodemailer"

const hasSmtpConfig = !!(
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
)

// Singleton transporter — created once, reused across all sends
const transporter = hasSmtpConfig
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? "587", 10),
      secure: false, // STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null

/**
 * sendEmail
 *
 * Sends an HTML email via SMTP when credentials are configured.
 * Falls back to a formatted console.log so the daily summary is never lost
 * even in a local environment without an SMTP server.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!transporter) {
    // Graceful degradation — print digest to server terminal
    console.log("\n[MAILER] ── SMTP not configured. Printing email digest ──")
    console.log(`[MAILER] TO      : ${to}`)
    console.log(`[MAILER] SUBJECT : ${subject}`)
    console.log(`[MAILER] BODY    :\n${html.replace(/<[^>]+>/g, "").trim()}\n`)
    console.log("[MAILER] ─────────────────────────────────────────────────\n")
    return
  }

  await transporter.sendMail({
    from: `"VoxCRM System" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  })

  console.log(`[MAILER] Email dispatched → ${to} | Subject: "${subject}"`)
}
