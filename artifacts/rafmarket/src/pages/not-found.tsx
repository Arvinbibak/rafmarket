import { Link } from 'wouter';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background p-4">
      <div className="text-center max-w-md space-y-6">
        <div className="w-24 h-24 bg-muted mx-auto flex items-center justify-center rounded-full mb-8">
          <ShieldAlert className="w-10 h-10 text-muted-foreground" />
        </div>
        <h1 className="text-4xl font-medium tracking-tight text-foreground">
          404 Not Found
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          The page you are looking for doesn't exist or has been moved.
        </p>
        <div className="pt-6">
          <Button asChild size="lg" className="rounded-none bg-primary text-primary-foreground hover:bg-primary/90">
            <Link href="/">Return to Marketplace</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
