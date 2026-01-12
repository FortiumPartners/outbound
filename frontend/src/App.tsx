import { useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, Users, Zap, Lightbulb, LayoutDashboard, ChevronDown, ChevronUp, MapPin, Briefcase, User, ExternalLink } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8004';

// Type definitions for signal data
interface PEContact {
  name: string;
  title: string;
  organization: string;
  email?: string;
  linkedIn?: string;
}

interface CompanyContact {
  name: string;
  title?: string;
  email?: string;
}

interface AvailablePartner {
  uid: string;
  name: string;
  role: string;
  availabilityNext30: number;
  availabilityNext60?: number;
  availabilityNext90?: number;
  email?: string;
}

interface Connection {
  type: string;
  strength: string;
  via: string;
  evidence: string;
  score: number;
}

interface ContactRecommendation {
  contact: {
    name: string;
    title: string;
    organization: string;
    email?: string;
    linkedIn?: string;
  };
  priority: 1 | 2 | 3;
  score: number;
  approach: string;
  channel: string;
  justification: string;
  conversationOpener?: string;
}

interface SignalRecommendation {
  summary?: string;
  connections?: Connection[];
  availablePartners?: AvailablePartner[];
  contactRecommendations?: ContactRecommendation[];
  companyContacts?: CompanyContact[];
  overallScore?: number;
  engagementType?: string;
}

interface SignalRawPayload {
  companyName?: string;
  company?: string;
  jobTitle?: string;
  metro?: string;
  postedDate?: string;
  description?: string;
  peContacts?: PEContact[];
  contacts?: CompanyContact[];
  sourceUrl?: string;
  url?: string;
}

interface Signal {
  id: string;
  type: string;
  source: string;
  severity: string;
  summary: string;
  status: string;
  rawPayload: SignalRawPayload | null;
  recommendation: SignalRecommendation | null;
  hubspotDealId: string | null;
  pushedAt: string | null;
  pushError: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  createdAt: string;
}

// Status colors for the status dot
const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500',
  ready: 'bg-blue-500',
  pushed: 'bg-green-500',
  push_failed: 'bg-red-500',
  archived: 'bg-gray-400',
};

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  ready: 'Ready',
  pushed: 'Pushed',
  push_failed: 'Failed',
  archived: 'Archived',
};

