import { useState } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Users, Zap, Lightbulb, LayoutDashboard, ChevronDown, ChevronUp, MapPin, Briefcase, User, ExternalLink, X, CheckCircle, LogOut, Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';

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

// Push result type from API
interface PushResult {
  success: boolean;
  hubspot: {
    dealId: string;
    dealUrl: string;
    companiesCreated: number;
    companyContactsCreated: number;
    peContactsCreated: number;
  };
}

// Archive reason options
const archiveReasons = [
  { value: 'not_relevant', label: 'Not relevant to our practice' },
  { value: 'already_have_relationship', label: 'Already have relationship' },
  { value: 'company_too_small', label: 'Company too small' },
  { value: 'not_pe_backed', label: 'Not PE-backed' },
  { value: 'other', label: 'Other' },
];

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
  const { user, logout } = useAuth();

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
            {user && (
              <>
                <div className="w-px h-6 bg-border mx-2" />
                <span className="text-sm text-muted-foreground">{user.email}</span>
                <button
                  onClick={logout}
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Logout"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}

/**
 * Protected route component - redirects to login if not authenticated
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
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
        <Link to="/accounts" className="rounded-lg border bg-card p-6 hover:bg-muted/50 transition-colors block">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Building2 className="h-4 w-4" />
            <span className="text-sm">Accounts</span>
          </div>
          <p className="text-3xl font-bold">{accounts?.pagination?.total ?? '-'}</p>
        </Link>
        <Link to="/contacts" className="rounded-lg border bg-card p-6 hover:bg-muted/50 transition-colors block">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Users className="h-4 w-4" />
            <span className="text-sm">Contacts</span>
          </div>
          <p className="text-3xl font-bold">{contacts?.pagination?.total ?? '-'}</p>
        </Link>
        <Link to="/signals" className="rounded-lg border bg-card p-6 hover:bg-muted/50 transition-colors block">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Zap className="h-4 w-4" />
            <span className="text-sm">Signals</span>
          </div>
          <p className="text-3xl font-bold">{signals?.pagination?.total ?? '-'}</p>
        </Link>
        <Link to="/hypotheses?status=pending_review" className="rounded-lg border bg-card p-6 hover:bg-muted/50 transition-colors block">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Lightbulb className="h-4 w-4" />
            <span className="text-sm">Pending Review</span>
          </div>
          <p className="text-3xl font-bold">{hypothesesQueue?.pagination?.total ?? '-'}</p>
        </Link>
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

// PushSuccessModal Component - Shows success after pushing to HubSpot
function PushSuccessModal({
  result,
  signalSummary,
  onClose
}: {
  result: PushResult;
  signalSummary: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border rounded-lg shadow-lg w-full max-w-md p-6 m-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle className="h-6 w-6" />
            <h3 className="text-lg font-semibold">Pushed to HubSpot</h3>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Created objects summary */}
        <div className="space-y-2 mb-6">
          <p className="text-sm text-muted-foreground mb-3">Created:</p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <span className="text-green-600">*</span>
              <span>1 Deal: "{signalSummary}"</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-600">*</span>
              <span>{result.hubspot.companiesCreated} {result.hubspot.companiesCreated === 1 ? 'Company' : 'Companies'}</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-600">*</span>
              <span>{result.hubspot.companyContactsCreated} Company contact{result.hubspot.companyContactsCreated !== 1 ? 's' : ''} (buyers)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-600">*</span>
              <span>{result.hubspot.peContactsCreated} PE contact{result.hubspot.peContactsCreated !== 1 ? 's' : ''} (influencers)</span>
            </li>
          </ul>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 justify-end">
          <a
            href={result.hubspot.dealUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 inline-flex items-center gap-1"
          >
            <ExternalLink className="h-4 w-4" />
            View in HubSpot
          </a>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-input bg-background rounded-md text-sm font-medium hover:bg-muted"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ArchiveModal Component - Confirmation dialog with reason selection
function ArchiveModal({
  signalSummary,
  onConfirm,
  onCancel,
  isPending
}: {
  signalSummary: string;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [selectedReason, setSelectedReason] = useState<string>('');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border rounded-lg shadow-lg w-full max-w-md p-6 m-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Archive this signal?</h3>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground"
            disabled={isPending}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Signal summary */}
        <p className="text-sm text-muted-foreground mb-4">
          {signalSummary}
        </p>

        {/* Reason dropdown */}
        <div className="mb-6">
          <label htmlFor="archive-reason" className="block text-sm font-medium mb-2">
            Reason (optional):
          </label>
          <select
            id="archive-reason"
            value={selectedReason}
            onChange={(e) => setSelectedReason(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isPending}
          >
            <option value="">Select reason...</option>
            {archiveReasons.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-input bg-background rounded-md text-sm font-medium hover:bg-muted"
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selectedReason || undefined)}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:bg-destructive/90 disabled:opacity-50"
            disabled={isPending}
          >
            {isPending ? 'Archiving...' : 'Archive'}
          </button>
        </div>
      </div>
    </div>
  );
}

// SignalCard Component - Expandable card for displaying signal details
function SignalCard({ signal, isExpanded, onToggle, onPush, onArchive, isPushPending }: {
  signal: Signal;
  isExpanded: boolean;
  onToggle: () => void;
  onPush: () => void;
  onArchive: () => void;
  isPushPending: boolean;
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
                    <li key={i} className="text-sm p-2 bg-muted/50 rounded">
                      <div>
                        <span className="font-medium">{contact.name}</span>
                        {contact.title && <span className="text-muted-foreground"> - {contact.title}</span>}
                      </div>
                      {contact.email && (
                        <a
                          href={`mailto:${contact.email}`}
                          className="text-xs text-primary hover:underline mt-1 block"
                        >
                          {contact.email}
                        </a>
                      )}
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
                    <li key={i} className="text-sm p-2 bg-muted/50 rounded">
                      <div>
                        <span className="font-medium">{contact.name}</span>
                        <span className="text-muted-foreground"> - {contact.title}</span>
                      </div>
                      {contact.organization && (
                        <span className="text-muted-foreground text-xs">{contact.organization}</span>
                      )}
                      <div className="flex gap-3 mt-1">
                        {contact.email && (
                          <a
                            href={`mailto:${contact.email}`}
                            className="text-xs text-primary hover:underline"
                          >
                            {contact.email}
                          </a>
                        )}
                        {contact.linkedIn && (
                          <a
                            href={contact.linkedIn}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline"
                          >
                            LinkedIn
                          </a>
                        )}
                      </div>
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
                {availablePartners.slice(0, 5).map((partner, i) => (
                  <li key={i} className="text-sm p-2 bg-card rounded border">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{partner.name}</span>
                      <span className="text-muted-foreground">({partner.role})</span>
                      <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                        {partner.availabilityNext30}% available
                      </span>
                    </div>
                    {partner.email && (
                      <a
                        href={`mailto:${partner.email}`}
                        className="text-xs text-primary hover:underline mt-1 block"
                      >
                        {partner.email}
                      </a>
                    )}
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

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t">
            <button
              onClick={onPush}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              disabled={signal.status === 'pushed' || signal.status === 'archived' || isPushPending}
            >
              {isPushPending ? 'Pushing...' : 'Push to HubSpot'}
            </button>
            <button
              onClick={onArchive}
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
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ready');
  const [sourceFilter, setSourceFilter] = useState<string>('');

  // Modal state
  const [pushResult, setPushResult] = useState<{ result: PushResult; signalSummary: string } | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState<{ signalId: string; signalSummary: string } | null>(null);

  // Push mutation
  const pushMutation = useMutation({
    mutationFn: async (signalId: string) => {
      const res = await fetch(`${API_URL}/api/v1/signals/${signalId}/push`, {
        method: 'POST',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to push to HubSpot');
      }
      return res.json() as Promise<PushResult>;
    },
    onSuccess: (data, signalId) => {
      // Find the signal to get its summary for the modal
      const signal = signals?.find(s => s.id === signalId);
      const payload = signal?.rawPayload;
      const companyName = payload?.companyName || payload?.company || 'Unknown Company';
      const jobTitle = payload?.jobTitle || signal?.summary || 'Unknown Position';
      const signalSummary = `${jobTitle} at ${companyName}`;

      setPushResult({ result: data, signalSummary });
      // Invalidate all signals queries to refresh data and counts
      queryClient.invalidateQueries({ queryKey: ['signals'] });
    },
  });

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: async ({ signalId, reason }: { signalId: string; reason?: string }) => {
      const res = await fetch(`${API_URL}/api/v1/signals/${signalId}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to archive signal');
      }
      return res.json();
    },
    onSuccess: () => {
      setShowArchiveModal(null);
      // Invalidate all signals queries to refresh data and counts
      queryClient.invalidateQueries({ queryKey: ['signals'] });
    },
  });

  // Fetch signals with filters
  const { data, isLoading } = useQuery({
    queryKey: ['signals', statusFilter, sourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (statusFilter) params.set('status', statusFilter);
      if (sourceFilter) params.set('source', sourceFilter);

      const res = await fetch(`${API_URL}/api/v1/signals?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Fetch counts for each status (separate queries for tab badges)
  const { data: readyData } = useQuery({
    queryKey: ['signals', 'count', 'ready'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/signals?status=ready&limit=1`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const { data: pushedData } = useQuery({
    queryKey: ['signals', 'count', 'pushed'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/signals?status=pushed&limit=1`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const { data: failedData } = useQuery({
    queryKey: ['signals', 'count', 'push_failed'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/signals?status=push_failed&limit=1`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const { data: archivedData } = useQuery({
    queryKey: ['signals', 'count', 'archived'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/signals?status=archived&limit=1`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Status tabs configuration
  const statusTabs = [
    { value: 'ready', label: 'Ready', count: readyData?.pagination?.total ?? 0 },
    { value: 'pushed', label: 'Pushed', count: pushedData?.pagination?.total ?? 0 },
    { value: 'push_failed', label: 'Failed', count: failedData?.pagination?.total ?? 0 },
    { value: 'archived', label: 'Archived', count: archivedData?.pagination?.total ?? 0 },
  ];

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const signals = data?.data as Signal[] | undefined;

  // Helper to get signal summary for modals
  const getSignalSummary = (signal: Signal) => {
    const payload = signal.rawPayload;
    const companyName = payload?.companyName || payload?.company || 'Unknown Company';
    const jobTitle = payload?.jobTitle || signal.summary || 'Unknown Position';
    return `${jobTitle} at ${companyName}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Signals</h2>

        {/* Source filter dropdown */}
        <div className="flex items-center gap-2">
          <label htmlFor="source-filter" className="text-sm text-muted-foreground">Source:</label>
          <select
            id="source-filter"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-3 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All sources</option>
            <option value="lead5">Lead5</option>
          </select>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex border-b mb-6">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              statusFilter === tab.value
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50'
            }`}
          >
            {tab.label}
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
              statusFilter === tab.value
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : !signals || signals.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            {statusFilter
              ? `No ${statusLabels[statusFilter]?.toLowerCase() || statusFilter} signals`
              : 'No signals detected yet'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {signals.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              isExpanded={expandedId === signal.id}
              onToggle={() => toggleExpand(signal.id)}
              onPush={() => pushMutation.mutate(signal.id)}
              onArchive={() => setShowArchiveModal({
                signalId: signal.id,
                signalSummary: getSignalSummary(signal)
              })}
              isPushPending={pushMutation.isPending && pushMutation.variables === signal.id}
            />
          ))}
        </div>
      )}

      {/* Push Success Modal */}
      {pushResult && (
        <PushSuccessModal
          result={pushResult.result}
          signalSummary={pushResult.signalSummary}
          onClose={() => setPushResult(null)}
        />
      )}

      {/* Archive Modal */}
      {showArchiveModal && (
        <ArchiveModal
          signalSummary={showArchiveModal.signalSummary}
          onConfirm={(reason) => archiveMutation.mutate({
            signalId: showArchiveModal.signalId,
            reason
          })}
          onCancel={() => setShowArchiveModal(null)}
          isPending={archiveMutation.isPending}
        />
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

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/contacts" element={<ContactsPage />} />
                <Route path="/signals" element={<SignalsPage />} />
                <Route path="/hypotheses" element={<HypothesesPage />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
