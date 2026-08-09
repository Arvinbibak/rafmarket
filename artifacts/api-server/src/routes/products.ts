import { Router, type IRouter } from "express";
import {
  db,
  productsTable,
  categoriesTable,
  usersTable,
} from "@workspace/db";

import {
  eq,
  like,
  and,
  gte,
  lte,
  sql,
  desc,
  asc,
} from "drizzle-orm";

import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

function toProduct(
  row: typeof productsTable.$inferSelect,
  categoryName?: string | null,
  sellerUsername?: string | null,
) {
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
  const {
    category,
    search,
    page = "1",
    limit = "20",
    minPrice,
    maxPrice,
    sortBy,
  } = req.query as Record<string, string>;

  const parsedPage = parseInt(page, 10);
  const parsedLimit = parseInt(limit, 10);

  const pageNum = Number.isFinite(parsedPage)
    ? Math.max(1, parsedPage)
    : 1;

  const limitNum = Number.isFinite(parsedLimit)
    ? Math.min(100, Math.max(1, parsedLimit))
    : 20;

  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(productsTable.status, "active")];

  if (category) {
    const categoryId = parseInt(category, 10);

    if (Number.isInteger(categoryId) && categoryId > 0) {
      conditions.push(eq(productsTable.categoryId, categoryId));
    }
  }

  if (search?.trim()) {
    conditions.push(
      like(productsTable.name, `%${search.trim()}%`),
    );
  }

  if (minPrice) {
    const value = parseFloat(minPrice);

    if (Number.isFinite(value) && value >= 0) {
      conditions.push(
        gte(sql`${productsTable.price}::numeric`, value),
      );
    }
  }

  if (maxPrice) {
    const value = parseFloat(maxPrice);

    if (Number.isFinite(value) && value >= 0) {
      conditions.push(
        lte(sql`${productsTable.price}::numeric`, value),
      );
    }
  }

  const where =
    conditions.length === 1
      ? conditions[0]
      : and(...conditions);

  const orderCol =
    sortBy === "price_asc"
      ? asc(sql`${productsTable.price}::numeric`)
      : sortBy === "price_desc"
        ? desc(sql`${productsTable.price}::numeric`)
        : sortBy === "rating"
          ? desc(productsTable.rating)
          : desc(productsTable.createdAt);

  const [products, [{ total }]] = await Promise.all([
    db
      .select({
        product: productsTable,
        categoryName: categoriesTable.name,
        sellerUsername: usersTable.piUsername,
      })
      .from(productsTable)
      .leftJoin(
        categoriesTable,
        eq(productsTable.categoryId, categoriesTable.id),
      )
      .leftJoin(
        usersTable,
        eq(productsTable.sellerId, usersTable.id),
      )
      .where(where)
      .orderBy(orderCol)
      .limit(limitNum)
      .offset(offset),

    db
      .select({
        total: sql<number>`count(*)::int`,
      })
      .from(productsTable)
      .where(where),
  ]);

  res.json({
    products: products.map((r) =>
      toProduct(
        r.product,
        r.categoryName,
        r.sellerUsername,
      ),
    ),
    total,
    page: pageNum,
    limit: limitNum,
  });
});

// GET /products/featured
router.get("/products/featured", async (_req, res): Promise<void> => {
  const products = await db
    .select({
      product: productsTable,
      categoryName: categoriesTable.name,
      sellerUsername: usersTable.piUsername,
    })
    .from(productsTable)
    .leftJoin(
      categoriesTable,
      eq(productsTable.categoryId, categoriesTable.id),
    )
    .leftJoin(
      usersTable,
      eq(productsTable.sellerId, usersTable.id),
    )
    .where(
      and(
        eq(productsTable.isFeatured, true),
        eq(productsTable.status, "active"),
      ),
    )
    .orderBy(desc(productsTable.createdAt))
    .limit(12);

  res.json(
    products.map((r) =>
      toProduct(
        r.product,
        r.categoryName,
        r.sellerUsername,
      ),
    ),
  );
});

