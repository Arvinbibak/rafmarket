import { useGetAdminStats, useListAllOrders } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import { useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Users, Package, ShoppingBag, Coins } from 'lucide-react';
import { format } from 'date-fns';

export default function Admin() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [, setLocation] = useLocation();

  const { data: stats, isLoading: isStatsLoading } = useGetAdminStats({
    query: { enabled: user?.role === 'admin' }
  });

  const { data: ordersData, isLoading: isOrdersLoading } = useListAllOrders({ page: 1 }, {
    query: { enabled: user?.role === 'admin' }
  });

  useEffect(() => {
    if (!isAuthLoading && (!user || user.role !== 'admin')) {
      setLocation('/');
    }
  }, [user, isAuthLoading, setLocation]);

  if (isAuthLoading || isStatsLoading) {
    return <div className="container mx-auto px-4 py-12">Loading admin dashboard...</div>;
  }

  if (!stats) return null;

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-medium tracking-tight mb-8">Admin Dashboard</h1>

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
                <YAxis type="category" dataKey="status" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'hsl(var(--foreground))', textTransform: 'capitalize' }} />
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
