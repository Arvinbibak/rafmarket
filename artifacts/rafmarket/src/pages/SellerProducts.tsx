import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  useCreateProduct,
  useDeleteProduct,
  useListCategories,
  useListProducts,
  useUpdateProduct,
} from '@workspace/api-client-react';
import type { Product } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PackagePlus, Pencil, Trash2, X } from 'lucide-react';

type ProductForm = {
  name: string;
  description: string;
  price: string;
  stock: string;
  categoryId: string;
  imageUrl: string;
};

const emptyForm: ProductForm = {
  name: '',
  description: '',
  price: '',
  stock: '1',
  categoryId: '',
  imageUrl: '',
};

export default function SellerProducts() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editing, setEditing] = useState<Product | null>(null);

  const { data: productPage, isLoading } = useListProducts(
    { limit: 100 },
    { queryKey: ['/api/products', { limit: 100 }], enabled: !!user },
  );
  const { data: categories } = useListCategories();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const myProducts = useMemo(
    () => (productPage?.products ?? []).filter((product) => product.sellerId === user?.id),
    [productPage?.products, user?.id],
  );

  const refreshProducts = async () => {
    await queryClient.invalidateQueries({ queryKey: ['/api/products'] });
  };

  const startEdit = (product: Product) => {
    setEditing(product);
    setForm({
      name: product.name,
      description: product.description,
      price: String(product.price),
      stock: String(product.stock),
      categoryId: String(product.categoryId),
      imageUrl: product.imageUrls?.[0] ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setEditing(null);
    setForm(emptyForm);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      setLocation('/auth');
      return;
    }
    const price = Number(form.price);
    const stock = Number(form.stock);
    const categoryId = Number(form.categoryId);
    if (!form.name.trim() || !form.description.trim() || !Number.isFinite(price) || price <= 0 ||
        !Number.isInteger(stock) || stock < 0 || !Number.isInteger(categoryId) || categoryId <= 0) {
      toast({ title: 'Check product details', description: 'Enter a name, description, valid Pi price, stock and category.', variant: 'destructive' });
      return;
    }

    const data = {
      name: form.name.trim(),
      description: form.description.trim(),
      price,
      currency: 'Pi',
      stock,
      categoryId,
      imageUrls: form.imageUrl.trim() ? [form.imageUrl.trim()] : [],
    };

    try {
      if (editing) {
        await updateProduct.mutateAsync({ id: String(editing.id), data });
        toast({ title: 'Product updated', description: 'Your changes have been saved.' });
      } else {
        await createProduct.mutateAsync({ data });
        toast({ title: 'Product created', description: 'Your product is now listed in the marketplace.' });
      }
      resetForm();
      await refreshProducts();
    } catch (error) {
      console.error('Seller product save failed', error);
      toast({ title: 'Could not save product', description: 'Please try again. Check that the selected category is available.', variant: 'destructive' });
    }
  };

  const handleDelete = async (product: Product) => {
    if (!window.confirm(`Delete “${product.name}”? This cannot be undone.`)) return;
    try {
      await deleteProduct.mutateAsync({ id: String(product.id) });
      toast({ title: 'Product deleted', description: product.name });
      await refreshProducts();
    } catch (error) {
      console.error('Seller product delete failed', error);
      toast({ title: 'Could not delete product', description: 'Please try again.', variant: 'destructive' });
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold mb-4">Sign in to manage your products</h1>
        <Button onClick={() => setLocation('/auth')}>Sign in with Pi</Button>
      </div>
    );
  }

  const saving = createProduct.isPending || updateProduct.isPending;

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-sm text-primary font-medium mb-2">SELLER CENTER</p>
          <h1 className="text-3xl font-semibold tracking-tight">My Products</h1>
          <p className="text-muted-foreground mt-2">Create and manage the products you sell on RAFMARKET.</p>
        </div>
        <div className="text-sm text-muted-foreground">{myProducts.length} active product(s)</div>
      </div>

      <section className="border border-border bg-card p-5 md:p-7 mb-10">
        <div className="flex items-center justify-between gap-3 mb-6">
          <h2 className="text-xl font-medium">{editing ? 'Edit product' : 'Add a product'}</h2>
          {editing && <Button type="button" variant="ghost" size="sm" onClick={resetForm}><X className="w-4 h-4 mr-1" /> Cancel edit</Button>}
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <label className="text-sm font-medium">Product name</label>
            <Input required maxLength={140} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Handmade chess set" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Category</label>
            <select required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="h-10 w-full border border-input bg-background px-3 text-sm">
              <option value="">Choose category</option>
              {categories?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Price (Pi)</label>
            <Input required type="number" min="0.000001" step="0.000001" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Available stock</label>
            <Input required type="number" min="0" step="1" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Description</label>
            <textarea required maxLength={5000} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the product, condition and important details..." className="w-full border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Image URL (optional)</label>
            <Input type="url" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..." />
            <p className="text-xs text-muted-foreground">For this first version, add one publicly accessible image link. Direct image uploads will be added separately.</p>
          </div>
          <div className="md:col-span-2 flex flex-wrap gap-3">
            <Button type="submit" disabled={saving} className="min-w-40">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackagePlus className="w-4 h-4 mr-2" />}
              {editing ? 'Save changes' : 'Publish product'}
            </Button>
            {editing && <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>}
          </div>
        </form>
      </section>

      <section>
        <h2 className="text-xl font-medium mb-5">Your listed products</h2>
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin" /></div>
        ) : myProducts.length === 0 ? (
          <div className="border border-dashed p-12 text-center text-muted-foreground">You have not listed any active products yet.</div>
        ) : (
          <div className="space-y-3">
            {myProducts.map((product) => (
              <div key={product.id} className="border border-border bg-card p-4 flex flex-col sm:flex-row gap-4 sm:items-center">
                <div className="w-20 h-20 bg-muted shrink-0 overflow-hidden">
                  {product.imageUrls?.[0] ? <img src={product.imageUrls[0]} alt={product.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No image</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{product.name}</h3>
                  <p className="text-sm text-muted-foreground">{product.price} π · Stock: {product.stock} · {product.categoryName || 'Uncategorized'}</p>
                  <p className="text-xs text-muted-foreground mt-1">Status: {product.status}</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => startEdit(product)}><Pencil className="w-4 h-4 mr-1" /> Edit</Button>
                  <Button type="button" variant="destructive" size="sm" disabled={deleteProduct.isPending} onClick={() => handleDelete(product)}><Trash2 className="w-4 h-4 mr-1" /> Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