// GET /products/:id
router.get("/products/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id)
    ? req.params.id[0]
    : req.params.id;

  const id = parseInt(raw, 10);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      error: "Invalid product id",
    });
    return;
  }

  const [row] = await db
    .select({
      product: productsTable,
      categoryName: categoriesTable.name,
      sellerUsername: usersTable.piUsername,
    })
    .from(productsTable)
    .leftJoin(
      categoriesTable,
      eq(productsTable.categoryId, categoriesTable.id),
    )
    .leftJoin(
      usersTable,
      eq(productsTable.sellerId, usersTable.id),
    )
    .where(eq(productsTable.id, id));

  if (!row) {
    res.status(404).json({
      error: "Product not found",
    });
    return;
  }

  res.json(
    toProduct(
      row.product,
      row.categoryName,
      row.sellerUsername,
    ),
  );
});

// POST /products
router.post(
  "/products",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      name,
      description,
      price,
      currency,
      stock,
      categoryId,
      imageUrls,
      tags,
    } = req.body as {
      name?: unknown;
      description?: unknown;
      price?: unknown;
      currency?: unknown;
      stock?: unknown;
      categoryId?: unknown;
      imageUrls?: unknown;
      tags?: unknown;
    };

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof description !== "string" ||
      !description.trim() ||
      price == null ||
      categoryId == null
    ) {
      res.status(400).json({
        error:
          "name, description, price, categoryId are required",
      });
      return;
    }

    const numericPrice =
      typeof price === "number"
        ? price
        : Number(price);

    const numericStock =
      stock == null
        ? 0
        : typeof stock === "number"
          ? stock
          : Number(stock);

    const numericCategoryId =
      typeof categoryId === "number"
        ? categoryId
        : Number(categoryId);

    if (
      !Number.isFinite(numericPrice) ||
      numericPrice <= 0
    ) {
      res.status(400).json({
        error: "price must be greater than 0",
      });
      return;
    }

    if (
      !Number.isInteger(numericStock) ||
      numericStock < 0
    ) {
      res.status(400).json({
        error: "stock must be a non-negative integer",
      });
      return;
    }

    if (
      !Number.isInteger(numericCategoryId) ||
      numericCategoryId <= 0
    ) {
      res.status(400).json({
        error: "Invalid categoryId",
      });
      return;
    }

    const [category] = await db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.id, numericCategoryId));

    if (!category) {
      res.status(400).json({
        error: "Category not found",
      });
      return;
    }

    const safeImageUrls = Array.isArray(imageUrls)
      ? imageUrls.filter(
          (value): value is string =>
            typeof value === "string",
        )
      : [];

    const safeTags = Array.isArray(tags)
      ? tags.filter(
          (value): value is string =>
            typeof value === "string",
        )
      : [];

    const [product] = await db
      .insert(productsTable)
      .values({
        name: name.trim(),
        description: description.trim(),
        price: String(numericPrice),
        currency:
          typeof currency === "string" &&
          currency.trim()
            ? currency.trim()
            : "Pi",
        stock: numericStock,
        categoryId: numericCategoryId,
        sellerId: req.user!.id,
        imageUrls: safeImageUrls,
        tags: safeTags,

        // A normal authenticated user must not be able
        // to make their own product featured.
        isFeatured: false,

        // New products always start as active.
        status: "active",
      })
      .returning();

    res.status(201).json(
      toProduct(
        product,
        category.name,
        req.user?.piUsername,
      ),
    );
  },
);

