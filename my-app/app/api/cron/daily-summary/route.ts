import { NextRequest, NextResponse } from 'next/server'
import { runDailySummary } from '@/lib/utils/scheduler'

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  // Bearer token protection — matches audit's security model
  const auth = req.headers.get('authorization')
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`

  if (!auth || auth !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runDailySummary()
    return NextResponse.json({
      success: true,
      emailSent: result.emailSent,
      summaryLength: result.summary.length,
      message: 'Digest generated and email dispatched.'
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
