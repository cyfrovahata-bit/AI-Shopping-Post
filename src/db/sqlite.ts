import sqlite3 from "sqlite3";
import { open } from "sqlite";

async function ensureColumn(
  db: any,
  tableName: string,
  columnName: string,
  definition: string
) {
  const columns = await db.all(`PRAGMA table_info(${tableName})`);
  const exists = columns.some((column: any) => column.name === columnName);

  if (!exists) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export async function initDb() {
  const dbPath = process.env.DB_PATH || "./database.sqlite";

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      createdAt TEXT NOT NULL,
      title TEXT,
      price TEXT,
      dropPrice TEXT,
      sizes TEXT,
      colors TEXT,
      fabric TEXT,
      model TEXT,
      imageUrl TEXT,
      photoPath TEXT,
      generatedPost TEXT,
      telegramPublished INTEGER DEFAULT 0,
      telegramChatId TEXT,
      telegramMessageId TEXT
    )
  `);

  await ensureColumn(db, "products", "userId", "TEXT DEFAULT 'default'");
  await ensureColumn(db, "products", "updatedAt", "TEXT");
  await ensureColumn(db, "products", "description", "TEXT");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId INTEGER NOT NULL,
      imageUrl TEXT NOT NULL,
      photoPath TEXT NOT NULL,
      sortOrder INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS platform_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId INTEGER NOT NULL,
      platform TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      scheduledAt TEXT,
      publishedAt TEXT,
      externalPostId TEXT,
      externalChatId TEXT,
      errorMessage TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_product_images_product
      ON product_images(productId);

    CREATE INDEX IF NOT EXISTS idx_platform_posts_product
      ON platform_posts(productId);

    CREATE INDEX IF NOT EXISTS idx_platform_posts_schedule
      ON platform_posts(status, scheduledAt);
  `);

  const now = new Date().toISOString();

  await db.run(
    `
    UPDATE products
    SET updatedAt = COALESCE(updatedAt, createdAt, ?),
        userId = COALESCE(userId, 'default')
    WHERE updatedAt IS NULL OR userId IS NULL
    `,
    [now]
  );

  await db.run(`
    INSERT INTO product_images (productId, imageUrl, photoPath, sortOrder, createdAt)
    SELECT p.id, p.imageUrl, p.photoPath, 0, COALESCE(p.createdAt, datetime('now'))
    FROM products p
    WHERE p.imageUrl IS NOT NULL
      AND p.photoPath IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM product_images pi WHERE pi.productId = p.id
      )
  `);

  await db.run(
    `
    INSERT INTO platform_posts (
      productId,
      platform,
      text,
      status,
      publishedAt,
      externalPostId,
      externalChatId,
      createdAt,
      updatedAt
    )
    SELECT
      p.id,
      'telegram',
      p.generatedPost,
      CASE WHEN p.telegramPublished = 1 THEN 'published' ELSE 'draft' END,
      CASE WHEN p.telegramPublished = 1 THEN COALESCE(p.updatedAt, p.createdAt) ELSE NULL END,
      p.telegramMessageId,
      p.telegramChatId,
      COALESCE(p.createdAt, ?),
      COALESCE(p.updatedAt, p.createdAt, ?)
    FROM products p
    WHERE p.generatedPost IS NOT NULL
      AND p.generatedPost != ''
      AND NOT EXISTS (
        SELECT 1
        FROM platform_posts pp
        WHERE pp.productId = p.id AND pp.platform = 'telegram'
      )
    `,
    [now, now]
  );

  return db;
}
