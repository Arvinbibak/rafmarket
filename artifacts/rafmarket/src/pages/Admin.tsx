import { useGetAdminStats, useListAllOrders, getGetAdminStatsQueryKey, getListAllOrdersQueryKey } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Users, Package, ShoppingBag, Coins } from 'lucide-react';
import { format } from 'date-fns';

export default function Admin() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [commissionPercent, setCommissionPercent] = useState('5');
  const [commissionLoading, setCommissionLoading] = useState(true);
  const [commissionSaving, setCommissionSaving] = useState(false);
  const [commissionMessage, setCommissionMessage] = useState('');
  const [disputedPackages, setDisputedPackages] = useState<any[]>([]);
  const [disputesLoading, setDisputesLoading] = useState(true);
  const [disputeActionId, setDisputeActionId] = useState<number | null>(null);
  const [disputeMessage, setDisputeMessage] = useState('');

  const { data: stats, isLoading: isStatsLoading } = useGetAdminStats({
    query: { queryKey: getGetAdminStatsQueryKey(), enabled: user?.role === 'admin' }
  });

  const { data: ordersData, isLoading: isOrdersLoading } = useListAllOrders({ page: 1 }, {
    query: { queryKey: getListAllOrdersQueryKey({ page: 1 }), enabled: user?.role === 'admin' }
  });

  useEffect(() => {
    if (!isAuthLoading && (!user || user.role !== 'admin')) {
      setLocation('/');
    }
  }, [user, isAuthLoading, setLocation]);

  useEffect(() => {
    if (user?.role !== 'admin') return;

    const token = localStorage.getItem('raf_token');
    if (!token) {
      setCommissionMessage('Admin session not found. Please sign in again.');
      setCommissionLoading(false);
      return;
    }

    fetch('/api/admin/commission', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load commission settings.');
        return response.json();
      })
      .then((data: { commissionPercent: number }) => {
        setCommissionPercent(String(data.commissionPercent));
      })
      .catch((error: Error) => setCommissionMessage(error.message))
      .finally(() => setCommissionLoading(false));
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const token = localStorage.getItem('raf_token');
    if (!token) {
      setDisputesLoading(false);
      return;
    }

    fetch('/api/admin/seller-orders?status=disputed', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load disputes.');
        return response.json();
      })
      .then((data) => setDisputedPackages(data))
      .catch((error: Error) => setDisputeMessage(error.message))
      .finally(() => setDisputesLoading(false));
  }, [user?.role]);

  const resolveDispute = async (id: number, resolution: 'release_to_seller' | 'refund_to_buyer') => {
    const token = localStorage.getItem('raf_token');
    if (!token) {
      setDisputeMessage('Admin session not found. Please sign in again.');
      return;
    }

    setDisputeActionId(id);
    setDisputeMessage('');
    try {
      const response = await fetch(`/api/admin/seller-orders/${id}/dispute`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ resolution }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not resolve dispute.');
      setDisputedPackages((current) => current.filter((item) => item.id !== id));
      setDisputeMessage(data.message || 'Decision recorded.');
    } catch (error) {
      setDisputeMessage(error instanceof Error ? error.message : 'Could not resolve dispute.');
    } finally {
      setDisputeActionId(null);
    }
  };

  const saveCommission = async () => {
    const value = Number(commissionPercent);
    if (!Number.isFinite(value) || value < 0 || value > 30) {
      setCommissionMessage('Enter a commission between 0 and 30 percent.');
      return;
    }

    const token = localStorage.getItem('raf_token');
    if (!token) {
      setCommissionMessage('Admin session not found. Please sign in again.');
      return;
    }

    setCommissionSaving(true);
    setCommissionMessage('');
    try {
      const response = await fetch('/api/admin/commission', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ commissionPercent: value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save commission.');
      setCommissionPercent(String(data.commissionPercent));
      setCommissionMessage('Commission setting saved.');
    } catch (error) {
      setCommissionMessage(error instanceof Error ? error.message : 'Could not save commission.');
    } finally {
      setCommissionSaving(false);
    }
  };

  if (isAuthLoading || isStatsLoading) {
    return <div className="container mx-auto px-4 py-12">Loading admin dashboard...</div>;
  }

  if (!stats) return null;

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-medium tracking-tight mb-8">Admin Dashboard</h1>

      <section className="bg-card border border-border p-6 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:justify-between">
          <div>
            <h2 className="text-lg font-medium tracking-tight mb-2">Marketplace Commission</h2>
            <p className="text-sm text-muted-foreground">
              Default commission for new orders. Allowed range: 0% to 30%.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="commission-percent" className="text-sm font-medium">Commission</label>
            <div className="flex items-center gap-2">
              <input
                id="commission-percent"
                type="number"
                min="0"
                max="30"
                step="0.1"
                value={commissionPercent}
                onChange={(event) => setCommissionPercent(event.target.value)}
                disabled={commissionLoading || commissionSaving}
                className="w-24 rounded-md border border-border bg-background px-3 py-2 text-right font-mono"
              />
              <span className="text-muted-foreground">%</span>
            </div>
            <button
              type="button"
              onClick={saveCommission}
              disabled={commissionLoading || commissionSaving}
              className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
            >
              {commissionSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        {commissionMessage && (
          <p className="mt-3 text-sm text-muted-foreground" role="status">{commissionMessage}</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Example: on a 100 Pi sale, a 5% commission is 5 Pi and the seller share is 95 Pi.
        </p>
      </section>

      <section className="bg-card border border-border p-6 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div>
            <h2 className="text-lg font-medium tracking-tight">Dispute Review</h2>
            <p className="text-sm text-muted-foreground">Review buyer complaints for individual seller packages.</p>
          </div>
          <span className="text-sm font-mono">{disputedPackages.length} open</span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Important: these buttons record an administrative decision only. They do not transfer Pi or issue a refund; payment settlement is a later stage.
        </p>
        {disputeMessage && <p className="text-sm text-muted-foreground mb-3" role="status">{disputeMessage}</p>}
        {disputesLoading ? (
          <p className="text-sm text-muted-foreground">Loading disputes...</p>
        ) : disputedPackages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open disputes.</p>
        ) : (
          <div className="space-y-4">
            {disputedPackages.map((item) => (
              <div key={item.id} className="border border-border p-4">
                <div className="flex flex-wrap justify-between gap-2 mb-2">
                  <p className="font-medium">Package #{item.id} · Order #{item.orderId}</p>
                  <p className="font-mono text-sm">{item.subtotal} {item.currency === 'Pi' ? 'π' : item.currency}</p>
                </div>
                <p className="text-sm text-muted-foreground mb-1">Buyer: @{item.buyerUsername || 'unknown'} · Seller: @{item.sellerUsername || 'unknown'}</p>
                <p className="text-sm whitespace-pre-wrap mb-4">{item.disputeReason}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => resolveDispute(item.id, 'release_to_seller')}
                    disabled={disputeActionId === item.id}
                    className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                  >
                    Release decision
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveDispute(item.id, 'refund_to_buyer')}
                    disabled={disputeActionId === item.id}
                    className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
                  >
                    Refund decision
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Top Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <div className="bg-card border border-border p-6 flex items-start gap-4">
          <div className="p-3 bg-primary/10 text-primary">
            <Coins className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Total Revenue</p>
            <p className="text-2xl font-mono font-bold text-foreground">{stats.totalRevenue.toLocaleString()} π</p>
          </div>
        </div>
        <div className="bg-card border border-border p-6 flex items-start gap-4">
          <div className="p-3 bg-blue-500/10 text-blue-600">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Total Orders</p>
            <p className="text-2xl font-mono font-bold text-foreground">{stats.totalOrders.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-card border border-border p-6 flex items-start gap-4">
          <div className="p-3 bg-green-500/10 text-green-600">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Active Products</p>
            <p className="text-2xl font-mono font-bold text-foreground">{stats.activeProducts.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-card border border-border p-6 flex items-start gap-4">
          <div className="p-3 bg-purple-500/10 text-purple-600">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Total Users</p>
            <p className="text-2xl font-mono font-bold text-foreground">{stats.totalUsers.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 bg-card border border-border p-6">
          <h2 className="text-lg font-medium tracking-tight mb-6">Revenue Overview (Last 30 Days)</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.revenueByDay}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="date" 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(val) => format(new Date(val), 'MMM d')}
                />
                <YAxis 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(val) => `${val} π`}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '0' }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                  formatter={(value: number) => [`${value} π`, 'Revenue']}
                  labelFormatter={(label) => format(new Date(label), 'MMMM d, yyyy')}
                />
                <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Orders by Status */}
        <div className="bg-card border border-border p-6">
          <h2 className="text-lg font-medium tracking-tight mb-6">Orders by Status</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.ordersByStatus} layout="vertical" margin={{ top: 0, right: 0, left: 30, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis type="category" dataKey="status" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'hsl(var(--foreground))' }} />
                <Tooltip 
                  cursor={{ fill: 'hsl(var(--muted))' }}
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '0' }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-card border border-border">
        <div className="p-6 border-b border-border flex justify-between items-center bg-muted/20">
          <h2 className="text-lg font-medium tracking-tight">Recent Orders</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
              <tr>
                <th className="px-6 py-4 font-medium">Order ID</th>
                <th className="px-6 py-4 font-medium">Date</th>
                <th className="px-6 py-4 font-medium">Buyer</th>
                <th className="px-6 py-4 font-medium">Total</th>
                <th className="px-6 py-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.recentOrders?.map((order) => (
                <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4 font-mono font-medium">#{order.id.toString().padStart(6, '0')}</td>
                  <td className="px-6 py-4">{format(new Date(order.createdAt), 'MMM d, yyyy')}</td>
                  <td className="px-6 py-4">@{order.buyerUsername}</td>
                  <td className="px-6 py-4 font-mono font-bold text-primary">{order.total} π</td>
                  <td className="px-6 py-4 uppercase text-xs font-medium tracking-wider">{order.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
