import dotenv from "dotenv";
import express, { Request, Response } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";

import {
  generatePlatformPost,
  generatePostsForPlatforms,
  generateVideoTexts,
} from "./ai-generator";
import { initDb } from "./db/sqlite";
import { editTelegramPost } from "./telegram";
import { enabledPlatformIds, isPlatformId } from "./platforms";
import { PlatformId, ProductInput } from "./platform-types";
import { publishPlatformPost, startScheduler } from "./scheduler";
import {
  createReelsStyleVideo,
  filePathToPublicUrl,
} from "./video-overlay";
import {
  buildAuthUrl,
  completeFacebookOAuth,
  selectFacebookPage,
  getFacebookStatus,
} from "./facebook-auth";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");

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
  { name: "video", maxCount: 1 },
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

function getUploadedVideo(req: Request) {
  if (Array.isArray(req.files)) {
    return undefined;
  }

  const groupedFiles = req.files as
    | Record<string, Express.Multer.File[]>
    | undefined;

  return groupedFiles?.video?.[0];
}

function filesToImages(files: Express.Multer.File[]) {
  return files.map((file, index) => ({
    imageUrl: `/uploads/${file.filename}`,
    photoPath: file.path,
    sortOrder: index,
  }));
}

function fileToVideo(file?: Express.Multer.File) {
  if (!file) {
    return {};
  }

  return {
    videoUrl: `/uploads/${file.filename}`,
    videoPath: file.path,
  };
}

function productInputFromBody(
  body: Record<string, unknown>,
  images: { imageUrl: string; photoPath: string }[],
  video?: { videoUrl?: string; videoPath?: string }
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
    videoUrl: video?.videoUrl || toText(body.videoUrl) || undefined,
    videoPath: video?.videoPath || toText(body.videoPath) || undefined,

    videoStyle: toText(body.videoStyle) || "fashion",
    processedVideoUrl: toText(body.processedVideoUrl) || undefined,
    processedVideoPath: toText(body.processedVideoPath) || undefined,
    generateVideo: body.generateVideo !== "off" && body.generateVideo !== "0",
    useProcessedVideo: body.useProcessedVideo !== "0" && body.useProcessedVideo !== false,
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
      videoUrl,
      videoPath,
      videoStyle,
      processedVideoUrl,
      processedVideoPath,
      useProcessedVideo,
      generateVideo,
      generatedPost,
      telegramPublished,
      telegramChatId,
      telegramMessageId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
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
      product.videoUrl || null,
      product.videoPath || null,
      product.videoStyle || "fashion",
      product.processedVideoUrl || null,
      product.processedVideoPath || null,
      product.useProcessedVideo === false ? 0 : 1,
      product.generateVideo === false ? 0 : 1,
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
        videoStyle = ?,
        useProcessedVideo = ?,
        generateVideo = ?,
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
      toText(body.videoStyle) || "fashion",
      body.useProcessedVideo === "0" || body.useProcessedVideo === false ? 0 : 1,
      body.generateVideo === "off" || body.generateVideo === "0" ? 0 : 1,
      now,
      productId,
    ]
  );
}

async function generateProcessedVideo(product: ProductInput) {
  if (!product.videoPath || product.generateVideo === false) {
    return null;
  }

  const videoTexts = await generateVideoTexts(product);

  const processedVideo = await createReelsStyleVideo({
    inputPath: product.videoPath,
    uploadsDir,
    videoTexts,
    videoStyle: product.videoStyle as any,
  });

  return {
    processedVideoPath: processedVideo.outputPath,
    processedVideoUrl: filePathToPublicUrl(processedVideo.outputPath),
  };
}

