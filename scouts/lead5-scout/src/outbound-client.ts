/**
 * Outbound API client for creating signals.
 */

export interface SignalPayload {
  opportunityId: string;
  companyName: string;
  jobTitle: string;
  metro: string;
  postedDate: string;
  description: string;
  sourceUrl?: string;
  rawPayload?: Record<string, unknown>;
}

export interface Signal {
  id: string;
  type: string;
  source: string;
  sourceId: string;
  createdAt: string;
}

export class OutboundClient {
  private baseUrl: string;
  private apiKey?: string;
  private dryRun: boolean;

  constructor(options: {
    baseUrl?: string;
    apiKey?: string;
    dryRun?: boolean;
  } = {}) {
    this.baseUrl = (options.baseUrl || 'http://localhost:8004').replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.dryRun = options.dryRun || false;
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });
  }

  /**
   * Check if a signal with this sourceId already exists.
   */
  async checkSignalExists(sourceId: string): Promise<boolean> {
    try {
      // API doesn't filter by sourceId, so we need to fetch and filter client-side
      const response = await this.fetch(`/api/v1/signals?limit=1000`);
      if (response.ok) {
        const data = await response.json();
        const signals = Array.isArray(data) ? data : (data.data || []);
        // Filter by sourceId client-side
        return signals.some((s: { sourceId?: string }) => s.sourceId === sourceId);
      }
      return false;
    } catch (error) {
      console.warn('Failed to check signal existence:', error);
      return false;
    }
  }

  /**
   * Report scout status (for debugging on Render where logs don't show).
   */
  async reportStatus(status: string, details?: Record<string, unknown>): Promise<void> {
    const signalData = {
      type: 'scout_status',
      source: 'lead5-scout',
      sourceId: `lead5-scout:status:${Date.now()}`,
      severity: status.includes('error') ? 'high' : 'low',
      confidence: 1.0,
      summary: `Scout: ${status}`,
      rawPayload: {
        status,
        timestamp: new Date().toISOString(),
        ...details,
      },
    };

    try {
      await this.fetch('/api/v1/signals', {
        method: 'POST',
        body: JSON.stringify(signalData),
      });
    } catch {
      // Ignore errors - this is just for debugging
    }
  }

  /**
   * Create a new signal in Outbound.
   */
  async createSignal(payload: SignalPayload): Promise<Signal | null> {
    const sourceId = `lead5:opp:${payload.opportunityId}`;

    // Check if already exists
    const exists = await this.checkSignalExists(sourceId);
    if (exists) {
      console.log(`Signal already exists, skipping: ${sourceId} (${payload.companyName})`);
      return null;
    }

    const signalData: Record<string, unknown> = {
      type: 'job_posting',
      source: 'lead5',
      sourceId,
      severity: 'medium',
      confidence: 0.9,
      summary: `${payload.jobTitle} - ${payload.companyName}`,
      rawPayload: {
        companyName: payload.companyName,
        jobTitle: payload.jobTitle,
        metro: payload.metro,
        postedDate: payload.postedDate,
        description: payload.description,
        ...payload.rawPayload,
      },
    };

    // Only include sourceUrl if it's a valid URL
    if (payload.sourceUrl && payload.sourceUrl.startsWith('http')) {
      signalData.sourceUrl = payload.sourceUrl;
    }

    if (this.dryRun) {
      console.log(`DRY RUN: Would create signal:`, {
        sourceId,
        company: payload.companyName,
        jobTitle: payload.jobTitle,
      });
      return signalData as unknown as Signal;
    }

    try {
      const response = await this.fetch('/api/v1/signals', {
        method: 'POST',
        body: JSON.stringify(signalData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to create signal: ${response.status} ${errorText}`);
        return null;
      }

      const created = await response.json() as Signal;
      console.log(`Created signal: ${sourceId} (${payload.companyName}) -> ${created.id}`);
      return created;
    } catch (error) {
      console.error(`Failed to create signal for ${payload.companyName}:`, error);
      return null;
    }
  }
}
