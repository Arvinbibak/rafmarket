import app from "./app.js";
import { db, categoriesTable } from "@workspace/db";
import { logger } from "./lib/logger.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

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

async function startServer(): Promise<void> {
  try {
    // Seed only missing slugs; this is safe across repeated and concurrent cold starts.
    const inserted = await db
      .insert(categoriesTable)
      .values(DEFAULT_CATEGORIES)
      .onConflictDoNothing({ target: categoriesTable.slug })
      .returning({ id: categoriesTable.id });

    if (inserted.length > 0) {
      logger.info({ count: inserted.length }, "Default marketplace categories seeded");
    }
  } catch (err) {
    logger.error({ err }, "Failed to seed default marketplace categories");
    process.exit(1);
    return;
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

void startServer();
