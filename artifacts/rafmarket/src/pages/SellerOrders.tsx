import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';

type SellerOrderItem = {
  productId: number;
  productName: string;
  price: number;
  quantity: number;
};

type SellerOrder = {
  id: number;
  orderId: number;
  items: SellerOrderItem[];
  subtotal: number;
  commissionPercent: number;
  commissionAmount: number;
  sellerAmount: number;
  currency: string;
  status: string;
  trackingNumber?: string | null;
  shippingCarrier?: string | null;
  buyerUsername?: string | null;
  shippingAddress?: string | null;
  disputeReason?: string | null;
};

export default function SellerOrders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [shipping, setShipping] = useState<Record<number, { trackingNumber: string; shippingCarrier: string }>>({});

  const loadOrders = useCallback(async () => {
    const token = localStorage.getItem('raf_token');
    if (!token) {
      setError('Please sign in with Pi to view your sales.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/seller/orders', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load seller orders.');
      setOrders(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load seller orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadOrders();
    else setLoading(false);
  }, [user, loadOrders]);

  const updateShipping = (id: number, field: 'trackingNumber' | 'shippingCarrier', value: string) => {
    setShipping((current) => ({
      ...current,
      [id]: {
        trackingNumber: current[id]?.trackingNumber ?? '',
        shippingCarrier: current[id]?.shippingCarrier ?? '',
        [field]: value,
      },
    }));
  };

  const markShipped = async (order: SellerOrder) => {
    const token = localStorage.getItem('raf_token');
    const details = shipping[order.id] ?? { trackingNumber: '', shippingCarrier: '' };
    if (!token || !details.trackingNumber.trim()) {
      setError('Enter a tracking number before marking the package as shipped.');
      return;
    }

    setSavingId(order.id);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/seller/orders/${order.id}/ship`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(details),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update shipment.');
      setMessage(`Package #${order.id} marked as shipped.`);
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update shipment.');
    } finally {
      setSavingId(null);
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-medium mb-4">Sign in to manage sales</h1>
        <Link href="/auth" className="text-primary hover:underline">Connect with Pi</Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <h1 className="text-3xl font-medium tracking-tight mb-2">Seller Orders</h1>
      <p className="text-sm text-muted-foreground mb-8">Manage shipping for packages assigned to your account.</p>

      {error && <p className="mb-4 rounded-md border border-destructive/30 p-3 text-sm text-destructive" role="alert">{error}</p>}
      {message && <p className="mb-4 rounded-md border border-border p-3 text-sm" role="status">{message}</p>}

      {loading ? (
        <p className="text-muted-foreground">Loading seller orders...</p>
      ) : orders.length === 0 ? (
        <div className="border border-border bg-card p-8 text-center">
          <p className="font-medium mb-2">No seller packages yet</p>
          <p className="text-sm text-muted-foreground">When a customer buys one of your products, the package will appear here.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => (
            <section key={order.id} className="border border-border bg-card p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-lg font-medium">Package #{order.id}</h2>
                  <p className="text-sm text-muted-foreground">Order #{order.orderId} · Buyer @{order.buyerUsername || 'unknown'}</p>
                </div>
                <span className="rounded border border-border px-3 py-1 text-xs font-medium uppercase">{order.status}</span>
              </div>

              <div className="space-y-2 mb-5">
                {order.items.map((item) => (
                  <div key={item.productId} className="flex justify-between gap-3 text-sm">
                    <span>{item.productName} × {item.quantity}</span>
                    <span className="font-mono">{(item.price * item.quantity).toFixed(6)} {order.currency === 'Pi' ? 'π' : order.currency}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-y border-border py-4 mb-5 text-sm">
                <div><p className="text-muted-foreground">Package subtotal</p><p className="font-mono font-medium">{order.subtotal} {order.currency === 'Pi' ? 'π' : order.currency}</p></div>
                <div><p className="text-muted-foreground">Marketplace fee ({order.commissionPercent}%)</p><p className="font-mono">{order.commissionAmount} {order.currency === 'Pi' ? 'π' : order.currency}</p></div>
                <div><p className="text-muted-foreground">Seller share (not yet paid)</p><p className="font-mono font-bold">{order.sellerAmount} {order.currency === 'Pi' ? 'π' : order.currency}</p></div>
              </div>

              <div className="mb-5">
                <p className="text-sm font-medium mb-1">Delivery address</p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.shippingAddress || 'No address provided'}</p>
              </div>

              {order.status === 'paid' || order.status === 'processing' ? (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3">
                  <input
                    value={shipping[order.id]?.trackingNumber ?? ''}
                    onChange={(event) => updateShipping(order.id, 'trackingNumber', event.target.value)}
                    placeholder="Tracking number"
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                  <input
                    value={shipping[order.id]?.shippingCarrier ?? ''}
                    onChange={(event) => updateShipping(order.id, 'shippingCarrier', event.target.value)}
                    placeholder="Carrier (optional)"
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => markShipped(order)}
                    disabled={savingId === order.id}
                    className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                  >
                    {savingId === order.id ? 'Saving...' : 'Mark as shipped'}
                  </button>
                </div>
              ) : order.trackingNumber ? (
                <p className="text-sm text-muted-foreground">Tracking: {order.shippingCarrier ? `${order.shippingCarrier} · ` : ''}{order.trackingNumber}</p>
              ) : null}

              {order.status === 'disputed' && (
                <p className="mt-4 rounded-md border border-destructive/30 p-3 text-sm">
                  Dispute opened: {order.disputeReason}
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
