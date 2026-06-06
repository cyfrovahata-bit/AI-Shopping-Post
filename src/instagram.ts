import fetch from "node-fetch";

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

function assertPublicHttpsUrl(imageUrl: string) {
  const siteUrl = process.env.SITE_URL;

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

  const absoluteImageUrl = imageUrl.startsWith("http")
    ? imageUrl
    : `${siteUrl.replace(/\/$/, "")}${imageUrl}`;
  const parsedImageUrl = new URL(absoluteImageUrl);

  if (parsedImageUrl.protocol !== "https:") {
    throw new Error(
      "Instagram потребує публічний HTTPS SITE_URL. Для локального тесту використай ngrok або деплой."
    );
  }

  return absoluteImageUrl;
}

export async function publishInstagramPost(imageUrl: string, caption: string) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const publicImageUrl = assertPublicHttpsUrl(imageUrl);

  if (!userId || !accessToken) {
    throw new Error("Instagram credentials missing");
  }

  const cleanCaption = cleanInstagramCaption(caption);

  const createRes = await fetch(
    `https://graph.facebook.com/v25.0/${userId}/media`,
    {
      method: "POST",
      body: new URLSearchParams({
        image_url: publicImageUrl,
        caption: cleanCaption,
        access_token: accessToken,
      }),
    }
  );
  const containerData: any = await createRes.json();

  if (!createRes.ok || !containerData.id) {
    throw new Error(
      containerData.error?.message || "Instagram media create failed"
    );
  }

  const publishRes = await fetch(
    `https://graph.facebook.com/v25.0/${userId}/media_publish`,
    {
      method: "POST",
      body: new URLSearchParams({
        creation_id: containerData.id,
        access_token: accessToken,
      }),
    }
  );
  const publishData: any = await publishRes.json();

  if (!publishRes.ok || !publishData.id) {
    throw new Error(publishData.error?.message || "Instagram publish failed");
  }

  return publishData as { id: string };
}
