import { NextRequest, NextResponse } from 'next/server'
import { buildDigest, narrateDigest, postDigestToSlack } from '@/lib/digest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET  → preview the digest (no send). POST → build and post to Slack.
export async function GET() {
  try {
    const digest = await buildDigest()
    return NextResponse.json({ ok: true, ...digest, slackConfigured: !!process.env.SLACK_WEBHOOK_URL })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}

export async function POST(_req: NextRequest) {
  try {
    const digest = await buildDigest()
    const text = await narrateDigest(digest)
    const sent = await postDigestToSlack(text)
    return NextResponse.json({ ok: true, sent, text, counts: digest.counts })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
