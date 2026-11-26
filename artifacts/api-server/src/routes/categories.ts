import { Router, type IRouter } from "express";
import { db, categoriesTable, productsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router: IRouter = Router();

const DEFAULT_CATEGORIES = [
  {
    name: "Electronics",
    slug: "electronics",
    description: "Phones, computers, accessories and consumer electronics.",
  },
  {
    name: "Fashion & Accessories",
    slug: "fashion-accessories",
    description: "Clothing, footwear, bags and personal accessories.",
  },
  {
    name: "Home & Living",
    slug: "home-living",
    description: "Furniture, home decor, kitchen and household goods.",
  },
  {
    name: "Tools & Machinery",
    slug: "tools-machinery",
    description: "Hand tools, workshop equipment and industrial machinery.",
  },
  {
    name: "Automotive & Parts",
    slug: "automotive-parts",
    description: "Vehicle parts, accessories and maintenance supplies.",
  },
  {
    name: "Art & Collectibles",
    slug: "art-collectibles",
    description: "Artwork, handmade crafts and collectible items.",
  },
  {
    name: "Digital Services",
    slug: "digital-services",
    description: "Digital products, software and online services.",
  },
  {
    name: "Other",
    slug: "other",
    description: "Products and services that do not fit another category.",
  },
];

// GET /categories
router.get("/categories", async (_req, res): Promise<void> => {
  let categories = await db.select().from(categoriesTable).orderBy(categoriesTable.name);

  if (categories.length === 0) {
    await db
      .insert(categoriesTable)
      .values(DEFAULT_CATEGORIES)
      .onConflictDoNothing({ target: categoriesTable.slug });
    categories = await db.select().from(categoriesTable).orderBy(categoriesTable.name);
  }

  // Get product counts
  const counts = await db
    .select({ categoryId: productsTable.categoryId, count: sql<number>`count(*)::int` })
    .from(productsTable)
    .where(eq(productsTable.status, "active"))
    .groupBy(productsTable.categoryId);

  const countMap = new Map(counts.map((c) => [c.categoryId, c.count]));

  res.json(
    categories.map((cat) => ({
      ...cat,
      productCount: countMap.get(cat.id) ?? 0,
    }))
  );
});

// POST /categories (admin)
router.post("/categories", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { name, slug, description, imageUrl } = req.body as Record<string, string>;
  if (!name || !slug) {
    res.status(400).json({ error: "name and slug are required" });
    return;
  }
  const [cat] = await db.insert(categoriesTable).values({ name, slug, description, imageUrl }).returning();
  res.status(201).json({ ...cat, productCount: 0 });
});

// PATCH /categories/:id (admin)
router.patch("/categories/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, slug, description, imageUrl } = req.body as Record<string, string>;
  const update: Record<string, string | undefined> = {};
  if (name) update.name = name;
  if (slug) update.slug = slug;
  if (description !== undefined) update.description = description;
  if (imageUrl !== undefined) update.imageUrl = imageUrl;

  const [cat] = await db.update(categoriesTable).set(update).where(eq(categoriesTable.id, id)).returning();
  if (!cat) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  res.json({ ...cat, productCount: 0 });
});

// DELETE /categories/:id (admin)
router.delete("/categories/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
  res.sendStatus(204);
});

export default router;
