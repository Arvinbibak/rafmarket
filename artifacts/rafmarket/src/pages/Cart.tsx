import { useState } from 'react';
import { useLocation } from 'wouter';
import { 
  useGetCart, 
  useUpdateCartItem, 
  useRemoveCartItem, 
  useCreateOrder,
  useInitiatePayment,
  useCompletePayment,
  useCancelPayment,
  getGetCartQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Loader2, PackageX, Minus, Plus, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { useToast } from '@/hooks/use-toast';

export default function Cart() {
  const { data: cart, isLoading } = useGetCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const createOrder = useCreateOrder();
  const initiatePayment = useInitiatePayment();
  const completePayment = useCompletePayment();
  const cancelPayment = useCancelPayment();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [shippingAddress, setShippingAddress] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);

  const handleUpdateQuantity = (productId: number, quantity: number) => {
    if (quantity < 1) return;
    updateItem.mutate({ id: productId.toString(), data: { quantity } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() })
    });
  };

  const handleRemove = (productId: number) => {
    removeItem.mutate({ id: productId.toString() }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() })
    });
  };

  const handleCheckout = async () => {
    if (!cart || cart.items.length === 0) return;
    if (!shippingAddress.trim()) {
      toast({ title: 'Address required', description: 'Please enter a shipping address.', variant: 'destructive' });
      return;
    }

    try {
      setIsProcessing(true);
      setPaymentStatus('Creating order...');
      
      // 1. Create order
      const order = await createOrder.mutateAsync({
        data: { shippingAddress }
      });

      setPaymentStatus('Awaiting Pi App approval...');

      // 2. Pi Payment SDK
      if (!window.Pi) throw new Error('Pi SDK not loaded');

      const paymentData = {
        amount: order.total,
        memo: `RAFMARKET Order #${order.id}`,
        metadata: { orderId: order.id }
      };

      const callbacks = {
        onReadyForServerApproval: async (paymentId: string) => {
          setPaymentStatus('Approving payment...');
          await initiatePayment.mutateAsync({
            data: { orderId: order.id, amount: order.total, paymentId }
          });
        },
        onReadyForServerCompletion: async (paymentId: string, txid: string) => {
          setPaymentStatus('Completing payment...');
          await completePayment.mutateAsync({
            data: { paymentId, txid, orderId: order.id }
          });
          queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
          toast({ title: 'Payment Successful', description: 'Your order has been placed.' });
          setLocation(`/orders/${order.id}`);
        },
        onCancel: async (paymentId: string) => {
          setPaymentStatus(null);
          setIsProcessing(false);
          await cancelPayment.mutateAsync({
            data: { paymentId, orderId: order.id }
          });
          toast({ title: 'Payment Cancelled', description: 'You cancelled the payment.', variant: 'destructive' });
        },
        onError: (error: any) => {
          setPaymentStatus(null);
          setIsProcessing(false);
          console.error(error);
          toast({ title: 'Payment Error', description: 'An error occurred during payment.', variant: 'destructive' });
        }
      };

      window.Pi.createPayment(paymentData, callbacks);

    } catch (err) {
      console.error(err);
      toast({ title: 'Checkout Error', description: 'Failed to initiate checkout.', variant: 'destructive' });
      setIsProcessing(false);
      setPaymentStatus(null);
    }
  };

  if (isLoading) {
    return <div className="container mx-auto px-4 py-24 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-32 flex flex-col items-center justify-center text-center">
        <div className="w-24 h-24 bg-muted flex items-center justify-center rounded-full mb-6">
          <PackageX className="w-10 h-10 text-muted-foreground" />
        </div>
        <h1 className="text-3xl font-medium tracking-tight mb-4">Your cart is empty</h1>
        <p className="text-muted-foreground mb-8 max-w-md">Looks like you haven't added any premium goods to your cart yet.</p>
        <Button asChild size="lg" className="rounded-none bg-primary text-primary-foreground hover:bg-primary/90">
          <Link href="/products">Continue Shopping</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-medium tracking-tight mb-8">Shopping Cart</h1>

      <div className="flex flex-col lg:flex-row gap-12">
        {/* Items List */}
        <div className="flex-1 space-y-6">
          {cart.items.map((item) => (
            <div key={item.productId} className="flex gap-6 py-6 border-b border-border relative">
              <div className="w-24 h-24 md:w-32 md:h-32 bg-muted shrink-0">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.productName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No image</div>
                )}
              </div>
              <div className="flex-1 flex flex-col">
                <div className="flex justify-between items-start gap-4">
                  <h3 className="font-medium text-lg leading-tight">
                    <Link href={`/products/${item.productId}`} className="hover:text-primary transition-colors">
                      {item.productName}
                    </Link>
                  </h3>
                  <p className="font-mono font-bold whitespace-nowrap">{item.price} π</p>
                </div>
                
                <div className="mt-auto flex items-center justify-between">
                  <div className="flex items-center border border-border h-10">
                    <button 
                      className="w-10 h-full flex items-center justify-center hover:bg-muted transition-colors"
                      onClick={() => handleUpdateQuantity(item.productId, item.quantity - 1)}
                      disabled={updateItem.isPending}
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-10 text-center text-sm font-medium">{item.quantity}</span>
                    <button 
                      className="w-10 h-full flex items-center justify-center hover:bg-muted transition-colors"
                      onClick={() => handleUpdateQuantity(item.productId, item.quantity + 1)}
                      disabled={updateItem.isPending}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  
                  <button 
                    onClick={() => handleRemove(item.productId)}
                    className="text-muted-foreground hover:text-destructive p-2 transition-colors"
                    disabled={removeItem.isPending}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Order Summary */}
        <div className="w-full lg:w-[400px] shrink-0">
          <div className="bg-card border border-border p-6 space-y-6 sticky top-24">
            <h2 className="text-xl font-medium tracking-tight">Order Summary</h2>
            
            <div className="space-y-4 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal ({cart.itemCount} items)</span>
                <span className="font-mono text-foreground">{cart.total} π</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Shipping</span>
                <span>Calculated via Pi</span>
              </div>
              <div className="border-t pt-4 flex justify-between font-medium text-lg">
                <span>Total</span>
                <span className="font-mono text-primary font-bold">{cart.total} π</span>
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t">
              <label className="text-sm font-medium block">Shipping Address</label>
              <Input 
                value={shippingAddress}
                onChange={(e) => setShippingAddress(e.target.value)}
                placeholder="Enter full delivery address..."
                className="h-12 bg-muted/50"
                disabled={isProcessing}
              />
            </div>

            <Button 
              onClick={handleCheckout} 
              disabled={isProcessing || !shippingAddress.trim()}
              className="w-full h-14 text-base font-medium rounded-none bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  {paymentStatus || 'Processing...'}
                </>
              ) : (
                'Pay with Pi'
              )}
            </Button>
            
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-4">
              <ShieldCheck className="w-4 h-4 text-primary" />
              Secure transaction via Pi Network SDK
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
