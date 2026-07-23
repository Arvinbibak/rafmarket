import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useListProducts, useListCategories } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Search as SearchIcon, Filter, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function Products() {
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const categoryParam = searchParams.get('category') || '';
  const searchParam = searchParams.get('search') || '';
  
  const [searchInput, setSearchInput] = useState(searchParam);
  const [, setLocation] = useLocation();

  const { data: productsData, isLoading } = useListProducts({
    category: categoryParam || undefined,
    search: searchParam || undefined,
  });

  const { data: categories } = useListCategories();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (categoryParam) params.set('category', categoryParam);
    if (searchInput) params.set('search', searchInput);
    setLocation(`/products?${params.toString()}`);
  };

  const handleCategorySelect = (slug: string) => {
    const params = new URLSearchParams();
    if (slug) params.set('category', slug);
    if (searchParam) params.set('search', searchParam);
    setLocation(`/products?${params.toString()}`);
  };

  return (
    <div className="container mx-auto px-4 py-12 flex flex-col md:flex-row gap-8">
      {/* Sidebar Filters */}
      <aside className="w-full md:w-64 flex-shrink-0 space-y-8">
        <div>
          <h3 className="font-medium text-lg mb-4 flex items-center gap-2">
            <Filter className="w-4 h-4" /> Categories
          </h3>
          <div className="space-y-2">
            <button
              onClick={() => handleCategorySelect('')}
              className={`block w-full text-left px-3 py-2 text-sm transition-colors ${!categoryParam ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted'}`}
            >
              All Products
            </button>
            {categories?.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategorySelect(cat.slug)}
                className={`block w-full text-left px-3 py-2 text-sm transition-colors ${categoryParam === cat.slug ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-medium text-lg mb-4 flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" /> Price Range
          </h3>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input type="number" placeholder="Min" className="w-full" />
              <span>-</span>
              <Input type="number" placeholder="Max" className="w-full" />
            </div>
            <Button variant="outline" className="w-full rounded-none">Apply</Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <h1 className="text-3xl font-medium tracking-tight">
            {categoryParam ? categories?.find(c => c.slug === categoryParam)?.name || 'Products' : 'All Products'}
          </h1>
          
          <form onSubmit={handleSearch} className="relative w-full sm:w-72">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search..." 
              className="pl-10 rounded-none bg-muted/50 border-transparent focus-visible:border-primary"
            />
          </form>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="animate-pulse space-y-4">
                <div className="aspect-[4/5] bg-muted w-full" />
                <div className="h-5 bg-muted w-2/3" />
                <div className="h-4 bg-muted w-1/3" />
              </div>
            ))}
          </div>
        ) : productsData?.products.length === 0 ? (
          <div className="text-center py-24 bg-muted/30 border border-dashed">
            <SearchIcon className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground">No products found</h3>
            <p className="text-muted-foreground mt-1">Try adjusting your filters or search terms.</p>
            <Button variant="outline" className="mt-6 rounded-none" onClick={() => handleCategorySelect('')}>
              Clear all filters
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
            {productsData?.products.map((product) => (
              <Link key={product.id} href={`/products/${product.id}`} className="group cursor-pointer flex flex-col">
                <div className="aspect-[4/5] relative overflow-hidden bg-muted mb-4">
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
                  {product.stock === 0 && (
                    <div className="absolute top-2 right-2 bg-destructive text-destructive-foreground text-xs font-bold px-2 py-1">
                      SOLD OUT
                    </div>
                  )}
                </div>
                <div className="flex justify-between items-start gap-2 mb-1">
                  <h3 className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {product.name}
                  </h3>
                </div>
                <p className="font-mono text-primary font-bold">
                  {product.price} π
                </p>
                <p className="text-sm text-muted-foreground mt-auto pt-2 truncate">
                  by @{product.sellerUsername}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