async function startServer() {
  const db = await initDb();

  startScheduler(db);

  app.post(
    "/api/posts/preview",
    uploadCompat,
    async (req: Request, res: Response) => {
      try {
        const files = getUploadedFiles(req);
        const video = fileToVideo(getUploadedVideo(req));

        if (!files.length && !video.videoUrl) {
          return res.status(400).json({
            success: false,
            message: "Завантаж хоча б одне фото або відео товару",
          });
        }

        const images = filesToImages(files);
        const product = productInputFromBody(req.body, images, video);
        const platformIds = parsePlatforms(req.body.selectedPlatforms);
        const productId = await insertProduct(db, product, images, platformIds);

        const processedVideo = await generateProcessedVideo(product);

        if (processedVideo) {
          await db.run(
            `
            UPDATE products
            SET processedVideoPath = ?,
                processedVideoUrl = ?,
                useProcessedVideo = 1,
                updatedAt = ?
            WHERE id = ?
            `,
            [
              processedVideo.processedVideoPath,
              processedVideo.processedVideoUrl,
              new Date().toISOString(),
              productId,
            ]
          );
        }

        const details = await getProductDetails(db, productId);

        return res.json({
          success: true,
          ...details,
          productId,
        });
      } catch (error) {
        console.error("Preview error:", error);
        const raw = error instanceof Error ? error.message : String(error);
        const friendly = raw.includes("API key") || raw.includes("401") || raw.includes("403")
          ? "OpenAI: недійсний або прострочений API-ключ. Перевір OPENAI_API_KEY у .env"
          : raw.includes("rate") || raw.includes("429")
            ? "OpenAI: перевищено ліміт запитів. Спробуй через хвилину."
            : raw.includes("JSON") || raw.includes("parse") || raw.includes("Unexpected")
              ? `Помилка розбору відповіді AI: ${raw.slice(0, 120)}`
              : raw || "Помилка генерації попереднього перегляду";
        return res.status(500).json({ success: false, message: friendly });
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
          nextDetails!.images,
          {
            videoUrl: nextDetails!.product.videoUrl,
            videoPath: nextDetails!.product.videoPath,
          }
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

      const extras = req.body.extras && typeof req.body.extras === "object"
        ? req.body.extras as Record<string, unknown>
        : undefined;
      const result = await publishPlatformPost(db, id, extras);
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
      const video = fileToVideo(getUploadedVideo(req));

      if (!files.length && !video.videoUrl) {
        return res.status(400).json({
          success: false,
          message: "Завантаж хоча б одне фото або відео товару",
        });
      }

      const images = filesToImages(files);
      const product = productInputFromBody(req.body, images, video);
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

  // ── Facebook OAuth ─────────────────────────────────────────────────────────

  // GET /api/facebook/status — current token info
  app.get("/api/facebook/status", (_req: Request, res: Response) => {
    res.json(getFacebookStatus());
  });

  // GET /auth/facebook — start OAuth (requires ?appId=&appSecret= or they're in .env)
  app.get("/auth/facebook", (req: Request, res: Response) => {
    const appId = (req.query.appId as string) || process.env.FACEBOOK_APP_ID || "";
    const appSecret = (req.query.appSecret as string) || process.env.FACEBOOK_APP_SECRET || "";
    if (!appId || !appSecret) {
      return res.status(400).send("Потрібні App ID та App Secret. Введи їх на сторінці налаштувань.");
    }
    const redirectUri = `http://localhost:${PORT}/auth/facebook/callback`;
    const state = Buffer.from(JSON.stringify({ appId, appSecret })).toString("base64");
    const url = buildAuthUrl({ appId, appSecret, redirectUri }, state);
    // Save for callback
    (req as any).session = { appId, appSecret };
    res.redirect(url);
  });

  // GET /auth/facebook/callback — Facebook redirects here after user approves
  app.get("/auth/facebook/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;

    if (error) {
      return res.redirect(`/setup.html?fbError=${encodeURIComponent(req.query.error_description as string || error)}`);
    }
    if (!code || !state) {
      return res.redirect("/setup.html?fbError=missing_code");
    }

    try {
      const { appId, appSecret } = JSON.parse(Buffer.from(state, "base64").toString());
      const redirectUri = `http://localhost:${PORT}/auth/facebook/callback`;
      const { pages } = await completeFacebookOAuth({ appId, appSecret, redirectUri }, code);

      if (pages.length === 1) {
        const result = await selectFacebookPage(pages[0].id);
        const igPart = result.instagram ? `&igId=${result.instagram.id}&igName=${encodeURIComponent(result.instagram.username || "")}` : "";
        return res.redirect(`/setup.html?fbSuccess=1&pageId=${pages[0].id}&pageName=${encodeURIComponent(pages[0].name)}${igPart}`);
      }

      const pagesParam = encodeURIComponent(JSON.stringify(pages));
      res.redirect(`/setup.html?choosePage=1&pages=${pagesParam}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.redirect(`/setup.html?fbError=${encodeURIComponent(msg)}`);
    }
  });

  // POST /api/facebook/select-page — user picks a page
  app.post("/api/facebook/select-page", async (req: Request, res: Response) => {
    const { pageId } = req.body as { pageId: string };
    try {
      const result = await selectFacebookPage(pageId);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, message: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/facebook/save-app — save App ID + App Secret without starting OAuth
  app.post("/api/facebook/save-app", (req: Request, res: Response) => {
    const { appId, appSecret } = req.body as { appId: string; appSecret: string };
    if (!appId || !appSecret) return res.status(400).json({ success: false, message: "Потрібні App ID та App Secret" });
    if (!/^\d+$/.test(appId)) return res.status(400).json({ success: false, message: "App ID повинен містити тільки цифри" });
    if (appSecret.length < 20) return res.status(400).json({ success: false, message: "App Secret занадто короткий" });
    const { writeEnvVars } = require("./facebook-auth");
    writeEnvVars({ FACEBOOK_APP_ID: appId, FACEBOOK_APP_SECRET: appSecret });
    res.json({ success: true });
  });

  // POST /api/facebook/verify — test if current tokens actually work
  app.post("/api/facebook/verify", async (_req: Request, res: Response) => {
    const status = getFacebookStatus();
    if (!status.connected) return res.json({ ok: false, reason: "not_connected" });
    try {
      const token = process.env.FACEBOOK_ACCESS_TOKEN || "";
      const pageId = process.env.FACEBOOK_PAGE_ID || "";
      const r = await fetch(`https://graph.facebook.com/v25.0/${pageId}?fields=name,fan_count&access_token=${token}`);
      const d = await r.json() as any;
      if (d.error) return res.json({ ok: false, reason: d.error.message });
      res.json({ ok: true, pageName: d.name, fans: d.fan_count });
    } catch (e) {
      res.json({ ok: false, reason: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Telegram setup ─────────────────────────────────────────────────────────

  app.get("/api/telegram/status", async (_req: Request, res: Response) => {
    const token = process.env.BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token) return res.json({ connected: false, hasChatId: !!chatId });
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const d = await r.json() as any;
      if (d.ok) res.json({ connected: true, username: d.result.username, firstName: d.result.first_name, hasChatId: !!chatId, chatId });
      else res.json({ connected: false, hasChatId: !!chatId, error: d.description });
    } catch (e) { res.json({ connected: false, hasChatId: !!chatId }); }
  });

  app.post("/api/telegram/save", (req: Request, res: Response) => {
    const { token, chatId } = req.body as { token?: string; chatId?: string };
    if (token && !token.includes(":")) return res.status(400).json({ success: false, message: "Невірний формат токена — має бути: 1234567890:ABCdef..." });
    const { writeEnvVars } = require("./facebook-auth");
    const vars: Record<string,string> = {};
    if (token) vars.BOT_TOKEN = token;
    if (chatId) vars.TELEGRAM_CHAT_ID = chatId;
    writeEnvVars(vars);
    res.json({ success: true });
  });

  // ── Shafa setup ───────────────────────────────────────────────────────────

  app.get("/api/shafa/status", (_req: Request, res: Response) => {
    const email = process.env.SHAFA_EMAIL;
    const password = process.env.SHAFA_PASSWORD;
    const sessionPath = process.env.SHAFA_SESSION_PATH || "./shafa-session.json";
    let sessionValid = false;
    try {
      const s = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
      sessionValid = Array.isArray(s) && s.length > 0;
    } catch { /**/ }
    res.json({ hasCredentials: !!(email && password), email: email || "", sessionValid });
  });

  app.post("/api/shafa/save", (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ success: false, message: "Потрібні email та пароль" });
    if (!email.includes("@")) return res.status(400).json({ success: false, message: "Невірний формат email" });
    const { writeEnvVars } = require("./facebook-auth");
    writeEnvVars({ SHAFA_EMAIL: email, SHAFA_PASSWORD: password });
    res.json({ success: true });
  });

  // ── Site URL ───────────────────────────────────────────────────────────────

  app.get("/api/site-url", (_req: Request, res: Response) => {
    res.json({ url: process.env.SITE_URL || "" });
  });

  app.post("/api/site-url", (req: Request, res: Response) => {
    const { url } = req.body as { url: string };
    const { writeEnvVars } = require("./facebook-auth");
    writeEnvVars({ SITE_URL: url || "" });
    res.json({ success: true });
  });

  // ── Prom.ua setup ─────────────────────────────────────────────────────────

  app.get("/api/prom/status", async (_req: Request, res: Response) => {
    const { promTestConnection } = await import("./prom");
    const hasToken = !!process.env.PROM_API_TOKEN;
    if (!hasToken) return res.json({ connected: false, hasToken: false });
    const result = await promTestConnection();
    res.json({ connected: result.ok, hasToken, shopName: result.shopName, error: result.error });
  });

  app.post("/api/prom/save", (req: Request, res: Response) => {
    const { token } = req.body as { token: string };
    if (!token || token.length < 10) return res.status(400).json({ success: false, message: "Токен занадто короткий" });
    const { writeEnvVars } = require("./facebook-auth");
    writeEnvVars({ PROM_API_TOKEN: token });
    res.json({ success: true });
  });

  app.post("/api/prom/verify", async (_req: Request, res: Response) => {
    const { promTestConnection } = await import("./prom");
    const result = await promTestConnection();
    res.json(result);
  });

  app.get("/api/prom/categories", async (req: Request, res: Response) => {
    const { promSearchCategories } = await import("./prom");
    const q = String(req.query.q || "");
    if (!q || q.length < 2) return res.json({ categories: [] });
    const cats = await promSearchCategories(q);
    res.json({ categories: cats });
  });

  app.post("/api/prom/set-default-category", (req: Request, res: Response) => {
    const { categoryId, categoryName } = req.body as { categoryId: number; categoryName: string };
    if (!categoryId) return res.status(400).json({ success: false, message: "categoryId required" });
    const { writeEnvVars } = require("./facebook-auth");
    writeEnvVars({ PROM_DEFAULT_CATEGORY_ID: String(categoryId), PROM_DEFAULT_CATEGORY_NAME: categoryName || "" });
    res.json({ success: true });
  });

  // ── OLX ─────────────────────────────────────────────────────────────────────

  app.get("/api/olx/status", async (_req: Request, res: Response) => {
    const { olxTestConnection } = await import("./olx");
    const hasToken = !!process.env.OLX_ACCESS_TOKEN;
    const hasCredentials = !!(process.env.OLX_CLIENT_ID && process.env.OLX_CLIENT_SECRET);
    if (!hasToken) return res.json({ connected: false, hasToken: false, hasCredentials });
    const result = await olxTestConnection();
    res.json({ connected: result.ok, hasToken, hasCredentials, name: result.name, error: result.error });
  });

  app.post("/api/olx/save-credentials", (req: Request, res: Response) => {
    const { clientId, clientSecret } = req.body as { clientId: string; clientSecret: string };
    if (!clientId || !clientSecret) return res.status(400).json({ success: false, message: "Потрібні Client ID і Client Secret" });
    const { writeEnvVars } = require("./facebook-auth");
    const siteUrl = process.env.SITE_URL || "http://localhost:3000";
    writeEnvVars({
      OLX_CLIENT_ID: clientId,
      OLX_CLIENT_SECRET: clientSecret,
      OLX_REDIRECT_URI: `${siteUrl}/auth/olx/callback`,
    });
    res.json({ success: true });
  });

  app.get("/auth/olx", (_req: Request, res: Response) => {
    const { getOlxAuthUrl } = require("./olx");
    const url = getOlxAuthUrl();
    res.redirect(url);
  });

  app.get("/auth/olx/callback", async (req: Request, res: Response) => {
    const { code, error } = req.query as { code?: string; error?: string };
    if (error || !code) {
      return res.redirect(`/setup.html?tab=olx&olxError=${encodeURIComponent(error || "no code")}`);
    }
    try {
      const { completeOlxOAuth } = await import("./olx");
      await completeOlxOAuth(code);
      res.redirect("/setup.html?tab=olx&olxSuccess=1");
    } catch (e) {
      res.redirect(`/setup.html?tab=olx&olxError=${encodeURIComponent((e as Error).message)}`);
    }
  });

  // ── ROZETKA ───────────────────────────────────────────────────────────────────

  app.get("/api/rozetka/status", async (_req: Request, res: Response) => {
    const { rozetkaTestConnection } = await import("./rozetka");
    const hasToken = !!process.env.ROZETKA_ACCESS_TOKEN;
    const hasCredentials = !!(process.env.ROZETKA_LOGIN && process.env.ROZETKA_PASSWORD);
    if (!hasToken && !hasCredentials) return res.json({ connected: false, hasToken: false, hasCredentials: false });
    const result = await rozetkaTestConnection();
    res.json({ connected: result.ok, hasToken, hasCredentials, shopName: result.shopName, error: result.error });
  });

  app.post("/api/rozetka/save", (req: Request, res: Response) => {
    const { login, password } = req.body as { login: string; password: string };
    if (!login || !password) return res.status(400).json({ success: false, message: "Потрібні логін і пароль" });
    const { writeEnvVars } = require("./facebook-auth");
    writeEnvVars({ ROZETKA_LOGIN: login, ROZETKA_PASSWORD: password });
    res.json({ success: true });
  });

  app.post("/api/rozetka/verify", async (_req: Request, res: Response) => {
    try {
      const { rozetkaLogin, rozetkaTestConnection } = await import("./rozetka");
      await rozetkaLogin();
      const result = await rozetkaTestConnection();
      res.json(result);
    } catch (e) {
      res.json({ ok: false, error: (e as Error).message });
    }
  });

  // ── End Facebook OAuth ──────────────────────────────────────────────────────

  app.listen(PORT, () => {
    console.log(`Server started: http://localhost:${PORT}`);
  });
}

startServer();