// PATCH /products/:id
router.patch(
  "/products/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;

    const id = parseInt(raw, 10);

    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({
        error: "Invalid product id",
      });
      return;
    }

    const [existing] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, id));

    if (!existing) {
      res.status(404).json({
        error: "Product not found",
      });
      return;
    }

    const isAdmin = req.user!.role === "admin";
    const isOwner = existing.sellerId === req.user!.id;

    if (!isAdmin && !isOwner) {
      res.status(403).json({
        error:
          "You do not have permission to edit this product",
      });
      return;
    }

    const {
      name,
      description,
      price,
      currency,
      stock,
      categoryId,
      imageUrls,
      tags,
      status,
      isFeatured,
    } = req.body as Record<string, unknown>;

    const update: Partial<
      typeof productsTable.$inferInsert
    > = {};

    if (name != null) {
      if (
        typeof name !== "string" ||
        !name.trim()
      ) {
        res.status(400).json({
          error: "name must be a non-empty string",
        });
        return;
      }

      update.name = name.trim();
    }

    if (description != null) {
      if (
        typeof description !== "string" ||
        !description.trim()
      ) {
        res.status(400).json({
          error:
            "description must be a non-empty string",
        });
        return;
      }

      update.description = description.trim();
    }

    if (price != null) {
      const numericPrice =
        typeof price === "number"
          ? price
          : Number(price);

      if (
        !Number.isFinite(numericPrice) ||
        numericPrice <= 0
      ) {
        res.status(400).json({
          error: "price must be greater than 0",
        });
        return;
      }

      update.price = String(numericPrice);
    }

    if (currency != null) {
      if (
        typeof currency !== "string" ||
        !currency.trim()
      ) {
        res.status(400).json({
          error: "currency must be a non-empty string",
        });
        return;
      }

      update.currency = currency.trim();
    }

    if (stock != null) {
      const numericStock =
        typeof stock === "number"
          ? stock
          : Number(stock);

      if (
        !Number.isInteger(numericStock) ||
        numericStock < 0
      ) {
        res.status(400).json({
          error: "stock must be a non-negative integer",
        });
        return;
      }

      update.stock = numericStock;
    }

    if (categoryId != null) {
      const numericCategoryId =
        typeof categoryId === "number"
          ? categoryId
          : Number(categoryId);

      if (
        !Number.isInteger(numericCategoryId) ||
        numericCategoryId <= 0
      ) {
        res.status(400).json({
          error: "Invalid categoryId",
        });
        return;
      }

      const [category] = await db
        .select()
        .from(categoriesTable)
        .where(
          eq(
            categoriesTable.id,
            numericCategoryId,
          ),
        );

      if (!category) {
        res.status(400).json({
          error: "Category not found",
        });
        return;
      }

      update.categoryId = numericCategoryId;
    }

    if (imageUrls != null) {
      if (!Array.isArray(imageUrls)) {
        res.status(400).json({
          error: "imageUrls must be an array",
        });
        return;
      }

      update.imageUrls = imageUrls.filter(
        (value): value is string =>
          typeof value === "string",
      );
    }

    if (tags != null) {
      if (!Array.isArray(tags)) {
        res.status(400).json({
          error: "tags must be an array",
        });
        return;
      }

      update.tags = tags.filter(
        (value): value is string =>
          typeof value === "string",
      );
    }

    // Only administrators can change moderation fields.
    if (status != null || isFeatured != null) {
      if (!isAdmin) {
        res.status(403).json({
          error:
            "Only administrators can change product status or featured state",
        });
        return;
      }

      if (status != null) {
        const allowedStatuses = [
          "active",
          "inactive",
          "sold_out",
        ];

        if (
          typeof status !== "string" ||
          !allowedStatuses.includes(status)
        ) {
          res.status(400).json({
            error: "Invalid product status",
            allowedStatuses,
          });
          return;
        }

        update.status = status;
      }

      if (isFeatured != null) {
        if (typeof isFeatured !== "boolean") {
          res.status(400).json({
            error: "isFeatured must be a boolean",
          });
          return;
        }

        update.isFeatured = isFeatured;
      }
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({
        error: "No valid fields to update",
      });
      return;
    }

    const [product] = await db
      .update(productsTable)
      .set(update)
      .where(eq(productsTable.id, id))
      .returning();

    if (!product) {
      res.status(404).json({
        error: "Product not found",
      });
      return;
    }

    const [category] = await db
      .select({
        name: categoriesTable.name,
      })
      .from(categoriesTable)
      .where(
        eq(
          categoriesTable.id,
          product.categoryId,
        ),
      );

    const [seller] = await db
      .select({
        piUsername: usersTable.piUsername,
      })
      .from(usersTable)
      .where(
        eq(usersTable.id, product.sellerId),
      );

    res.json(
      toProduct(
        product,
        category?.name,
        seller?.piUsername,
      ),
    );
  },
);

// DELETE /products/:id
router.delete(
  "/products/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;

    const id = parseInt(raw, 10);

    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({
        error: "Invalid product id",
      });
      return;
    }

    const [existing] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, id));

    if (!existing) {
      res.status(404).json({
        error: "Product not found",
      });
      return;
    }

    const isAdmin = req.user!.role === "admin";
    const isOwner = existing.sellerId === req.user!.id;

    if (!isAdmin && !isOwner) {
      res.status(403).json({
        error:
          "You do not have permission to delete this product",
      });
      return;
    }

    await db
      .delete(productsTable)
      .where(eq(productsTable.id, id));

    res.sendStatus(204);
  },
);

export default router;