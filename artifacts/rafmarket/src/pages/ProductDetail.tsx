import { useState } from 'react';
import { useRoute, useLocation, useParams } from 'wouter';
import { useGetProduct, useAddCartItem, getGetCartQueryKey } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Star, ShieldCheck, Truck, ChevronLeft, Minus, Plus } from 'lucide-react';
import { Link } from 'wouter';
import { useToast } from '@/hooks/use-toast';

export default function ProductDetail() {
  const params = useParams();
  const id = params?.id;
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: product, isLoading } = useGetProduct(id || '', {
    query: { enabled: !!id }
  });

  const addToCart = useAddCartItem();
  
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);

  const handleAddToCart = () => {
    if (!user) {
      setLocation('/auth');
      return;
    }
    if (!product) return;

    addToCart.mutate({
      data: { productId: product.id, quantity }
    }, {
      onSuccess: () => {
        toast({
          title: "Added to cart",
          description: `${quantity}x ${product.name} added to your cart.`,
        });
        queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
      },
      onError: (err) => {
        toast({
          title: "Error",
          description: "Could not add item to cart.",
          variant: "destructive"
        });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12 flex flex-col md:flex-row gap-12">
        <div className="w-full md:w-1/2 aspect-square bg-muted animate-pulse" />
        <div className="w-full md:w-1/2 space-y-6">
          <div className="h-10 bg-muted w-3/4 animate-pulse" />
          <div className="h-6 bg-muted w-1/4 animate-pulse" />
          <div className="h-32 bg-muted w-full animate-pulse" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-medium mb-4">Product not found</h1>
        <Button asChild variant="outline" className="rounded-none"><Link href="/products">Back to shop</Link></Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <Link href="/products" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ChevronLeft className="w-4 h-4 mr-1" /> Back to Discover
      </Link>

      <div className="flex flex-col md:flex-row gap-12 lg:gap-24">
        {/* Images */}
        <div className="w-full md:w-1/2 flex flex-col gap-4">
          <div className="aspect-square bg-muted relative overflow-hidden">
            {product.imageUrls?.[selectedImage] ? (
              <img 
                src={product.imageUrls[selectedImage]} 
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">No image available</div>
            )}
          </div>
          {product.imageUrls && product.imageUrls.length > 1 && (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {product.imageUrls.map((url, idx) => (
                <button 
                  key={idx} 
                  onClick={() => setSelectedImage(idx)}
                  className={`w-24 h-24 flex-shrink-0 bg-muted border-2 transition-colors ${selectedImage === idx ? 'border-primary' : 'border-transparent'}`}
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="w-full md:w-1/2 flex flex-col">
          <div className="mb-2">
            <Link href={`/products?category=${product.categoryName}`} className="text-primary text-sm font-medium hover:underline">
              {product.categoryName}
            </Link>
          </div>
          <h1 className="text-3xl md:text-5xl font-medium tracking-tight mb-4">{product.name}</h1>
          
          <div className="flex items-center gap-4 mb-6">
            <span className="text-2xl font-mono font-bold text-foreground">
              {product.price} π
            </span>
            {product.stock > 0 ? (
              <span className="text-sm px-2 py-1 bg-secondary text-secondary-foreground">In Stock ({product.stock})</span>
            ) : (
              <span className="text-sm px-2 py-1 bg-destructive text-destructive-foreground font-medium">Sold Out</span>
            )}
          </div>

          <p className="text-muted-foreground leading-relaxed mb-8">
            {product.description}
          </p>

          <div className="border-t border-b py-6 mb-8 space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center border border-border h-12 w-32">
                <button 
                  className="w-10 h-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  disabled={product.stock === 0}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="flex-1 text-center font-medium">{quantity}</span>
                <button 
                  className="w-10 h-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  onClick={() => setQuantity(q => Math.min(product.stock, q + 1))}
                  disabled={product.stock === 0}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <Button 
                onClick={handleAddToCart}
                disabled={product.stock === 0 || addToCart.isPending}
                size="lg"
                className="flex-1 h-12 rounded-none bg-primary text-primary-foreground hover:bg-primary/90 text-base"
              >
                <ShoppingCart className="w-5 h-5 mr-2" />
                {addToCart.isPending ? 'Adding...' : 'Add to Cart'}
              </Button>
            </div>
          </div>

          <div className="space-y-4 text-sm text-muted-foreground bg-muted/30 p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
              <div>
                <p className="font-medium text-foreground">Verified Seller</p>
                <p>Sold by @{product.sellerUsername}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Truck className="w-5 h-5 text-primary shrink-0" />
              <div>
                <p className="font-medium text-foreground">Worldwide Shipping</p>
                <p>Delivery times vary by seller location.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Star className="w-5 h-5 text-primary shrink-0" />
              <div>
                <p className="font-medium text-foreground">Pi Network Standard</p>
                <p>All transactions are secured on the Pi blockchain.</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
