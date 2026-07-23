import { useRoute, useParams } from 'wouter';
import { useGetOrder } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { ChevronLeft, Package, MapPin, CreditCard } from 'lucide-react';
import { format } from 'date-fns';

export default function OrderDetail() {
  const params = useParams();
  const id = params?.id;
  
  const { data: order, isLoading } = useGetOrder(id || '', {
    query: { enabled: !!id }
  });

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
