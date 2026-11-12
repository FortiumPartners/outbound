/**
 * Posts the daily Lead5 signal digest to Slack.
 *
 * Runs as a Render cron (outbound-digest). Talks to Prisma directly, so it needs
 * only DATABASE_URL (and SLACK_WEBHOOK_URL to post). Without SLACK_WEBHOOK_URL it
 * prints the message and exits 0.
 *
 * Usage: node dist/scripts/send-digest.js [--since <ISO>]
 */
import { PrismaClient } from '@prisma/client';
import { buildSignalDigest, formatDigestMessage } from '../services/signal-digest.js';

async function main(): Promise<void> {
  const sinceFlag = process.argv.indexOf('--since');
  const since = sinceFlag >= 0
    ? new Date(process.argv[sinceFlag + 1])
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) {
    throw new Error('--since must be an ISO date');
  }

  const prisma = new PrismaClient();
  try {
    const digest = await buildSignalDigest(prisma, since);
    const text = formatDigestMessage(digest);

    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (!webhook) {
      console.log('SLACK_WEBHOOK_URL not set; printing digest instead of posting:\n');
      console.log(text);
      return;
    }

    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
    }
    console.log(`Digest posted to Slack (${digest.newCount} new, ${digest.pendingCount} pending, ${digest.sourceErrorCount} with source errors)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[send-digest] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
