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
  selectFacebookPageManual,
  getFacebookStatus,
  readEnv,
  writeEnvVars,
} from "./facebook-auth";
import {
  buildInstagramAuthUrl,
  completeInstagramOAuth,
  getInstagramStatus,
} from "./instagram-auth";
import { authMiddleware, hashPassword, verifyPassword, signToken, extractTokenFromQuery, extractOptionalAuth } from "./auth";
import { saveUserToken, deleteUserToken, getUserSocialStatus } from "./user-tokens";

dotenv.config();
// On Railway: load persisted tokens from Volume (survives container restarts)
if (fs.existsSync("/data/.env")) dotenv.config({ path: "/data/.env", override: true });

// Auto-fix: if INSTAGRAM_ACCESS_TOKEN is the page token, replace with user token
// (NPE Facebook pages require user token for Instagram Graph API)
{
  const env = readEnv();
  const userToken = env.FACEBOOK_USER_TOKEN || process.env.FACEBOOK_USER_TOKEN || "";
  const pageToken = env.FACEBOOK_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN || "";
  const igToken = env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN || "";
  const igId = env.INSTAGRAM_USER_ID || process.env.INSTAGRAM_USER_ID || "";
  if (igId && userToken && igToken === pageToken && pageToken) {
    writeEnvVars({ INSTAGRAM_ACCESS_TOKEN: userToken });
    console.log("[startup] Auto-fixed INSTAGRAM_ACCESS_TOKEN to user token for NPE page");
  }
}

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

const upload = multer({ storage, limits: { fileSize: 300 * 1024 * 1024 } }); // 300 MB max
const uploadPhotos = upload.array("photos", 6);
const uploadCompat = upload.fields([
  { name: "photos", maxCount: 6 },
  { name: "photo", maxCount: 1 },
  { name: "video", maxCount: 1 },
]);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsDir));

// ── Auth routes (public) ────────────────────────────────────────────────────

