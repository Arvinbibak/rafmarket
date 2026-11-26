import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthenticateWithPi, useCompletePayment } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Auth() {
  const { user, login } = useAuth();
  const [, setLocation] = useLocation();
  const authenticateWithPi = useAuthenticateWithPi();
  const completePayment = useCompletePayment();
  const { toast } = useToast();
  const [isSdkLoading, setIsSdkLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setLocation('/');
    }
  }, [user, setLocation]);

  const handlePiLogin = async () => {
    try {
      setIsSdkLoading(true);
      if (!window.Pi) {
        throw new Error('Pi SDK not loaded');
      }

      // Initialize the Pi SDK in Testnet Sandbox before authentication.
      await window.Pi.init({ version: '2.0', sandbox: true });

      // 1. Authenticate with Pi SDK and capture any interrupted payment.
      const scopes = ['username', 'payments'];
      let sessionReady = false;
      let pendingPayment: any = null;
      let recoveryInProgress = false;

      const recoverIncompletePayment = async (payment: any) => {
        if (!sessionReady) {
          pendingPayment = payment;
          return;
        }
        if (recoveryInProgress) return;

        const paymentId = typeof payment?.identifier === 'string' ? payment.identifier : '';
        const txid = typeof payment?.transaction?.txid === 'string' ? payment.transaction.txid : '';
        if (!paymentId || !txid) {
          toast({
            title: 'Previous Pi payment needs attention',
            description: 'Pi has not supplied a verified transaction ID yet. Do not start another payment until this is resolved.',
            variant: 'destructive'
          });
          return;
        }

        recoveryInProgress = true;
        try {
          const orderId = Number(payment?.metadata?.orderId);
          await completePayment.mutateAsync({
            data: {
              paymentId,
              txid,
              ...(Number.isInteger(orderId) && orderId > 0 ? { orderId } : {})
            }
          });
          toast({
            title: 'Previous Pi payment recovered',
            description: 'Pi confirmed the transaction and RAFMARKET updated the order.'
          });
        } catch (error) {
          console.error('Incomplete Pi payment recovery failed:', error, payment);
          toast({
            title: 'Previous Pi payment is still pending',
            description: 'The server could not yet confirm completion with Pi. Do not pay for the same order again; sign in again later to retry recovery.',
            variant: 'destructive'
          });
        } finally {
          recoveryInProgress = false;
        }
      };

      const onIncompletePaymentFound = (payment: any) => {
        console.warn('Pi SDK reported an incomplete payment; attempting server-side recovery.', payment);
        pendingPayment = payment;
        if (sessionReady) void recoverIncompletePayment(payment);
      };

      const authResults = await window.Pi.authenticate(scopes, onIncompletePaymentFound);

      // 2. Verify the Pi access token and establish the RAFMARKET session.
      const authResult = await authenticateWithPi.mutateAsync({
        data: { accessToken: authResults.accessToken }
      });

      // 3. Login locally before calling the authenticated payment endpoint.
      login(authResult.token, authResult.user);
      sessionReady = true;

      if (pendingPayment) {
        await recoverIncompletePayment(pendingPayment);
      }

      setLocation('/');
      
    } catch (err) {
      console.error('Pi auth error:', err);
    } finally {
      setIsSdkLoading(false);
    }
  };

  const isLoading = isSdkLoading || authenticateWithPi.isPending;

  return (
    <div className="min-h-[100dvh] flex flex-col lg:flex-row bg-background">
      {/* Left side - Branding */}
      <div className="lg:flex-1 bg-secondary text-secondary-foreground flex flex-col justify-between p-8 lg:p-24 relative overflow-hidden">
        <div className="relative z-10">
          <div className="font-sans font-bold text-3xl tracking-tighter mb-12">
            RAF<span className="text-primary">MARKET</span>
          </div>
          <h1 className="text-4xl lg:text-6xl font-light leading-tight tracking-tight max-w-lg mb-6">
            The standard for <br/>
            <span className="font-medium text-primary">Pi Network</span> commerce.
          </h1>
          <p className="text-lg text-secondary-foreground/70 max-w-md">
            Discover premium goods, trade with confidence, and experience the true value of your Pi.
          </p>
        </div>
        
        {/* Abstract shapes / decor */}
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/4 -right-32 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* Right side - Login */}
      <div className="lg:w-[480px] w-full flex items-center justify-center p-8 lg:p-12 border-l bg-card">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2 text-center">
            <h2 className="text-3xl font-medium tracking-tight text-foreground">Welcome back</h2>
            <p className="text-muted-foreground">Sign in to your account to continue</p>
          </div>

          <div className="space-y-4">
            <Button 
              size="lg" 
              className="w-full h-14 text-base font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-none group"
              onClick={handlePiLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <ShieldCheck className="w-5 h-5 mr-2 group-hover:scale-110 transition-transform" />
              )}
              {isLoading ? 'Connecting...' : 'Connect with Pi'}
            </Button>
            
            {authenticateWithPi.isError && (
              <p className="text-sm text-destructive text-center">
                Failed to authenticate. Please try again.
              </p>
            )}
          </div>
          
          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              By connecting, you agree to our Terms of Service and Privacy Policy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