function NavLink({ to, children, icon: Icon }: { to: string; children: React.ReactNode; icon: React.ComponentType<{ className?: string }> }) {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

  return (
    <Link
      to={to}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </Link>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Fortium Outbound</h1>
            <p className="text-sm text-muted-foreground">Virtual BDR System</p>
          </div>
          <nav className="flex items-center gap-2">
            <NavLink to="/" icon={LayoutDashboard}>Dashboard</NavLink>
            <NavLink to="/accounts" icon={Building2}>Accounts</NavLink>
            <NavLink to="/contacts" icon={Users}>Contacts</NavLink>
            <NavLink to="/signals" icon={Zap}>Signals</NavLink>
            <NavLink to="/hypotheses" icon={Lightbulb}>Hypotheses</NavLink>
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}

function DashboardPage() {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/health/db`);
      if (!res.ok) throw new Error('API unavailable');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'count'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/accounts?limit=1`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const { data: contacts } = useQuery({
    queryKey: ['contacts', 'count'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/contacts?limit=1`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const { data: signals } = useQuery({
    queryKey: ['signals', 'count'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/signals?limit=1`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const { data: hypothesesQueue } = useQuery({
    queryKey: ['hypotheses', 'queue'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/hypotheses/queue?limit=1`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  return (
    <div className="grid gap-6">
      {/* Status */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">System Status</h2>
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${
            health?.status === 'healthy' ? 'bg-green-500' : 'bg-yellow-500'
          }`} />
          <span className="capitalize">{health?.status || 'checking...'}</span>
          {health?.database && (
            <span className="text-muted-foreground text-sm">
              (DB: {health.database})
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Building2 className="h-4 w-4" />
            <span className="text-sm">Accounts</span>
          </div>
          <p className="text-3xl font-bold">{accounts?.pagination?.total ?? '-'}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Users className="h-4 w-4" />
            <span className="text-sm">Contacts</span>
          </div>
          <p className="text-3xl font-bold">{contacts?.pagination?.total ?? '-'}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Zap className="h-4 w-4" />
            <span className="text-sm">Signals</span>
          </div>
          <p className="text-3xl font-bold">{signals?.pagination?.total ?? '-'}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Lightbulb className="h-4 w-4" />
            <span className="text-sm">Pending Review</span>
          </div>
          <p className="text-3xl font-bold">{hypothesesQueue?.pagination?.total ?? '-'}</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="font-semibold mb-2">Universe Management</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Manage your target accounts and contacts
          </p>
          <div className="flex gap-2">
            <Link to="/accounts" className="text-primary hover:underline text-sm">Accounts →</Link>
            <Link to="/contacts" className="text-primary hover:underline text-sm">Contacts →</Link>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h3 className="font-semibold mb-2">Review Queue</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Hypotheses awaiting approval
          </p>
          <Link to="/hypotheses?status=pending_review" className="text-primary hover:underline text-sm">
            View Queue →
          </Link>
        </div>
      </div>

      {/* API Documentation */}
      <div className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold mb-2">API Documentation</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Explore the Outbound API using Swagger UI
        </p>
        <a
          href={`${API_URL}/docs`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline text-sm"
        >
          Open API Docs →
        </a>
      </div>
    </div>
  );
}

function AccountsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/accounts`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Accounts</h2>
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : data?.data?.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No accounts yet</p>
          <p className="text-sm text-muted-foreground mt-2">
            Use the API to create accounts: POST /api/v1/accounts
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Name</th>
                <th className="text-left p-3 font-medium">Domain</th>
                <th className="text-left p-3 font-medium">Industry</th>
                <th className="text-left p-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {data?.data?.map((account: { id: string; name: string; domain: string | null; industry: string | null; createdAt: string }) => (
                <tr key={account.id} className="border-b last:border-0">
                  <td className="p-3">{account.name}</td>
                  <td className="p-3 text-muted-foreground">{account.domain || '-'}</td>
                  <td className="p-3 text-muted-foreground">{account.industry || '-'}</td>
                  <td className="p-3 text-muted-foreground text-sm">
                    {new Date(account.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ContactsPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Contacts</h2>
      <div className="rounded-lg border bg-card p-8 text-center">
        <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Contact management coming soon</p>
      </div>
    </div>
  );
}

// SignalCard Component - Expandable card for displaying signal details
function SignalCard({ signal, isExpanded, onToggle }: {
  signal: Signal;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const payload = signal.rawPayload;
  const rec = signal.recommendation;

  // Extract display values
  const companyName = payload?.companyName || payload?.company || 'Unknown Company';
  const jobTitle = payload?.jobTitle || signal.summary || 'Unknown Position';
  const metro = payload?.metro;
  const peContacts = payload?.peContacts || [];
  const companyContacts = payload?.contacts || [];
  const peFirm = peContacts[0]?.organization;

  // Get recommendation data if available
  const connections = rec?.connections || [];
  const availablePartners = rec?.availablePartners || [];
  const contactRecommendations = rec?.contactRecommendations || [];
  const recCompanyContacts = rec?.companyContacts || [];

  // Calculate summary chips
  const peMatchCount = connections.filter(c => c.type === 'pe_relationship').length;
  const partnersAvailable = availablePartners.length;

  // Format date
  const createdDate = new Date(signal.createdAt);
  const dateStr = createdDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Extract "Why We Can Win" reasons from connections
  const whyWeCanWin = connections
    .filter(c => c.strength === 'strong' || c.strength === 'medium')
    .slice(0, 3)
    .map(c => c.evidence);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Collapsed View - Always visible */}
      <div className="p-4">
        {/* Header row: status, date */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusColors[signal.status] || 'bg-gray-400'}`} />
            <span className="text-sm text-muted-foreground">
              {statusLabels[signal.status] || signal.status}
            </span>
            {signal.pushError && (
              <span className="text-xs text-red-600 ml-2">
                Error: {signal.pushError.slice(0, 50)}...
              </span>
            )}
          </div>
          <span className="text-sm text-muted-foreground">{dateStr}</span>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-lg mb-2">
          {jobTitle} at {companyName}
        </h3>

        {/* Metro + PE Firm */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
          {metro && (
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {metro}
            </span>
          )}
          {peFirm && (
            <span className="flex items-center gap-1">
              <Briefcase className="h-4 w-4" />
              {peFirm}
            </span>
          )}
        </div>

        {/* Summary chips - only show if we have recommendation data */}
        {rec && (
          <div className="flex gap-2 mb-4">
            {peMatchCount > 0 && (
              <span className="px-2 py-1 rounded text-xs bg-green-100 text-green-700">
                PE MATCH: {peMatchCount} closed deal{peMatchCount > 1 ? 's' : ''}
              </span>
            )}
            {partnersAvailable > 0 && (
              <span className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-700">
                PARTNERS: {partnersAvailable} available
              </span>
            )}
            {rec.overallScore && (
              <span className={`px-2 py-1 rounded text-xs ${
                rec.overallScore >= 60 ? 'bg-green-100 text-green-700' :
                rec.overallScore >= 40 ? 'bg-yellow-100 text-yellow-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                Score: {rec.overallScore}
              </span>
            )}
          </div>
        )}

        {/* View Analysis button */}
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-4 w-4" />
              Hide Analysis
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              View Analysis
            </>
          )}
        </button>
      </div>

      {/* Expanded View */}
      {isExpanded && (
        <div className="border-t bg-muted/30 p-4">
          {/* WHY WE CAN WIN section */}
          {whyWeCanWin.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
                Why We Can Win
              </h4>
              <ul className="space-y-1">
                {whyWeCanWin.map((reason, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">*</span>
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Two-column layout: Company Contacts | PE Contacts */}
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {/* Company Contacts (Buyers) */}
            <div>
              <h4 className="text-sm font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                <User className="h-4 w-4" />
                Company Contacts (Buyers)
              </h4>
              {(companyContacts.length > 0 || recCompanyContacts.length > 0) ? (
                <ul className="space-y-2">
                  {[...companyContacts, ...recCompanyContacts].slice(0, 5).map((contact, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{contact.name}</span>
                      {contact.title && <span className="text-muted-foreground"> - {contact.title}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground italic">No contacts found</p>
              )}
            </div>

            {/* PE Contacts (Influencers) */}
            <div>
              <h4 className="text-sm font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                <Briefcase className="h-4 w-4" />
                PE Contacts (Influencers)
              </h4>
              {peContacts.length > 0 ? (
                <ul className="space-y-2">
                  {peContacts.slice(0, 5).map((contact, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{contact.name}</span>
                      <span className="text-muted-foreground"> - {contact.title}</span>
                      {contact.organization && (
                        <span className="text-muted-foreground block text-xs">{contact.organization}</span>
                      )}
                    </li>
                  ))}
                  {peContacts.length > 5 && (
                    <li className="text-sm text-muted-foreground">+ {peContacts.length - 5} more</li>
                  )}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground italic">No PE contacts found</p>
              )}
            </div>
          </div>

          {/* Available Partners */}
          {availablePartners.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
                Available Partners
              </h4>
              <ul className="space-y-2">
                {availablePartners.slice(0, 3).map((partner, i) => (
                  <li key={i} className="text-sm flex items-center gap-2">
                    <span className="font-medium">{partner.name}</span>
                    <span className="text-muted-foreground">({partner.role})</span>
                    <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                      {partner.availabilityNext30}% available
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggested Approach */}
          {contactRecommendations.length > 0 && (
            <div className="mb-6">
              <h4 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
                Suggested Approach
              </h4>
              <div className="space-y-2">
                {contactRecommendations.slice(0, 2).map((rec, i) => (
                  <div key={i} className="text-sm p-2 bg-card rounded border">
                    <span className="font-medium">{rec.contact.name}</span>
                    <span className="text-muted-foreground"> ({rec.contact.title})</span>
                    <p className="text-muted-foreground mt-1">{rec.justification}</p>
                    {rec.conversationOpener && (
                      <p className="mt-2 text-xs italic border-l-2 border-primary pl-2">
                        "{rec.conversationOpener}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* HubSpot link if pushed */}
          {signal.hubspotDealId && (
            <div className="mb-4">
              <a
                href={`https://app.hubspot.com/contacts/record/0-3/${signal.hubspotDealId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                View in HubSpot
              </a>
            </div>
          )}

          {/* Action Buttons - Placeholder for Task 11 */}
          <div className="flex gap-3 pt-4 border-t">
            <button
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              disabled={signal.status === 'pushed' || signal.status === 'archived'}
            >
              Push to HubSpot
            </button>
            <button
              className="px-4 py-2 border border-input bg-background rounded-md text-sm font-medium hover:bg-muted disabled:opacity-50"
              disabled={signal.status === 'archived'}
            >
              Archive
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SignalsPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['signals'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/signals?limit=50`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const signals = data?.data as Signal[] | undefined;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Signals</h2>
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : !signals || signals.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No signals detected yet</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {signals.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              isExpanded={expandedId === signal.id}
              onToggle={() => toggleExpand(signal.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HypothesesPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Hypotheses</h2>
      <div className="rounded-lg border bg-card p-8 text-center">
        <Lightbulb className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Hypothesis generation coming soon</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/signals" element={<SignalsPage />} />
        <Route path="/hypotheses" element={<HypothesesPage />} />
      </Routes>
    </Layout>
  );
}

export default App;