app.post("/api/auth/register", async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: "Email і пароль (мін. 6 символів) обовʼязкові" });
  }
  try {
    const db = await initDb();
    const existing = await db.get("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
    if (existing) return res.status(400).json({ error: "Email вже зареєстрований" });
    const hash = await hashPassword(password);
    const result = await db.run(
      "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
      [email.toLowerCase(), hash, new Date().toISOString()]
    );
    const token = signToken(result.lastID as number);
    res.json({ token, userId: result.lastID, email: email.toLowerCase() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
});

app.post("/api/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };
  if (!email || !password) return res.status(400).json({ error: "Email і пароль обовʼязкові" });
  try {
    const db = await initDb();
    const user = await db.get("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
    if (!user) return res.status(401).json({ error: "Невірний email або пароль" });
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Невірний email або пароль" });
    const token = signToken(user.id);
    res.json({ token, userId: user.id, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
});
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
    sizeSystem: toText(body.sizeSystem) || undefined,
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
      sizeSystem,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
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
      product.sizeSystem || null,
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
        sizeSystem = ?,
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
      toText(body.sizeSystem) || null,
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

        const details = await getProductDetails(db, productId);

        // Return response immediately — don't block on FFmpeg video processing
        res.json({ success: true, ...details, productId, videoProcessing: !!product.videoPath });

        // Process video in background after response is sent
        if (product.videoPath) {
          generateProcessedVideo(product).then(async processedVideo => {
            if (!processedVideo) return;
            await db.run(
              `UPDATE products SET processedVideoPath=?, processedVideoUrl=?, useProcessedVideo=1, updatedAt=? WHERE id=?`,
              [processedVideo.processedVideoPath, processedVideo.processedVideoUrl, new Date().toISOString(), productId]
            );
            console.log(`[Video] Background processing done for product ${productId}: ${processedVideo.processedVideoUrl}`);
          }).catch(err => {
            console.error(`[Video] Background processing failed for product ${productId}:`, err);
          });
        }
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

  app.get("/api/products/:id", async (req: Request, res: Response) => {
    const details = await getProductDetails(db, Number(req.params.id));
    if (!details) return res.status(404).json({ error: "Not found" });
    res.json(details);
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

  // ── Per-user social token endpoints ────────────────────────────────────────

  app.get("/api/user/social-status", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as number;
    const status = await getUserSocialStatus(db, userId);
    res.json(status);
  });

  app.delete("/api/user/social/:platform", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as number;
    await deleteUserToken(db, userId, String(req.params.platform));
    res.json({ success: true });
  });

  // GET /api/facebook/status — current token info
  app.get("/api/facebook/status", (_req: Request, res: Response) => {
    res.json(getFacebookStatus());
  });

  function extractFbPageId(url: string): string {
    if (!url) return "";
    // Numeric ID in URL path (e.g. /profile.php?id=123 or /123)
    const numericMatch = url.match(/(?:profile\.php\?id=|\/|^)(\d{10,20})/);
    if (numericMatch) return numericMatch[1];
    // Named page slug (e.g. facebook.com/MerilyShop) — return slug to try as page identifier
    const slugMatch = url.match(/facebook\.com\/([^/?&#]+)/i);
    return slugMatch ? slugMatch[1] : "";
  }

  function getBaseUrl(req: Request): string {
    const proto = (req.get("x-forwarded-proto") || req.protocol).split(",")[0].trim();
    const host = req.get("x-forwarded-host") || req.get("host") || `localhost:${PORT}`;
    return `${proto}://${host}`;
  }

  function getFbRedirectUri(req: Request): string {
    return `${getBaseUrl(req)}/auth/facebook/callback`;
  }

  function getIgRedirectUri(req: Request): string {
    return `${getBaseUrl(req)}/auth/instagram/callback`;
  }

  // GET /auth/facebook — start OAuth (requires ?appId=&appSecret= or they're in .env)
  app.get("/auth/facebook", (req: Request, res: Response) => {
    const appId = (req.query.appId as string) || process.env.FACEBOOK_APP_ID || "";
    const appSecret = (req.query.appSecret as string) || process.env.FACEBOOK_APP_SECRET || "";
    if (!appId || !appSecret) {
      return res.status(400).send("Потрібні App ID та App Secret. Введи їх на сторінці налаштувань.");
    }
    const redirectUri = getFbRedirectUri(req);
    const userId = extractTokenFromQuery(req);
    const state = Buffer.from(JSON.stringify({ appId, appSecret, redirectUri, userId })).toString("base64");
    const url = buildAuthUrl({ appId, appSecret, redirectUri }, state);
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
      const parsed = JSON.parse(Buffer.from(state, "base64").toString());
      const { appId, appSecret, redirectUri: savedRedirectUri, userId: stateUserId } = parsed;
      const redirectUri = savedRedirectUri || getFbRedirectUri(req);
      const { pages } = await completeFacebookOAuth({ appId, appSecret, redirectUri }, code);

      const savePerUser = async (pageResult: any) => {
        if (!stateUserId) return;
        const fbToken = pageResult.page.token || readEnv().FACEBOOK_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN || "";
        await saveUserToken(db, stateUserId, "facebook", {
          access_token: fbToken,
          page_id: pageResult.page.id,
          page_name: pageResult.page.name,
        });
        if (pageResult.instagram) {
          // For NPE pages the user token (not page token) is needed for Instagram Graph API
          const igToken = readEnv().INSTAGRAM_ACCESS_TOKEN || readEnv().FACEBOOK_USER_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN || fbToken;
          await saveUserToken(db, stateUserId, "instagram", {
            access_token: igToken,
            instagram_user_id: pageResult.instagram.id,
            instagram_username: pageResult.instagram.username || "",
          });
        }
      };

      if (pages.length === 0) {
        const env = readEnv();
        const pageUrl = env.FACEBOOK_PAGE_URL || process.env.FACEBOOK_PAGE_URL || "";
        const pageId = extractFbPageId(pageUrl);
        if (pageId) {
          try {
            const result = await selectFacebookPageManual(pageId);
            await savePerUser(result);
            const igPart = result.instagram ? `&igName=${encodeURIComponent(result.instagram.username || "")}` : "";
            return res.redirect(`/setup.html?fbSuccess=1&pageName=${encodeURIComponent(result.page.name)}${igPart}`);
          } catch { /* fall through to manual entry */ }
        }
        return res.redirect("/setup.html?needsPageId=1");
      }

      if (pages.length === 1) {
        const result = await selectFacebookPage(pages[0].id);
        await savePerUser(result);
        const igPart = result.instagram ? `&igId=${result.instagram.id}&igName=${encodeURIComponent(result.instagram.username || "")}` : "";
        return res.redirect(`/setup.html?fbSuccess=1&pageId=${pages[0].id}&pageName=${encodeURIComponent(pages[0].name)}${igPart}`);
      }

      const pagesParam = encodeURIComponent(JSON.stringify(pages.map((p: any) => ({ ...p, _userId: stateUserId }))));
      res.redirect(`/setup.html?choosePage=1&pages=${pagesParam}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.redirect(`/setup.html?fbError=${encodeURIComponent(msg)}`);
    }
  });

  // POST /api/facebook/select-page — user picks a page from dropdown
  app.post("/api/facebook/select-page", async (req: Request, res: Response) => {
    const { pageId } = req.body as { pageId: string };
    try {
      const result = await selectFacebookPage(pageId);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, message: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/facebook/select-page-manual — fetch page directly by ID (New Page Experience fallback)
  app.post("/api/facebook/select-page-manual", async (req: Request, res: Response) => {
    const { pageId } = req.body as { pageId: string };
    if (!pageId) return res.status(400).json({ success: false, message: "Потрібен Page ID" });
    try {
      const result = await selectFacebookPageManual(pageId.trim());
      // If caller provided a JWT (from new multi-tenant flow), save per-user token too
      const userId = extractOptionalAuth(req);
      if (userId && result.page.token) {
        await saveUserToken(db, userId, "facebook", {
          access_token: result.page.token,
          page_id: result.page.id,
          page_name: result.page.name,
        });
        if (result.instagram) {
          const igToken = readEnv().INSTAGRAM_ACCESS_TOKEN || readEnv().FACEBOOK_USER_TOKEN || result.page.token;
          await saveUserToken(db, userId, "instagram", {
            access_token: igToken,
            instagram_user_id: result.instagram.id,
            instagram_username: result.instagram.username || "",
          });
        }
      }
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, message: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/facebook/set-instagram — manually save Instagram Business Account ID
  app.post("/api/facebook/set-instagram", (req: Request, res: Response) => {
    const { instagramId, instagramUsername } = req.body as { instagramId: string; instagramUsername?: string };
    if (!instagramId) return res.status(400).json({ success: false, message: "Потрібен Instagram ID" });
    const env = readEnv();
    // For New Page Experience pages, user token works for Instagram API; page token does not
    const userToken = env.FACEBOOK_USER_TOKEN || process.env.FACEBOOK_USER_TOKEN || "";
    const pageToken = env.FACEBOOK_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN || "";
    if (!userToken && !pageToken) return res.status(400).json({ success: false, message: "Спочатку підключи Facebook" });
    const vars: Record<string, string> = {
      INSTAGRAM_USER_ID: instagramId.trim(),
      INSTAGRAM_ACCESS_TOKEN: userToken || pageToken,
    };
    if (instagramUsername) vars.INSTAGRAM_USERNAME = instagramUsername.trim().replace(/^@/, "");
    writeEnvVars(vars);
    res.json({ success: true });
  });

  // GET /api/facebook/saved-creds — return saved App ID (not secret) for pre-filling form
  app.get("/api/facebook/saved-creds", (_req: Request, res: Response) => {
    const env = readEnv();
    res.json({
      appId: env.FACEBOOK_APP_ID || process.env.FACEBOOK_APP_ID || "",
      hasSecret: !!(env.FACEBOOK_APP_SECRET || process.env.FACEBOOK_APP_SECRET),
      igAppId: env.INSTAGRAM_APP_ID || process.env.INSTAGRAM_APP_ID || "",
      hasIgSecret: !!(env.INSTAGRAM_APP_SECRET || process.env.INSTAGRAM_APP_SECRET),
    });
  });

  // POST /api/facebook/save-app — save App ID + App Secret without starting OAuth
  app.post("/api/facebook/save-app", (req: Request, res: Response) => {
    const { appId, appSecret } = req.body as { appId: string; appSecret: string };
    if (!appId || !appSecret) return res.status(400).json({ success: false, message: "Потрібні App ID та App Secret" });
    if (!/^\d+$/.test(appId)) return res.status(400).json({ success: false, message: "App ID повинен містити тільки цифри" });
    if (appSecret.length < 20) return res.status(400).json({ success: false, message: "App Secret занадто короткий" });
    writeEnvVars({ FACEBOOK_APP_ID: appId, FACEBOOK_APP_SECRET: appSecret });
    res.json({ success: true });
  });

  // POST /api/facebook/disconnect — clear all Facebook/Instagram tokens
  app.post("/api/facebook/disconnect", (_req: Request, res: Response) => {
    writeEnvVars({
      FACEBOOK_USER_TOKEN: "", FACEBOOK_USER_TOKEN_EXPIRES: "",
      FACEBOOK_PAGE_ID: "", FACEBOOK_PAGE_NAME: "", FACEBOOK_ACCESS_TOKEN: "",
      INSTAGRAM_USER_ID: "", INSTAGRAM_USERNAME: "", INSTAGRAM_ACCESS_TOKEN: "",
    });
    res.json({ success: true });
  });

  // GET /api/facebook/debug-ig — full Instagram publishing diagnostics
  app.get("/api/facebook/debug-ig", async (_req: Request, res: Response) => {
    const env = readEnv();
    const g = (k: string) => env[k] || process.env[k] || "";
    const userToken  = g("FACEBOOK_USER_TOKEN");
    const pageToken  = g("FACEBOOK_ACCESS_TOKEN");
    const igToken    = g("INSTAGRAM_ACCESS_TOKEN");
    const igId       = g("INSTAGRAM_USER_ID");
    const pageId     = g("FACEBOOK_PAGE_ID");
    const G = "https://graph.facebook.com/v25.0";

    const out: Record<string, any> = {
      saved: {
        igId, pageId,
        igTokenType: igToken === userToken ? "user_token" : igToken === pageToken ? "page_token" : "other",
        igTokenFirst20: igToken.slice(0, 20) + "...",
        userTokenFirst20: userToken.slice(0, 20) + "...",
      }
    };

    if (!userToken) return res.json({ error: "No user token", ...out });

    const [permR, meR, pageIgR] = await Promise.all([
      fetch(`${G}/me/permissions?access_token=${userToken}`).then(r => r.json()),
      fetch(`${G}/me?fields=id,name&access_token=${userToken}`).then(r => r.json()),
      pageId ? fetch(`${G}/${pageId}?fields=instagram_business_account&access_token=${userToken}`).then(r => r.json()) : Promise.resolve(null),
    ]);
    out.me = meR;
    out.permissions = permR?.data?.filter((p: any) => p.status === "granted").map((p: any) => p.permission);
    out.pageIgAccount = pageIgR;

    // Try to find Instagram accounts via user-level endpoints
    const [meIgR, userAccountsIgR, igViaPageTokenR] = await Promise.all([
      fetch(`${G}/me?fields=id,name,instagram_business_accounts{id,username}&access_token=${userToken}`).then(r => r.json()),
      fetch(`${G}/me/accounts?fields=id,name,instagram_business_account{id,username}&access_token=${userToken}`).then(r => r.json()),
      pageToken && igId ? fetch(`${G}/${igId}?fields=id,username&access_token=${pageToken}`).then(r => r.json()) : Promise.resolve("no-page-token"),
    ]);
    out.meInstagramAccounts = meIgR;
    out.userAccountsWithIg = userAccountsIgR;
    out.igViaPageToken = igViaPageTokenR;

    if (igId && igToken) {
      const igMeR = await fetch(`${G}/${igId}?fields=id,username,name&access_token=${igToken}`).then(r => r.json());
      out.igAccountViaUserToken = igMeR;

      // Try with page token
      if (pageToken) {
        const igMePageR = await fetch(`${G}/${igId}?fields=id,username,name&access_token=${pageToken}`).then(r => r.json());
        out.igAccountViaPageToken = igMePageR;
      }
    }

    res.json(out);
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

  // ── Instagram Login OAuth (new flow — does not require Facebook Page) ──────

  app.post("/api/instagram/save-app", (req: Request, res: Response) => {
    const { appId, appSecret } = req.body as { appId?: string; appSecret?: string };
    if (!appId || !appSecret) return res.json({ success: false, message: "Потрібні appId та appSecret" });
    writeEnvVars({ INSTAGRAM_APP_ID: appId.trim(), INSTAGRAM_APP_SECRET: appSecret.trim() });
    res.json({ success: true });
  });

  app.get("/auth/instagram", (req: Request, res: Response) => {
    const env = readEnv();
    const appId = (req.query.appId as string)
      || env.INSTAGRAM_APP_ID || process.env.INSTAGRAM_APP_ID
      || env.FACEBOOK_APP_ID || process.env.FACEBOOK_APP_ID || "";
    const appSecret = (req.query.appSecret as string)
      || env.INSTAGRAM_APP_SECRET || process.env.INSTAGRAM_APP_SECRET
      || env.FACEBOOK_APP_SECRET || process.env.FACEBOOK_APP_SECRET || "";
    if (!appId || !appSecret) return res.redirect("/setup.html?igError=" + encodeURIComponent("Спочатку збережи Instagram App ID та App Secret"));
    const redirectUri = getIgRedirectUri(req);
    const userId = extractTokenFromQuery(req);
    const state = Buffer.from(JSON.stringify({ appId, appSecret, redirectUri, userId })).toString("base64");
    res.redirect(buildInstagramAuthUrl({ appId, appSecret, redirectUri }, state));
  });

  app.get("/auth/instagram/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;
    if (error) return res.redirect(`/setup.html?igError=${encodeURIComponent(req.query.error_description as string || error)}`);
    if (!code || !state) return res.redirect("/setup.html?igError=missing_code");
    try {
      const { appId, appSecret, redirectUri: savedRedirectUri, userId: stateUserId } = JSON.parse(Buffer.from(state, "base64").toString());
      const redirectUri = savedRedirectUri || getIgRedirectUri(req);
      const ig = await completeInstagramOAuth({ appId, appSecret, redirectUri }, code);
      if (stateUserId) {
        const igToken = readEnv().INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN || "";
        await saveUserToken(db, stateUserId, "instagram", {
          access_token: igToken,
          instagram_user_id: ig.id,
          instagram_username: ig.username || "",
        });
      }
      res.redirect(`/setup.html?igSuccess=1&igUsername=${encodeURIComponent(ig.username || ig.id)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.redirect(`/setup.html?igError=${encodeURIComponent(msg)}`);
    }
  });

  app.get("/api/instagram/status", (_req: Request, res: Response) => {
    res.json(getInstagramStatus());
  });

  app.post("/api/instagram/disconnect", (_req: Request, res: Response) => {
    writeEnvVars({ INSTAGRAM_USER_ID: "", INSTAGRAM_USERNAME: "", INSTAGRAM_ACCESS_TOKEN: "", INSTAGRAM_TOKEN_EXPIRES: "" });
    res.json({ success: true });
  });

  // ── Shop settings ──────────────────────────────────────────────────────────

  app.get("/api/settings/shop", (_req: Request, res: Response) => {
    const env = readEnv();
    const g = (k: string) => env[k] || process.env[k] || "";
    res.json({
      shopName: g("SHOP_NAME"),
      shopDescription: g("SHOP_DESCRIPTION"),
      shopLanguage: g("SHOP_LANGUAGE") || "uk",
      facebookPageUrl: g("FACEBOOK_PAGE_URL"),
      instagramUrl: g("INSTAGRAM_URL"),
    });
  });

  app.post("/api/settings/shop", (req: Request, res: Response) => {
    const { shopName, shopDescription, shopLanguage, facebookPageUrl, instagramUrl } = req.body as Record<string, string>;
    const vars: Record<string, string> = {};
    if (shopName !== undefined) vars.SHOP_NAME = shopName;
    if (shopDescription !== undefined) vars.SHOP_DESCRIPTION = shopDescription;
    if (shopLanguage !== undefined) vars.SHOP_LANGUAGE = shopLanguage;
    if (facebookPageUrl !== undefined) vars.FACEBOOK_PAGE_URL = facebookPageUrl;
    if (instagramUrl !== undefined) vars.INSTAGRAM_URL = instagramUrl;
    writeEnvVars(vars);
    res.json({ success: true });
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
    const { chatId } = req.body as { chatId?: string };
    if (!chatId) return res.status(400).json({ success: false, message: "Потрібен chatId" });
    writeEnvVars({ TELEGRAM_CHAT_ID: chatId.trim() });
    res.json({ success: true });
  });

  // ── Shafa setup ───────────────────────────────────────────────────────────

  app.get("/api/shafa/status", (_req: Request, res: Response) => {
    const sessionPath = process.env.SHAFA_SESSION_PATH || "/data/shafa-session.json";
    let sessionValid = false;
    try {
      const raw = fs.readFileSync(sessionPath, "utf8");
      const s = JSON.parse(raw);
      sessionValid = (Array.isArray(s) && s.length > 0) ||
        (s && typeof s === "object" && s.cookies && Array.isArray(s.cookies) && s.cookies.length > 0);
    } catch { /**/ }
    res.json({ sessionValid });
  });

  app.post("/api/shafa/login", async (req: Request, res: Response) => {
    const { email: login, password } = req.body as { email?: string; password?: string };
    if (!login || !password) return res.status(400).json({ success: false, message: "Потрібні логін та пароль" });
    try {
      const { loginShafaAndSaveSession } = await import("./shafa/shafa.publisher");
      // Credentials are NOT saved — only session cookies are stored
      const result = await loginShafaAndSaveSession(login, password);
      res.json({ success: true, username: result.username });
    } catch (err: any) {
      res.json({ success: false, message: err.message || "Помилка логіну" });
    }
  });

  app.post("/api/shafa/disconnect", (_req: Request, res: Response) => {
    const sessionPath = process.env.SHAFA_SESSION_PATH || "/data/shafa-session.json";
    try { require("fs").unlinkSync(sessionPath); } catch { /* ok */ }
    res.json({ success: true });
  });

  app.get("/api/shafa/debug-screenshot", (req: Request, res: Response) => {
    const name = String(req.query.name || "shafa-debug-new-page");
    const candidates = [
      `/data/${name}.png`,
      `./${name}.png`,
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return res.sendFile(path.resolve(p));
    }
    res.status(404).json({ error: "Скріншот не знайдено", tried: candidates });
  });

  // ── TikTok OAuth ──────────────────────────────────────────────────────────

  function getTikTokRedirectUri(req: Request): string {
    return `${getBaseUrl(req)}/auth/tiktok/callback`;
  }

  app.post("/api/tiktok/setup", (req: Request, res: Response) => {
    const { clientKey, clientSecret } = req.body as { clientKey: string; clientSecret: string };
    if (!clientKey || !clientSecret) return res.status(400).json({ error: "Потрібні clientKey і clientSecret" });
    writeEnvVars({ TIKTOK_CLIENT_KEY: clientKey, TIKTOK_CLIENT_SECRET: clientSecret });
    res.json({ success: true });
  });

  app.get("/api/tiktok/status", (req: Request, res: Response) => {
    const { getTikTokStatus } = require("./tiktok");
    const env = readEnv();
    const clientKey = env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_KEY || "";
    const hasKeys = !!clientKey;
    const redirectUri = getTikTokRedirectUri(req);
    res.json({ ...getTikTokStatus(), hasKeys, clientKeyHint: clientKey ? clientKey.slice(0, 6) + "…" : "", redirectUri });
  });

  app.get("/auth/tiktok", (req: Request, res: Response) => {
    const { getTikTokAuthUrl } = require("./tiktok");
    const key = readEnv().TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_KEY || "";
    if (!key) {
      return res.send(`<html><body style="font-family:sans-serif;padding:40px;max-width:500px">
        <h2>❌ Client Key не знайдено</h2>
        <p>Спочатку введи <b>Client Key</b> і <b>Client Secret</b> в Налаштування → TikTok і натисни <b>«Зберегти ключі»</b>.</p>
        <p>Потім знову натисни «Підключити TikTok».</p>
        <button onclick="window.close()">Закрити</button>
      </body></html>`);
    }
    const redirectUri = getTikTokRedirectUri(req);
    const userId = extractTokenFromQuery(req);
    // encode userId in state so callback knows which user to save tokens for
    const stateData = Buffer.from(JSON.stringify({ userId })).toString("base64");
    res.redirect(getTikTokAuthUrl(redirectUri, stateData));
  });

  app.get("/auth/tiktok/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const error = req.query.error as string;
    const stateRaw = req.query.state as string;
    if (error || !code) {
      return res.send(`<script>window.opener?.postMessage({type:'tiktok-auth',error:'${error||"no_code"}'},'*');window.close();</script>`);
    }
    try {
      const { exchangeTikTokCode } = await import("./tiktok");
      const tokens = await exchangeTikTokCode(code, getTikTokRedirectUri(req));
      // Save per-user token if userId was in state
      try {
        const { userId: stateUserId } = JSON.parse(Buffer.from(stateRaw || "", "base64").toString());
        if (stateUserId) {
          await saveUserToken(db, stateUserId, "tiktok", {
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
            open_id: tokens.openId,
            expires_at: tokens.expiresAt,
            refresh_expires_at: tokens.refreshExpiresAt,
          });
        }
      } catch { /* state parse error — ignore, token still saved to .env */ }
      res.send(`<script>window.opener?.postMessage({type:'tiktok-auth',success:true},'*');window.close();</script>`);
    } catch (err: any) {
      res.send(`<script>window.opener?.postMessage({type:'tiktok-auth',error:${JSON.stringify(err.message||'error')}},'*');window.close();</script>`);
    }
  });

  app.post("/api/tiktok/disconnect", (_req: Request, res: Response) => {
    const { disconnectTikTok } = require("./tiktok");
    disconnectTikTok();
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

  const server = app.listen(PORT, () => {
    console.log(`Server started: http://localhost:${PORT}`);
  });
  // Large video uploads need longer timeout (Railway proxy default is ~300s)
  server.setTimeout(600_000); // 10 minutes
  server.keepAliveTimeout = 605_000;
}

startServer();
