import type { PrismaClient } from '@prisma/client';

/**
 * Daily digest of new Lead5 signals.
 *
 * Takes the Prisma client as a parameter so the cron script can run it without
 * loading the API's config (which requires auth env vars the cron does not have).
 */

export const DIGEST_SOURCE = 'lead5';
export const DIGEST_TOP_N = 20;

export interface DigestSignal {
  id: string;
  company: string;
  jobTitle: string;
  metro: string;
  sourceUrl: string | null;
  status: string;
  score: number | null;
  summary: string | null;
  sourceErrors: string[];
}

export interface SignalDigest {
  since: string;
  until: string;
  newCount: number;
  pendingCount: number;
  sourceErrorCount: number;
  top: DigestSignal[];
}

interface PayloadShape {
  companyName?: string;
  company?: string;
  jobTitle?: string;
  metro?: string;
}

interface RecommendationShape {
  overallScore?: number;
  summary?: string;
  sourceErrors?: unknown;
}

function asRecord<T>(value: unknown): T {
  return (value && typeof value === 'object' ? value : {}) as T;
}

export async function buildSignalDigest(prisma: PrismaClient, since: Date): Promise<SignalDigest> {
  const until = new Date();
  const signals = await prisma.signal.findMany({
    where: { source: DIGEST_SOURCE, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  });

  const rows: DigestSignal[] = signals.map((s) => {
    const payload = asRecord<PayloadShape>(s.rawPayload);
    const rec = asRecord<RecommendationShape>(s.recommendation);
    const sourceErrors = Array.isArray(rec.sourceErrors)
      ? rec.sourceErrors.filter((e): e is string => typeof e === 'string')
      : [];
    return {
      id: s.id,
      company: payload.companyName || payload.company || 'Unknown Company',
      jobTitle: payload.jobTitle || s.summary || 'Unknown Position',
      metro: payload.metro || '',
      sourceUrl: s.sourceUrl,
      status: s.status,
      score: typeof rec.overallScore === 'number' ? rec.overallScore : null,
      summary: typeof rec.summary === 'string' ? rec.summary : null,
      sourceErrors,
    };
  });

  const top = [...rows]
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, DIGEST_TOP_N);

  return {
    since: since.toISOString(),
    until: until.toISOString(),
    newCount: rows.length,
    pendingCount: rows.filter((r) => r.status === 'pending').length,
    sourceErrorCount: rows.filter((r) => r.sourceErrors.length > 0).length,
    top,
  };
}

/** Slack requires & < > escaped in message text; they otherwise start mentions and links. */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Returns the URL only if it is plain http(s) and cannot break out of a <url|label> link. */
export function safeLinkUrl(raw: string | null): string | null {
  if (!raw || raw.includes('|') || raw.includes('>') || raw.includes('<')) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

/** Slack mrkdwn text. Failures lead the message so a bad day cannot read as success. */
export function formatDigestMessage(d: SignalDigest): string {
  const lines: string[] = [];
  const unhealthy = d.pendingCount > 0 || d.sourceErrorCount > 0;

  lines.push(`*Outbound daily digest: ${d.newCount} new Lead5 signal${d.newCount === 1 ? '' : 's'}*`);
  lines.push(`_${d.since} to ${d.until}_`);

  if (d.pendingCount > 0) {
    lines.push(
      `:warning: *${d.pendingCount} of ${d.newCount} signal${d.newCount === 1 ? '' : 's'} NOT ENRICHED* (still pending, enrichment failed). Check the API logs for "ENRICHMENT FAILED".`,
    );
  }
  if (d.sourceErrorCount > 0) {
    lines.push(
      `:warning: *${d.sourceErrorCount} signal${d.sourceErrorCount === 1 ? '' : 's'} missing PartnerConnect data* (recommendation.sourceErrors is set). Scores for these are incomplete.`,
    );
  }
  if (!unhealthy) {
    lines.push(
      d.newCount === 0
        ? ':information_source: No new signals in this window. If the scout should have run, check lead5-scout.'
        : ':white_check_mark: All new signals enriched with no source errors.',
    );
  }

  if (d.top.length > 0) {
    lines.push('');
    lines.push(`*Top ${d.top.length} by recommendation score*`);
    d.top.forEach((s, i) => {
      const score = s.score === null ? 'no score' : `score ${s.score}`;
      const where = s.metro ? ` (${escapeSlack(s.metro)})` : '';
      const flags = [
        s.status === 'pending' ? ':warning: not enriched' : '',
        s.sourceErrors.length > 0 ? ':warning: PartnerConnect missing' : '',
      ].filter(Boolean).join(' ');
      const company = escapeSlack(s.company);
      const url = safeLinkUrl(s.sourceUrl);
      const name = url ? `<${escapeSlack(url)}|${company}>` : company;
      lines.push(`${i + 1}. ${name}: ${escapeSlack(s.jobTitle)}${where} - ${score}${flags ? ` ${flags}` : ''}`);
      if (s.summary) lines.push(`    ${escapeSlack(s.summary.split('\n')[0].slice(0, 200))}`);
    });
  }

  return lines.join('\n');
}
