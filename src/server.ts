import dotenv from "dotenv";
import express, { Request, Response } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";

import { generatePlatformPost, generatePostsForPlatforms } from "./ai-generator";
import { initDb } from "./db/sqlite";
import { editTelegramPost } from "./telegram";
import { enabledPlatformIds, isPlatformId } from "./platforms";
import { PlatformId, ProductInput } from "./platform-types";
import { publishPlatformPost, startScheduler } from "./scheduler";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const upload = multer({ storage });
const uploadPhotos = upload.array("photos", 6);
const uploadCompat = upload.fields([
  { name: "photos", maxCount: 6 },
  { name: "photo", maxCount: 1 },
]);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsDir));
app.get("/products", (_req: Request, res: Response) => {
  res.redirect("/products.html");
});
app.get("/products/", (_req: Request, res: Response) => {
  res.redirect("/products.html");
});
app.use(express.static(path.join(__dirname, "../public")));

function toText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePlatforms(value: unknown): PlatformId[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.startsWith("[")
        ? JSON.parse(value)
        : value.split(",")
      : [];
  const platforms = (rawValues as unknown[])
    .map((item: unknown) => String(item).trim())
    .filter(isPlatformId)
    .filter((platform: PlatformId) => enabledPlatformIds.includes(platform));

  return platforms.length ? Array.from(new Set(platforms)) : ["telegram"];
}

function getUploadedFiles(req: Request) {
  if (Array.isArray(req.files)) {
    return req.files;
  }

  const groupedFiles = req.files as
    | Record<string, Express.Multer.File[]>
    | undefined;

  return [
    ...(groupedFiles?.photos || []),
    ...(groupedFiles?.photo || []),
  ].slice(0, 6);
}

function filesToImages(files: Express.Multer.File[]) {
  return files.map((file, index) => ({
    imageUrl: `/uploads/${file.filename}`,
    photoPath: file.path,
    sortOrder: index,
  }));
}

function productInputFromBody(
  body: Record<string, unknown>,
  images: { imageUrl: string; photoPath: string }[]
): ProductInput {
  return {
    title: toText(body.title),
    model: toText(body.model),
    price: toText(body.price),
    dropPrice: toText(body.dropPrice),
    sizes: toText(body.sizes),
    colors: toText(body.colors),
    fabric: toText(body.fabric),
    description: toText(body.description),
    imageUrls: images.map((image) => image.imageUrl),
    photoPaths: images.map((image) => image.photoPath),
  };
}

async function getImages(db: any, productId: number) {
  return db.all(
    `
    SELECT *
    FROM product_images
    WHERE productId = ?
    ORDER BY sortOrder ASC, id ASC
    `,
    [productId]
  );
}

async function getPlatformPosts(db: any, productId: number) {
  return db.all(
    `
    SELECT *
    FROM platform_posts
    WHERE productId = ?
    ORDER BY id ASC
    `,
    [productId]
  );
}

async function getProductDetails(db: any, productId: number) {
  const product = await db.get(`SELECT * FROM products WHERE id = ?`, [productId]);

  if (!product) {
    return null;
  }

  return {
    product,
    images: await getImages(db, productId),
    platformPosts: await getPlatformPosts(db, productId),
  };
}

async function insertProduct(
  db: any,
  product: ProductInput,
  images: { imageUrl: string; photoPath: string; sortOrder: number }[],
  platformIds: PlatformId[]
) {
  const now = new Date().toISOString();
  const generatedPosts = await generatePostsForPlatforms(product, platformIds);
  const telegramDraft = generatedPosts.find((post) => post.platform === "telegram");
  const firstImage = images[0];
  const result = await db.run(
    `
    INSERT INTO products (
      userId,
      createdAt,
      updatedAt,
      title,
      model,
      price,
      dropPrice,
      sizes,
      colors,
      fabric,
      description,
      imageUrl,
      photoPath,
      generatedPost,
      telegramPublished,
      telegramChatId,
      telegramMessageId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
    `,
    [
      "default",
      now,
      now,
      product.title,
      product.model,
      product.price,
      product.dropPrice,
      product.sizes,
      product.colors,
      product.fabric,
      product.description,
      firstImage?.imageUrl || null,
      firstImage?.photoPath || null,
      telegramDraft?.text || null,
    ]
  );
  const productId = result.lastID;

  for (const image of images) {
    await db.run(
      `
      INSERT INTO product_images (productId, imageUrl, photoPath, sortOrder, createdAt)
      VALUES (?, ?, ?, ?, ?)
      `,
      [productId, image.imageUrl, image.photoPath, image.sortOrder, now]
    );
  }

  for (const post of generatedPosts) {
    await db.run(
      `
      INSERT INTO platform_posts (
        productId,
        platform,
        text,
        status,
        createdAt,
        updatedAt
      ) VALUES (?, ?, ?, 'draft', ?, ?)
      `,
      [productId, post.platform, post.text, now, now]
    );
  }

  return productId;
}

