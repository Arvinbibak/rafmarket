import { Router, type IRouter } from "express";
import { db, productsTable, categoriesTable, usersTable } from "@workspace/db";
import { eq, like, and, gte, lte, sql, desc, asc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

function toProduct(row: typeof productsTable.$inferSelect, categoryName?: string | null, sellerUsername?: string | null) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: parseFloat(row.price),
    currency: row.currency,
    stock: row.stock,
    categoryId: row.categoryId,
    categoryName: categoryName ?? null,
    sellerId: row.sellerId,
    sellerUsername: sellerUsername ?? null,
    imageUrls: row.imageUrls ?? [],
    tags: row.tags ?? [],
    status: row.status,
    isFeatured: row.isFeatured,
    rating: row.rating != null ? parseFloat(row.rating) : null,
    reviewCount: row.reviewCount,
    createdAt: row.createdAt,
  };
}

// GET /products
router.get("/products", async (req, res): Promise<void> => {
  const { category, search, page = "1", limit = "20", minPrice, maxPrice, sortBy } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(productsTable.status, "active")];
  if (category) conditions.push(eq(productsTable.categoryId, parseInt(category, 10)));
  if (search) conditions.push(like(productsTable.name, `%${search}%`));
  if (minPrice) conditions.push(gte(sql`${productsTable.price}::numeric`, parseFloat(minPrice)));
  if (maxPrice) conditions.push(lte(sql`${productsTable.price}::numeric`, parseFloat(maxPrice)));

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const orderCol = sortBy === "price_asc" ? asc(sql`${productsTable.price}::numeric`)
    : sortBy === "price_desc" ? desc(sql`${productsTable.price}::numeric`)
    : sortBy === "rating" ? desc(productsTable.rating)
    : desc(productsTable.createdAt);

  const [products, [{ total }]] = await Promise.all([
    db.select({
      product: productsTable,
      categoryName: categoriesTable.name,
      sellerUsername: usersTable.piUsername,
    })
      .from(productsTable)
      .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .leftJoin(usersTable, eq(productsTable.sellerId, usersTable.id))
      .where(where)
      .orderBy(orderCol)
      .limit(limitNum)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(productsTable).where(where),
  ]);

  res.json({
    products: products.map((r) => toProduct(r.product, r.categoryName, r.sellerUsername)),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

// GET /products/featured
router.get("/products/featured", async (_req, res): Promise<void> => {
  const products = await db.select({
    product: productsTable,
    categoryName: categoriesTable.name,
    sellerUsername: usersTable.piUsername,
  })
    .from(productsTable)
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
    .leftJoin(usersTable, eq(productsTable.sellerId, usersTable.id))
    .where(and(eq(productsTable.isFeatured, true), eq(productsTable.status, "active")))
    .orderBy(desc(productsTable.createdAt))
    .limit(12);

  res.json(products.map((r) => toProduct(r.product, r.categoryName, r.sellerUsername)));
});

// GET /products/:id
router.get("/products/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [row] = await db.select({
    product: productsTable,
    categoryName: categoriesTable.name,
    sellerUsername: usersTable.piUsername,
  })
    .from(productsTable)
    .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
    .leftJoin(usersTable, eq(productsTable.sellerId, usersTable.id))
    .where(eq(productsTable.id, id));

  if (!row) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.json(toProduct(row.product, row.categoryName, row.sellerUsername));
});

// POST /products
router.post("/products", requireAuth, async (req, res): Promise<void> => {
  const { name, description, price, currency, stock, categoryId, imageUrls, tags, isFeatured } =
    req.body as { name?: string; description?: string; price?: number; currency?: string; stock?: number; categoryId?: number; imageUrls?: string[]; tags?: string[]; isFeatured?: boolean };

  if (!name || !description || price == null || !categoryId) {
    res.status(400).json({ error: "name, description, price, categoryId are required" });
    return;
  }

  const [product] = await db.insert(productsTable).values({
    name,
    description,
    price: String(price),
    currency: currency ?? "Pi",
    stock: stock ?? 0,
    categoryId,
    sellerId: req.user!.id,
    imageUrls: imageUrls ?? [],
    tags: tags ?? [],
    isFeatured: isFeatured ?? false,
    status: "active",
  }).returning();

  res.status(201).json(toProduct(product, null, req.user?.piUsername));
});

// PATCH /products/:id
router.patch("/products/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const { name, description, price, currency, stock, categoryId, imageUrls, tags, status, isFeatured } = req.body as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if (name != null) update.name = name;
  if (description != null) update.description = description;
  if (price != null) update.price = String(price);
  if (currency != null) update.currency = currency;
  if (stock != null) update.stock = stock;
  if (categoryId != null) update.categoryId = categoryId;
  if (imageUrls != null) update.imageUrls = imageUrls;
  if (tags != null) update.tags = tags;
  if (status != null) update.status = status;
  if (isFeatured != null) update.isFeatured = isFeatured;

  const [product] = await db.update(productsTable).set(update).where(eq(productsTable.id, id)).returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.json(toProduct(product));
});

// DELETE /products/:id
router.delete("/products/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  await db.delete(productsTable).where(eq(productsTable.id, id));
  res.sendStatus(204);
});

export default router;
