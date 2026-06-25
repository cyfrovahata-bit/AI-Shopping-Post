import fetch from "node-fetch";

// Instagram API with Instagram Login uses graph.instagram.com (not graph.facebook.com)
// instagram_basic was deprecated Dec 2024; new approach requires Instagram Login OAuth
const GRAPH_API = "https://graph.instagram.com/v25.0";

export function cleanInstagramCaption(text: string) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertPublicHttpsUrl(fileUrl: string) {
  const siteUrl = process.env.SITE_URL;

  if (!fileUrl) {
    throw new Error("Instagram потребує фото або відео для публікації");
  }

  if (!siteUrl) {
    throw new Error(
      "Instagram потребує публічний HTTPS SITE_URL. Для локального тесту використай ngrok або деплой."
    );
  }

  const parsedSiteUrl = new URL(siteUrl);
  const isLocalhost =
    parsedSiteUrl.hostname === "localhost" ||
    parsedSiteUrl.hostname === "127.0.0.1" ||
    parsedSiteUrl.hostname === "::1";

  if (parsedSiteUrl.protocol !== "https:" || isLocalhost) {
    throw new Error(
      "Instagram потребує публічний HTTPS SITE_URL. Для локального тесту використай ngrok або деплой."
    );
  }

  const absoluteFileUrl = fileUrl.startsWith("http")
    ? fileUrl
    : `${siteUrl.replace(/\/$/, "")}${fileUrl.startsWith("/") ? "" : "/"}${fileUrl}`;

  const parsedFileUrl = new URL(absoluteFileUrl);

  if (parsedFileUrl.protocol !== "https:") {
    throw new Error(
      "Instagram потребує публічний HTTPS SITE_URL. Для локального тесту використай ngrok або деплой."
    );
  }

  return absoluteFileUrl;
}

async function createInstagramMediaContainer(params: URLSearchParams, igUserId: string) {
  const createRes = await fetch(`${GRAPH_API}/${igUserId}/media`, { method: "POST", body: params });
  const data: any = await createRes.json();
  if (!createRes.ok || !data.id) {
    console.error("Instagram create error:", data);
    throw new Error(data.error?.message || "Instagram media create failed");
  }
  return data.id as string;
}

async function publishInstagramContainer(creationId: string, igUserId: string, accessToken: string) {
  const publishRes = await fetch(`${GRAPH_API}/${igUserId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: creationId, access_token: accessToken }),
  });
  const publishData: any = await publishRes.json();
  if (!publishRes.ok || !publishData.id) {
    console.error("Instagram publish error:", publishData);
    throw new Error(publishData.error?.message || "Instagram publish failed");
  }
  return publishData as { id: string };
}

export async function publishInstagramPost(
  imageUrl: string | undefined,
  caption: string,
  videoUrl?: string,
  imageUrls: string[] = [],
  creds?: { userId: string; accessToken: string }
) {
  const userId = creds?.userId || process.env.INSTAGRAM_USER_ID;
  const accessToken = creds?.accessToken || process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!userId || !accessToken) {
    throw new Error(
      "Instagram не підключено. Відкрий Налаштування → вкладка Instagram → Підключити Instagram."
    );
  }

  const cleanCaption = cleanInstagramCaption(caption);

  const allImages =
    imageUrls.length > 0
      ? imageUrls.filter(Boolean)
      : imageUrl
        ? [imageUrl]
        : [];

  /**
   * ВАЖЛИВО:
   * Instagram не підтримує Reels + фото в одному дописі.
   * Тому якщо є videoUrl + фото — робимо Carousel:
   * 1 елемент: video
   * наступні елементи: photos
   */
  if (videoUrl && allImages.length > 0) {
    const children: string[] = [];

    const publicVideoUrl = assertPublicHttpsUrl(videoUrl);

    console.log("Instagram carousel video URL:", publicVideoUrl);

    const videoChildId = await createInstagramMediaContainer(
      new URLSearchParams({ media_type: "VIDEO", video_url: publicVideoUrl, is_carousel_item: "true", access_token: accessToken }),
      userId
    );
    children.push(videoChildId);

    for (const img of allImages.slice(0, 9)) {
      const publicImageUrl = assertPublicHttpsUrl(img);
      console.log("Instagram carousel image URL:", publicImageUrl);
      const childId = await createInstagramMediaContainer(
        new URLSearchParams({ image_url: publicImageUrl, is_carousel_item: "true", access_token: accessToken }),
        userId
      );
      children.push(childId);
    }

    await new Promise((resolve) => setTimeout(resolve, 30000));

    const carouselId = await createInstagramMediaContainer(
      new URLSearchParams({ media_type: "CAROUSEL", children: children.join(","), caption: cleanCaption, access_token: accessToken }),
      userId
    );

    await new Promise((resolve) => setTimeout(resolve, 10000));

    return publishInstagramContainer(carouselId, userId, accessToken);
  }

  if (videoUrl) {
    const publicVideoUrl = assertPublicHttpsUrl(videoUrl);
    console.log("Instagram video URL:", publicVideoUrl);
    const creationId = await createInstagramMediaContainer(
      new URLSearchParams({ media_type: "REELS", video_url: publicVideoUrl, caption: cleanCaption, access_token: accessToken }),
      userId
    );
    await new Promise((resolve) => setTimeout(resolve, 60000));
    return publishInstagramContainer(creationId, userId, accessToken);
  }

  if (allImages.length > 1) {
    const children: string[] = [];
    for (const img of allImages.slice(0, 10)) {
      const publicImageUrl = assertPublicHttpsUrl(img);
      console.log("Instagram carousel image URL:", publicImageUrl);
      const childId = await createInstagramMediaContainer(
        new URLSearchParams({ image_url: publicImageUrl, is_carousel_item: "true", access_token: accessToken }),
        userId
      );
      children.push(childId);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const carouselId = await createInstagramMediaContainer(
      new URLSearchParams({ media_type: "CAROUSEL", children: children.join(","), caption: cleanCaption, access_token: accessToken }),
      userId
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return publishInstagramContainer(carouselId, userId, accessToken);
  }

  if (allImages.length === 1) {
    const publicImageUrl = assertPublicHttpsUrl(allImages[0]);
    console.log("Instagram image URL:", publicImageUrl);
    const creationId = await createInstagramMediaContainer(
      new URLSearchParams({ image_url: publicImageUrl, caption: cleanCaption, access_token: accessToken }),
      userId
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return publishInstagramContainer(creationId, userId, accessToken);
  }

  throw new Error("Instagram потребує фото або відео товару для публікації");
}