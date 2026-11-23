import { useParams } from 'wouter';
import { useGetOrder, getGetOrderQueryKey } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Package, MapPin, CreditCard } from 'lucide-react';
import { format } from 'date-fns';

export default function OrderDetail() {
  const params = useParams();
  const id = params?.id;
  const queryClient = useQueryClient();
  const [packageBusy, setPackageBusy] = useState<Record<number, boolean>>({});
  const [disputeReasons, setDisputeReasons] = useState<Record<number, string>>({});
  const [packageMessage, setPackageMessage] = useState('');

  const { data: order, isLoading } = useGetOrder(id || '', {
    query: { queryKey: getGetOrderQueryKey(id || ''), enabled: !!id }
  });

  const packageAction = async (sellerOrderId: number, action: 'confirm-delivery' | 'dispute') => {
    const token = localStorage.getItem('raf_token');
    if (!token) {
      setPackageMessage('Please sign in again to manage this package.');
      return;
    }

    const reason = disputeReasons[sellerOrderId]?.trim() ?? '';
    if (action === 'dispute' && reason.length < 10) {
      setPackageMessage('Please explain the problem in at least 10 characters.');
      return;
    }

    setPackageBusy((current) => ({ ...current, [sellerOrderId]: true }));
    setPackageMessage('');
    try {
      const response = await fetch(`/api/seller-orders/${sellerOrderId}/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(action === 'dispute' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(action === 'dispute' ? { body: JSON.stringify({ reason }) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update package.');
      setPackageMessage(data.message || 'Package updated.');
      await queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(id || '') });
    } catch (error) {
      setPackageMessage(error instanceof Error ? error.message : 'Could not update package.');
    } finally {
      setPackageBusy((current) => ({ ...current, [sellerOrderId]: false }));
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-4xl space-y-8">
        <div className="h-8 bg-muted w-32 animate-pulse mb-8" />
        <div className="h-48 bg-muted w-full animate-pulse border border-border" />
        <div className="h-64 bg-muted w-full animate-pulse border border-border" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-medium mb-4">Order not found</h1>
        <Link href="/orders" className="text-primary hover:underline">Back to orders</Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <Link href="/orders" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ChevronLeft className="w-4 h-4 mr-1" /> Back to Orders
      </Link>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-medium tracking-tight mb-2">
            Order #{order.id.toString().padStart(6, '0')}
          </h1>
          <p className="text-muted-foreground">
            Placed on {format(new Date(order.createdAt), 'MMMM d, yyyy')}
          </p>
        </div>
        <div className="px-4 py-2 bg-muted text-foreground font-medium uppercase tracking-wider text-sm border border-border">
          Status: <span className="text-primary ml-1">{order.status}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
        <div className="bg-card border border-border p-6">
          <div className="flex items-center gap-3 mb-4 text-muted-foreground">
            <MapPin className="w-5 h-5" />
            <h3 className="font-medium text-foreground">Shipping Address</h3>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {order.shippingAddress || 'No shipping address provided.'}
          </p>
        </div>

        <div className="bg-card border border-border p-6">
          <div className="flex items-center gap-3 mb-4 text-muted-foreground">
            <CreditCard className="w-5 h-5" />
            <h3 className="font-medium text-foreground">Payment Method</h3>
          </div>
          <p className="text-sm font-medium mb-1">Pi Network</p>
          {order.piTxid ? (
            <p className="text-xs font-mono text-muted-foreground break-all bg-muted p-2 mt-2">
              TX: {order.piTxid}
            </p>
          ) : (
            <p className="text-sm text-yellow-600">Pending payment</p>
          )}
        </div>

        <div className="bg-card border border-border p-6 bg-primary/5 border-primary/20">
          <div className="flex items-center gap-3 mb-4 text-primary">
            <Package className="w-5 h-5" />
            <h3 className="font-medium text-foreground">Order Summary</h3>
          </div>
          <div className="space-y-2 text-sm mb-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items Total</span>
              <span className="font-mono">{order.total} π</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shipping</span>
              <span className="font-mono">0 π</span>
            </div>
          </div>
          <div className="border-t pt-4 flex justify-between font-medium text-lg">
            <span>Total</span>
            <span className="font-mono text-primary font-bold">{order.total} π</span>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border mb-8">
        <div className="p-6 border-b border-border bg-muted/20">
          <h2 className="text-xl font-medium tracking-tight">Seller Packages</h2>
          <p className="text-sm text-muted-foreground mt-1">Each seller's items and amount are tracked separately.</p>
          <p className="text-xs text-muted-foreground mt-1">Confirming delivery only records receipt; it does not send a seller payout.</p>
        </div>
        {packageMessage && <p className="px-6 pt-4 text-sm text-muted-foreground" role="status">{packageMessage}</p>}
        {order.sellerOrders && order.sellerOrders.length > 0 ? (
          <div className="divide-y divide-border">
            {order.sellerOrders.map((sellerOrder) => (
              <div key={sellerOrder.id} className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {sellerOrder.sellerUsername ? `@${sellerOrder.sellerUsername}` : `Seller #${sellerOrder.sellerId}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {sellerOrder.items.length} item(s) · Package #{sellerOrder.id}
                    </p>
                    {sellerOrder.trackingNumber && (
                      <p className="text-sm text-muted-foreground mt-1">
                        Tracking: {sellerOrder.shippingCarrier ? `${sellerOrder.shippingCarrier} · ` : ''}{sellerOrder.trackingNumber}
                      </p>
                    )}
                    {sellerOrder.disputeResolution && (
                      <p className="text-xs text-muted-foreground mt-1">Admin decision: {sellerOrder.disputeResolution.replaceAll('_', ' ')}</p>
                    )}
                  </div>
                  <div className="sm:text-right">
                    <p className="font-mono font-bold">{sellerOrder.subtotal} {sellerOrder.currency === 'Pi' ? 'π' : sellerOrder.currency}</p>
                    <p className="text-xs text-muted-foreground uppercase">{sellerOrder.status}</p>
                  </div>
                </div>

                {sellerOrder.status === 'shipped' && (
                  <button
                    type="button"
                    onClick={() => packageAction(sellerOrder.id, 'confirm-delivery')}
                    disabled={!!packageBusy[sellerOrder.id]}
                    className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                  >
                    {packageBusy[sellerOrder.id] ? 'Saving...' : 'Confirm delivery'}
                  </button>
                )}

                {['paid', 'processing', 'shipped', 'delivered'].includes(sellerOrder.status) && (
                  <div className="mt-4 space-y-2">
                    <textarea
                      value={disputeReasons[sellerOrder.id] ?? ''}
                      onChange={(event) => setDisputeReasons((current) => ({ ...current, [sellerOrder.id]: event.target.value }))}
                      rows={2}
                      maxLength={2000}
                      placeholder="Describe a problem with this package (at least 10 characters)..."
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => packageAction(sellerOrder.id, 'dispute')}
                      disabled={!!packageBusy[sellerOrder.id]}
                      className="rounded-md border border-destructive/40 px-4 py-2 text-sm text-destructive disabled:opacity-50"
                    >
                      Open a dispute
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Seller breakdown is not available for this older order.</p>
        )}
      </div>

      <div className="bg-card border border-border">
        <div className="p-6 border-b border-border bg-muted/20">
          <h2 className="text-xl font-medium tracking-tight">Order Items</h2>
        </div>
        <div className="divide-y divide-border">
          {order.items.map((item, idx) => (
            <div key={idx} className="p-6 flex flex-col sm:flex-row gap-6">
              <div className="w-20 h-20 bg-muted shrink-0">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No img</div>
                )}
              </div>
              <div className="flex-1 flex flex-col justify-center">
                <Link href={`/products/${item.productId}`} className="font-medium text-lg hover:text-primary transition-colors mb-1">
                  {item.productName}
                </Link>
                <p className="text-sm text-muted-foreground">Qty: {item.quantity}</p>
              </div>
              <div className="flex items-center">
                <span className="font-mono font-bold">{item.price * item.quantity} π</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
