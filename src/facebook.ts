import fetch from "node-fetch";

function buildPublicUrl(imageUrl: string) {
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }

  const siteUrl = process.env.SITE_URL;

  if (!siteUrl) {
    throw new Error("SITE_URL is missing");
  }

  return `${siteUrl.replace(/\/$/, "")}/${imageUrl.replace(/^\//, "")}`;
}

export async function publishFacebookPost(imageUrl: string, caption: string) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;

  if (!pageId || !accessToken) {
    throw new Error("Facebook credentials missing");
  }

  if (!imageUrl) {
    throw new Error("Facebook imageUrl is missing");
  }

  const publicImageUrl = buildPublicUrl(imageUrl);

  const res = await fetch(
    `https://graph.facebook.com/v25.0/${pageId}/photos`,
    {
      method: "POST",
      body: new URLSearchParams({
        url: publicImageUrl,
        caption,
        access_token: accessToken,
      }),
    }
  );

  const data: any = await res.json();

  if (!res.ok) {
    console.error("Facebook publish error:", data);
    throw new Error(data.error?.message || "Facebook publish failed");
  }

  return data;
}