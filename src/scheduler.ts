import { getPlatform } from "./platforms";
import { PlatformId, ProductInput } from "./platform-types";
import { getUserTokens, saveUserToken } from "./user-tokens";
import { refreshTikTokTokenRaw } from "./tiktok";
import { refreshOlxToken } from "./olx";

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
    sizeSystem: product.sizeSystem || undefined,
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
    shopName: product.shopName || undefined,
    shopDescription: product.shopDescription || undefined,
    shopLanguage: product.shopLanguage || undefined,
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

  // Fetch per-user social tokens (numeric userId only; 'default' uses .env fallback)
  const productRow = await db.get(`SELECT userId FROM products WHERE id = ?`, [post.productId]);
  const numericUserId = productRow?.userId && /^\d+$/.test(String(productRow.userId))
    ? parseInt(productRow.userId, 10) : null;
  const userTokens = numericUserId ? await getUserTokens(db, numericUserId) : null;
  if (numericUserId && userTokens) {
    const settings = await db.get(`SELECT telegram_chat_id FROM user_settings WHERE user_id = ?`, [numericUserId]);
    if (settings?.telegram_chat_id) {
      userTokens.telegram = { chatId: settings.telegram_chat_id };
    }
    // TikTok access tokens are short-lived; refresh proactively so scheduled/queued
    // posts don't fail with a stale token for accounts connected a while ago.
    if (userTokens.tiktok && userTokens.tiktok.expiresAt < Date.now() + 60_000) {
      try {
        const refreshed = await refreshTikTokTokenRaw(userTokens.tiktok.refreshToken);
        await saveUserToken(db, numericUserId, "tiktok", {
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          open_id: refreshed.openId,
          expires_at: refreshed.expiresAt,
          refresh_expires_at: refreshed.refreshExpiresAt,
        });
        userTokens.tiktok = refreshed;
      } catch {
        // Leave the stale token in place; publish will fail with a clear TikTok API error.
      }
    }
    // OLX tokens also expire; refresh proactively when we have a refresh token.
    if (userTokens.olx?.refreshToken && userTokens.olx.expiresAt && userTokens.olx.expiresAt < Date.now() + 60_000) {
      try {
        const refreshed = await refreshOlxToken(userTokens.olx.refreshToken);
        await saveUserToken(db, numericUserId, "olx", {
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          expires_at: refreshed.expiresAt,
          meta: { categoryId: userTokens.olx.categoryId },
        });
        userTokens.olx = { ...userTokens.olx, ...refreshed };
      } catch {
        // Leave the stale token in place; publish will fail with a clear OLX API error.
      }
    }
  }
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
          extras: { ...extras, userTokens },
        }),
      maxAttempts,
      4000
    );

    // Rozetka may have logged in with a fresh access token mid-publish — persist it
    // so the next publish doesn't have to re-login.
    if (numericUserId && post.platform === "rozetka" && userTokens?.rozetka && (result as any).refreshedAccessToken) {
      await saveUserToken(db, numericUserId, "rozetka", {
        access_token: (result as any).refreshedAccessToken,
        refresh_token: userTokens.rozetka.password,
        login: userTokens.rozetka.login,
        meta: { categoryId: userTokens.rozetka.categoryId, siteId: userTokens.rozetka.siteId },
      });
    }

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
