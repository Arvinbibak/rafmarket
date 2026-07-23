import { useListOrders } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Package, ArrowRight, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

const StatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, { bg: string, text: string, icon: React.ElementType }> = {
    pending: { bg: 'bg-yellow-500/10', text: 'text-yellow-600', icon: Clock },
    paid: { bg: 'bg-primary/10', text: 'text-primary', icon: CheckCircle2 },
    processing: { bg: 'bg-blue-500/10', text: 'text-blue-600', icon: Package },
    shipped: { bg: 'bg-indigo-500/10', text: 'text-indigo-600', icon: Package },
    delivered: { bg: 'bg-green-500/10', text: 'text-green-600', icon: CheckCircle2 },
    cancelled: { bg: 'bg-destructive/10', text: 'text-destructive', icon: XCircle },
    refunded: { bg: 'bg-muted', text: 'text-muted-foreground', icon: ArrowRight },
  };

  const style = styles[status] || styles.pending;
  const Icon = style.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium uppercase tracking-wider ${style.bg} ${style.text}`}>
      <Icon className="w-3.5 h-3.5" />
      {status}
    </span>
  );
};

export default function Orders() {
  const { data: orders, isLoading } = useListOrders();

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12 space-y-6">
        <div className="h-10 bg-muted w-48 animate-pulse mb-8" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-32 bg-muted animate-pulse w-full border border-border" />
        ))}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <h1 className="text-3xl font-medium tracking-tight mb-8">Order History</h1>

      {!orders || orders.length === 0 ? (
        <div className="text-center py-24 bg-muted/30 border border-dashed">
          <Package className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground">No orders found</h3>
          <p className="text-muted-foreground mt-1 mb-6">You haven't placed any orders yet.</p>
          <Button asChild variant="outline" className="rounded-none">
            <Link href="/products">Start Shopping</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => (
            <Link key={order.id} href={`/orders/${order.id}`}>
              <div className="block bg-card border border-border hover:border-primary/50 transition-colors group cursor-pointer">
                <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6 border-b border-border/50 bg-muted/20">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Order Placed</p>
                    <p className="font-medium">{format(new Date(order.createdAt), 'MMM d, yyyy')}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Total</p>
                    <p className="font-mono font-bold text-primary">{order.total} π</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Order #</p>
                    <p className="font-mono text-sm">{order.id.toString().padStart(6, '0')}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 ml-auto">
                    <StatusBadge status={order.status} />
                  </div>
                </div>
                
                <div className="p-6 flex items-center justify-between">
                  <div className="flex -space-x-4">
                    {order.items.slice(0, 4).map((item, idx) => (
                      <div key={idx} className="w-12 h-12 bg-muted border-2 border-card rounded-full overflow-hidden shrink-0 z-10 relative">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-muted text-[10px] text-muted-foreground">Img</div>
                        )}
                      </div>
                    ))}
                    {order.items.length > 4 && (
                      <div className="w-12 h-12 bg-secondary text-secondary-foreground border-2 border-card rounded-full flex items-center justify-center text-xs font-medium z-0 relative">
                        +{order.items.length - 4}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center text-sm font-medium text-primary group-hover:underline">
                    View Details <ArrowRight className="w-4 h-4 ml-1" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
