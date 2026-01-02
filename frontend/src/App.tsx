import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, Users, Zap, Lightbulb, LayoutDashboard } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8004';

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

function SignalsPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Signals</h2>
      <div className="rounded-lg border bg-card p-8 text-center">
        <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Signal detection coming soon</p>
      </div>
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
