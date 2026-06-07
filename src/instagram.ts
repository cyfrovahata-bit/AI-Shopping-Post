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

function assertPublicHttpsUrl(fileUrl: string) {
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

const absoluteFileUrl = fileUrl.startsWith("http")
  ? fileUrl
  : `${siteUrl.replace(/\/$/, "")}${fileUrl}`;

const parsedFileUrl = new URL(absoluteFileUrl);

if (parsedFileUrl.protocol !== "https:") {
    throw new Error(
      "Instagram потребує публічний HTTPS SITE_URL. Для локального тесту використай ngrok або деплой."
    );
  }

  return absoluteFileUrl;
}

export async function publishInstagramPost(
  imageUrl: string | undefined,
  caption: string,
  videoUrl?: string
) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!userId || !accessToken) {
    throw new Error("Instagram credentials missing");
  }

  const cleanCaption = cleanInstagramCaption(caption);
  const publicFileUrl = assertPublicHttpsUrl(videoUrl || imageUrl || "");

  console.log(videoUrl ? "Instagram video URL:" : "Instagram image URL:", publicFileUrl);

  const createParams = videoUrl
    ? new URLSearchParams({
        media_type: "REELS",
        video_url: publicFileUrl,
        caption: cleanCaption,
        access_token: accessToken,
      })
    : new URLSearchParams({
        image_url: publicFileUrl,
        caption: cleanCaption,
        access_token: accessToken,
      });

  const createRes = await fetch(
    `https://graph.facebook.com/v25.0/${userId}/media`,
    {
      method: "POST",
      body: createParams,
    }
  );

  const containerData: any = await createRes.json();

  if (!createRes.ok || !containerData.id) {
    console.error("Instagram create error:", containerData);
    throw new Error(
      containerData.error?.message || "Instagram media create failed"
    );
  }

  await new Promise((resolve) => setTimeout(resolve, videoUrl ? 15000 : 5000));

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
    console.error("Instagram publish error:", publishData);
    throw new Error(publishData.error?.message || "Instagram publish failed");
  }

  return publishData as { id: string };
}