async function updateProductFields(db: any, productId: number, body: any) {
  const now = new Date().toISOString();

  await db.run(
    `
    UPDATE products
    SET title = ?,
        model = ?,
        price = ?,
        dropPrice = ?,
        sizes = ?,
        colors = ?,
        fabric = ?,
        description = ?,
        updatedAt = ?
    WHERE id = ?
    `,
    [
      toText(body.title),
      toText(body.model),
      toText(body.price),
      toText(body.dropPrice),
      toText(body.sizes),
      toText(body.colors),
      toText(body.fabric),
      toText(body.description),
      now,
      productId,
    ]
  );
}

async function startServer() {
  const db = await initDb();

  startScheduler(db);

  app.post(
    "/api/posts/preview",
    uploadPhotos,
    async (req: Request, res: Response) => {
      try {
        const files = getUploadedFiles(req);

        if (!files.length) {
          return res.status(400).json({
            success: false,
            message: "Завантаж хоча б одне фото товару",
          });
        }

        const images = filesToImages(files);
        const product = productInputFromBody(req.body, images);
        const platformIds = parsePlatforms(req.body.selectedPlatforms);
        const productId = await insertProduct(db, product, images, platformIds);
        const details = await getProductDetails(db, productId);

        return res.json({
          success: true,
          ...details,
          productId,
        });
      } catch (error) {
        console.error("Preview error:", error);

        return res.status(500).json({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Помилка генерації попереднього перегляду",
        });
      }
    }
  );

  app.post(
    "/api/posts/:productId/regenerate",
    async (req: Request, res: Response) => {
      try {
        const productId = Number(req.params.productId);
        const details = await getProductDetails(db, productId);

        if (!details) {
          return res.status(404).json({
            success: false,
            message: "Товар не знайдено",
          });
        }

        await updateProductFields(db, productId, {
          ...details.product,
          ...req.body,
        });

        const nextDetails = await getProductDetails(db, productId);
        const platformIds = parsePlatforms(
          req.body.platforms || req.body.platform || req.body.selectedPlatforms
        );
        const product = productInputFromBody(
          nextDetails!.product,
          nextDetails!.images
        );
        const now = new Date().toISOString();
        const updatedPosts = [];

        for (const platform of platformIds) {
          const text = await generatePlatformPost(product, platform);
          const existing = nextDetails!.platformPosts.find(
            (post: any) => post.platform === platform
          );

          if (existing) {
            await db.run(
              `
              UPDATE platform_posts
              SET text = ?,
                  status = CASE WHEN status = 'published' THEN status ELSE 'draft' END,
                  errorMessage = NULL,
                  updatedAt = ?
              WHERE id = ?
              `,
              [text, now, existing.id]
            );
          } else {
            await db.run(
              `
              INSERT INTO platform_posts (
                productId,
                platform,
                text,
                status,
                createdAt,
                updatedAt
              ) VALUES (?, ?, ?, 'draft', ?, ?)
              `,
              [productId, platform, text, now, now]
            );
          }

          updatedPosts.push(platform);
        }

        const responseDetails = await getProductDetails(db, productId);

        return res.json({
          success: true,
          updatedPosts,
          ...responseDetails,
        });
      } catch (error) {
        console.error("Regenerate error:", error);

        return res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : "Помилка перегенерації",
        });
      }
    }
  );

  app.put("/api/platform-posts/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const post = await db.get(`SELECT * FROM platform_posts WHERE id = ?`, [id]);

      if (!post) {
        return res.status(404).json({
          success: false,
          message: "Пост платформи не знайдено",
        });
      }

      const text = toText(req.body.text) || post.text;
      const status = toText(req.body.status) || post.status;
      const scheduledAt = req.body.scheduledAt
        ? new Date(String(req.body.scheduledAt)).toISOString()
        : null;
      const now = new Date().toISOString();

      await db.run(
        `
        UPDATE platform_posts
        SET text = ?,
            status = ?,
            scheduledAt = ?,
            errorMessage = NULL,
            updatedAt = ?
        WHERE id = ?
        `,
        [text, status, scheduledAt, now, id]
      );

      if (
        post.platform === "telegram" &&
        post.status === "published" &&
        post.externalChatId &&
        post.externalPostId
      ) {
        await editTelegramPost(text, post.externalChatId, post.externalPostId);
      }

      const updated = await db.get(`SELECT * FROM platform_posts WHERE id = ?`, [
        id,
      ]);

      return res.json({
        success: true,
        platformPost: updated,
      });
    } catch (error) {
      console.error("Update platform post error:", error);

      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Помилка оновлення поста платформи",
      });
    }
  });

  app.post("/api/platform-posts/:id/publish", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);

      if (req.body.text) {
        await db.run(
          `
          UPDATE platform_posts
          SET text = ?,
              updatedAt = ?
          WHERE id = ?
          `,
          [toText(req.body.text), new Date().toISOString(), id]
        );
      }

      const result = await publishPlatformPost(db, id);
      const platformPost = await db.get(`SELECT * FROM platform_posts WHERE id = ?`, [
        id,
      ]);

      return res.json({
        success: true,
        result,
        platformPost,
      });
    } catch (error) {
      console.error("Publish platform post error:", error);

      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Помилка публікації",
      });
    }
  });

  app.post("/api/products/:id/publish", async (req: Request, res: Response) => {
    try {
      const productId = Number(req.params.id);
      const platformIds = parsePlatforms(req.body.platforms || req.body.platform);
      const posts = await getPlatformPosts(db, productId);
      const results = [];

      for (const platform of platformIds) {
        const post = posts.find((item: any) => item.platform === platform);

        if (!post) {
          throw new Error(`Для платформи ${platform} немає згенерованого поста`);
        }

        results.push({
          platform,
          result: await publishPlatformPost(db, post.id),
        });
      }

      return res.json({
        success: true,
        results,
        ...(await getProductDetails(db, productId)),
      });
    } catch (error) {
      console.error("Publish product error:", error);

      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Помилка публікації",
      });
    }
  });

  app.get("/api/products", async (req: Request, res: Response) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const query = toText(req.query.query);
    const platform = toText(req.query.platform);
    const status = toText(req.query.status);

    if (query) {
      where.push(`(LOWER(p.title) LIKE ? OR LOWER(p.model) LIKE ?)`);
      params.push(`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`);
    }

    if (platform && isPlatformId(platform)) {
      where.push(
        `EXISTS (SELECT 1 FROM platform_posts pp WHERE pp.productId = p.id AND pp.platform = ?)`
      );
      params.push(platform);
    }

    if (status) {
      where.push(
        `EXISTS (SELECT 1 FROM platform_posts pp WHERE pp.productId = p.id AND pp.status = ?)`
      );
      params.push(status);
    }

    const products = await db.all(
      `
      SELECT p.*
      FROM products p
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.id DESC
      `,
      params
    );

    const hydrated = await Promise.all(
      products.map(async (product: any) => ({
        ...product,
        images: await getImages(db, product.id),
        platformPosts: await getPlatformPosts(db, product.id),
      }))
    );

    return res.json({
      success: true,
      products: hydrated,
    });
  });

  app.get("/api/products/:id", async (req: Request, res: Response) => {
    const productId = Number(req.params.id);
    const details = await getProductDetails(db, productId);

    if (!details) {
      return res.status(404).json({
        success: false,
        message: "Товар не знайдено",
      });
    }

    return res.json({
      success: true,
      ...details,
    });
  });

  app.put("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const productId = Number(req.params.id);
      const details = await getProductDetails(db, productId);

      if (!details) {
        return res.status(404).json({
          success: false,
          message: "Товар не знайдено",
        });
      }

      await updateProductFields(db, productId, {
        ...details.product,
        ...req.body,
      });

      return res.json({
        success: true,
        ...(await getProductDetails(db, productId)),
      });
    } catch (error) {
      console.error("Update product error:", error);

      return res.status(500).json({
        success: false,
        message: "Помилка оновлення товару",
      });
    }
  });

  app.post("/preview-post", uploadCompat, async (req: Request, res: Response) => {
    try {
      const files = getUploadedFiles(req);

      if (!files.length) {
        return res.status(400).json({
          success: false,
          message: "Фото не завантажено",
        });
      }

      const images = filesToImages(files);
      const product = productInputFromBody(req.body, images);
      const productId = await insertProduct(db, product, images, ["telegram"]);
      const details = await getProductDetails(db, productId);
      const telegramPost = details!.platformPosts.find(
        (post: any) => post.platform === "telegram"
      );

      return res.json({
        success: true,
        productId,
        generatedText: telegramPost?.text || "",
        imageUrl: details!.images[0]?.imageUrl,
        photoPath: details!.images[0]?.photoPath,
        product: details!.product,
      });
    } catch (error) {
      console.error("Legacy preview error:", error);

      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Помилка генерації",
      });
    }
  });

  app.post("/publish-preview", async (req: Request, res: Response) => {
    try {
      const productId = Number(req.body.productId);
      const text = toText(req.body.text);

      if (!productId || !text) {
        return res.status(400).json({
          success: false,
          message: "Немає productId або тексту для публікації",
        });
      }

      const posts = await getPlatformPosts(db, productId);
      const telegramPost = posts.find((post: any) => post.platform === "telegram");

      if (!telegramPost) {
        return res.status(400).json({
          success: false,
          message: "Для товару немає Telegram-поста",
        });
      }

      await db.run(
        `
        UPDATE platform_posts
        SET text = ?,
            updatedAt = ?
        WHERE id = ?
        `,
        [text, new Date().toISOString(), telegramPost.id]
      );

      await publishPlatformPost(db, telegramPost.id);

      return res.json({ success: true });
    } catch (error) {
      console.error("Legacy publish error:", error);

      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Помилка публікації",
      });
    }
  });

  app.get("/products-api", async (_req: Request, res: Response) => {
    const products = await db.all(`
      SELECT *
      FROM products
      ORDER BY id DESC
    `);

    return res.json({
      success: true,
      products,
    });
  });

  app.put("/products-api/:id", async (req: Request, res: Response) => {
    try {
      const productId = Number(req.params.id);
      const details = await getProductDetails(db, productId);

      if (!details) {
        return res.status(404).json({
          success: false,
          message: "Товар не знайдено",
        });
      }

      await updateProductFields(db, productId, {
        ...details.product,
        ...req.body,
      });

      const telegramPost = details.platformPosts.find(
        (post: any) => post.platform === "telegram"
      );

      if (telegramPost && req.body.generatedPost) {
        await db.run(
          `
          UPDATE platform_posts
          SET text = ?,
              updatedAt = ?
          WHERE id = ?
          `,
          [toText(req.body.generatedPost), new Date().toISOString(), telegramPost.id]
        );
      }

      if (
        telegramPost?.status === "published" &&
        telegramPost.externalChatId &&
        telegramPost.externalPostId
      ) {
        await editTelegramPost(
          toText(req.body.generatedPost),
          telegramPost.externalChatId,
          telegramPost.externalPostId
        );
      }

      return res.json({
        success: true,
        message: "Збережено. Якщо Telegram-пост був опублікований, caption оновлено.",
      });
    } catch (error) {
      console.error("Legacy update product error:", error);

      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Помилка оновлення товару або Telegram-поста",
      });
    }
  });

  app.listen(PORT, () => {
    console.log(`Server started: http://localhost:${PORT}`);
  });
}

startServer();
