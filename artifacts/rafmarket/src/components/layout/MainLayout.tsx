import { Link, useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { useGetCart } from '@workspace/api-client-react';
import { ShoppingCart, Menu, Search, User as UserIcon, LogOut, Package, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { data: cart } = useGetCart({ query: { enabled: !!user } });

  const handleLogout = () => {
    logout();
    setLocation('/');
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary selection:text-primary-foreground">
      <header className="sticky top-0 z-50 w-full border-b bg-card/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <span className="font-sans font-bold text-2xl tracking-tighter text-foreground">
                RAF<span className="text-primary">MARKET</span>
              </span>
            </Link>
            <nav className="hidden md:flex items-center gap-6">
              <Link href="/products" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Discover
              </Link>
              <Link href="/products?category=electronics" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Tech
              </Link>
              <Link href="/products?category=fashion" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Fashion
              </Link>
            </nav>
          </div>

          <div className="flex-1 max-w-md hidden md:flex items-center relative">
            <Search className="absolute left-3 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search premium goods..." 
              className="w-full pl-10 bg-muted/50 border-transparent focus-visible:border-primary"
            />
          </div>

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="md:hidden">
              <Search className="w-5 h-5" />
            </Button>
            
            <Link href="/cart" className="relative group">
              <Button variant="ghost" size="icon" className="hover:text-primary transition-colors">
                <ShoppingCart className="w-5 h-5" />
                {cart?.itemCount ? (
                  <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm group-hover:scale-110 transition-transform">
                    {cart.itemCount}
                  </span>
                ) : null}
              </Button>
            </Link>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8 border border-border">
                      <AvatarImage src={user.avatarUrl || undefined} alt={user.displayName || user.piUsername} />
                      <AvatarFallback className="bg-secondary text-secondary-foreground font-mono">
                        {(user.displayName || user.piUsername).substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user.displayName || user.piUsername}</p>
                      <p className="text-xs leading-none text-muted-foreground font-mono">
                        @{user.piUsername}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setLocation('/orders')} className="cursor-pointer">
                    <Package className="mr-2 h-4 w-4" />
                    <span>My Orders</span>
                  </DropdownMenuItem>
                  {(user.role === 'admin' || user.role === 'seller') && (
                    <DropdownMenuItem onClick={() => setLocation('/admin')} className="cursor-pointer">
                      <ShieldAlert className="mr-2 h-4 w-4" />
                      <span>Admin Dashboard</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive focus:bg-destructive/10">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button onClick={() => setLocation('/auth')} className="bg-secondary text-secondary-foreground hover:bg-secondary/90 font-medium">
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <footer className="border-t bg-card py-12 mt-auto">
        <div className="container mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-col gap-2">
            <span className="font-sans font-bold text-xl tracking-tighter">
              RAF<span className="text-primary">MARKET</span>
            </span>
            <p className="text-sm text-muted-foreground">The definitive Pi Network marketplace.</p>
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <a href="https://minepi.com" target="_blank" rel="noreferrer" className="hover:text-primary">Pi Network</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
