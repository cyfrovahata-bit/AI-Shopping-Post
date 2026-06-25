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

  await db.exec(`PRAGMA foreign_keys = ON`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_social_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      page_id TEXT,
      page_name TEXT,
      open_id TEXT,
      instagram_user_id TEXT,
      instagram_username TEXT,
      expires_at INTEGER,
      refresh_expires_at INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, platform),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      shop_name TEXT,
      shop_description TEXT,
      shop_language TEXT DEFAULT 'uk',
      facebook_page_url TEXT,
      instagram_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

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
  await ensureColumn(db, "products", "videoUrl", "TEXT");
  await ensureColumn(db, "products", "videoPath", "TEXT");
  await ensureColumn(db, "products", "videoStyle", "TEXT DEFAULT 'fashion'");
  await ensureColumn(db, "products", "processedVideoUrl", "TEXT");
  await ensureColumn(db, "products", "processedVideoPath", "TEXT");
  await ensureColumn(db, "products", "useProcessedVideo", "INTEGER DEFAULT 1");
  await ensureColumn(db, "products", "generateVideo", "INTEGER DEFAULT 1");
  await ensureColumn(db, "products", "sizeSystem", "TEXT");
  await ensureColumn(db, "products", "shopName", "TEXT");
  await ensureColumn(db, "products", "shopDescription", "TEXT");
  await ensureColumn(db, "products", "shopLanguage", "TEXT");

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
        userId = COALESCE(userId, 'default'),
        videoStyle = COALESCE(videoStyle, 'fashion'),
        useProcessedVideo = COALESCE(useProcessedVideo, 1),
        generateVideo = COALESCE(generateVideo, 1)
    WHERE updatedAt IS NULL
      OR userId IS NULL
      OR videoStyle IS NULL
      OR useProcessedVideo IS NULL
      OR generateVideo IS NULL
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
