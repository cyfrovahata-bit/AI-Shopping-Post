import { getPlatform } from "./platforms";
import { PlatformId, ProductInput } from "./platform-types";

type Db = any;

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 5000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  throw lastError;
}

async function getProductInput(db: Db, productId: number): Promise<ProductInput> {
  const product = await db.get(`SELECT * FROM products WHERE id = ?`, [productId]);
  const images = await db.all(
    `SELECT * FROM product_images WHERE productId = ? ORDER BY sortOrder ASC, id ASC`,
    [productId]
  );

  return {
    title: product.title || "",
    model: product.model || "",
    price: product.price || "",
    dropPrice: product.dropPrice || "",
    sizes: product.sizes || "",
    colors: product.colors || "",
    fabric: product.fabric || "",
    description: product.description || "",
    imageUrls: images.map((image: any) => image.imageUrl),
    photoPaths: images.map((image: any) => image.photoPath),
    videoUrl: product.videoUrl || undefined,
    videoPath: product.videoPath || undefined,
    videoStyle: product.videoStyle || "fashion",
    processedVideoUrl: product.processedVideoUrl || undefined,
    processedVideoPath: product.processedVideoPath || undefined,
    useProcessedVideo: product.useProcessedVideo === 1,
    generateVideo: product.generateVideo !== 0,
  };
}

async function prepareVideoForPublishing(product: ProductInput) {
  if (
    product.useProcessedVideo &&
    product.processedVideoPath &&
    product.processedVideoUrl
  ) {
    return {
      videoPath: product.processedVideoPath,
      videoUrl: product.processedVideoUrl,
    };
  }

  return {
    videoPath: product.videoPath,
    videoUrl: product.videoUrl,
  };
}

export async function publishPlatformPost(db: Db, postId: number, extras?: Record<string, unknown>) {
  const post = await db.get(`SELECT * FROM platform_posts WHERE id = ?`, [postId]);

  if (!post) {
    throw new Error("Platform post not found");
  }

  const product = await getProductInput(db, post.productId);
  const platform = getPlatform(post.platform as PlatformId);
  const now = new Date().toISOString();

  await db.run(
    `
    UPDATE platform_posts
    SET status = 'publishing',
        errorMessage = NULL,
        updatedAt = ?
    WHERE id = ?
    `,
    [now, postId]
  );

  try {
    const preparedVideo = await prepareVideoForPublishing(product);

    // Shafa uses Playwright (~2 min) — retrying creates duplicate posts, so 1 attempt only
    const isShafa = post.platform === "shafa";
    const maxAttempts = isShafa ? 1 : 3;

    const result = await withRetry(
      () =>
        platform.publish({
          product,
          text: post.text,
          photoPaths: product.photoPaths,
          imageUrls: product.imageUrls,
          videoPath: preparedVideo.videoPath,
          videoUrl: preparedVideo.videoUrl,
          extras,
        }),
      maxAttempts,
      4000
    );

    const publishedAt = new Date().toISOString();

    await db.run(
      `
      UPDATE platform_posts
      SET status = 'published',
          publishedAt = ?,
          externalPostId = ?,
          externalChatId = ?,
          errorMessage = NULL,
          updatedAt = ?
      WHERE id = ?
      `,
      [
        publishedAt,
        result.externalPostId || null,
        result.externalChatId || null,
        publishedAt,
        postId,
      ]
    );

    if (post.platform === "telegram") {
      await db.run(
        `
        UPDATE products
        SET generatedPost = ?,
            telegramPublished = 1,
            telegramChatId = ?,
            telegramMessageId = ?,
            updatedAt = ?
        WHERE id = ?
        `,
        [
          post.text,
          result.externalChatId || null,
          result.externalPostId || null,
          publishedAt,
          post.productId,
        ]
      );
    }

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Помилка публікації";
    const failedAt = new Date().toISOString();

    await db.run(
      `
      UPDATE platform_posts
      SET status = 'failed',
          errorMessage = ?,
          updatedAt = ?
      WHERE id = ?
      `,
      [message, failedAt, postId]
    );

    throw error;
  }
}

export async function publishDuePosts(db: Db) {
  const duePosts = await db.all(
    `
    SELECT id
    FROM platform_posts
    WHERE status = 'scheduled'
      AND scheduledAt IS NOT NULL
      AND scheduledAt <= ?
    ORDER BY scheduledAt ASC
    LIMIT 10
    `,
    [new Date().toISOString()]
  );

  for (const post of duePosts) {
    try {
      await publishPlatformPost(db, post.id);
    } catch (error) {
      console.error("Scheduled publish error:", error);
    }
  }
}

export function startScheduler(db: Db) {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }

    running = true;

    try {
      await publishDuePosts(db);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, 45_000);
  timer.unref?.();
  void tick();

  return timer;
}