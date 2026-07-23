import { useGetFeaturedProducts, useListCategories } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { ArrowRight, Star, TrendingUp } from 'lucide-react';

export default function Home() {
  const { data: featuredProducts, isLoading: isProductsLoading } = useGetFeaturedProducts();
  const { data: categories, isLoading: isCategoriesLoading } = useListCategories();

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative bg-secondary text-secondary-foreground overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[100px] translate-x-1/3 -translate-y-1/3" />
          <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[80px] -translate-x-1/3 translate-y-1/3" />
        </div>
        
        <div className="container relative z-10 mx-auto px-4 py-32 md:py-48 flex flex-col items-start justify-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-medium mb-8">
            <Star className="w-4 h-4" />
            <span>The definitive marketplace</span>
          </div>
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-light tracking-tight max-w-4xl mb-6">
            Curated goods.<br/>
            <span className="font-medium text-primary">Real value.</span>
          </h1>
          <p className="text-lg md:text-xl text-secondary-foreground/70 max-w-xl mb-10">
            A premium trading experience built exclusively for the Pi Network ecosystem. Discover, buy, and sell with confidence.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Button asChild size="lg" className="h-14 px-8 text-base bg-primary text-primary-foreground hover:bg-primary/90 rounded-none">
              <Link href="/products">
                Shop Collection <ArrowRight className="ml-2 w-5 h-5" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-14 px-8 text-base rounded-none border-secondary-foreground/20 hover:bg-secondary-foreground hover:text-secondary">
              <Link href="/auth">
                Become a Seller
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="flex items-end justify-between mb-12">
            <div>
              <h2 className="text-3xl font-medium tracking-tight flex items-center gap-3">
                <TrendingUp className="w-8 h-8 text-primary" />
                Featured Artifacts
              </h2>
              <p className="text-muted-foreground mt-2">Hand-picked by our curators</p>
            </div>
            <Button asChild variant="ghost" className="hidden md:flex hover:text-primary">
              <Link href="/products">View all <ArrowRight className="ml-2 w-4 h-4" /></Link>
            </Button>
          </div>

          {isProductsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="animate-pulse space-y-4">
                  <div className="aspect-[4/5] bg-muted w-full" />
                  <div className="h-5 bg-muted w-2/3" />
                  <div className="h-4 bg-muted w-1/3" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-12">
              {featuredProducts?.map((product) => (
                <Link key={product.id} href={`/products/${product.id}`} className="group cursor-pointer">
                  <div className="space-y-4">
                    <div className="aspect-[4/5] relative overflow-hidden bg-muted">
                      {product.imageUrls?.[0] ? (
                        <img 
                          src={product.imageUrls[0]} 
                          alt={product.name}
                          className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
                          No image
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-500" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="font-medium text-foreground truncate">{product.name}</h3>
                        <p className="font-mono text-primary font-bold whitespace-nowrap">
                          {product.price} π
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{product.categoryName}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Categories */}
      <section className="py-24 bg-card border-t border-border">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-medium tracking-tight mb-12">Shop by Category</h2>
          
          {isCategoriesLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-32 bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {categories?.map((category) => (
                <Link key={category.id} href={`/products?category=${category.slug}`}>
                  <div className="group relative h-48 bg-muted overflow-hidden flex items-center justify-center cursor-pointer">
                    {category.imageUrl && (
                      <img 
                        src={category.imageUrl} 
                        alt={category.name}
                        className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-60 group-hover:scale-105 transition-all duration-500"
                      />
                    )}
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors duration-500" />
                    <span className="relative z-10 font-medium text-xl text-white tracking-wide">
                      {category.name}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
