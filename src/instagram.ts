import fetch from "node-fetch";

function cleanInstagramCaption(text: string) {
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

export async function publishInstagramPost(imageUrl: string, caption: string) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!userId || !accessToken) {
    throw new Error("Instagram credentials missing");
  }

  const cleanCaption = cleanInstagramCaption(caption);

  const createRes = await fetch(
    `https://graph.facebook.com/v25.0/${userId}/media`,
    {
      method: "POST",
      body: new URLSearchParams({
        image_url: imageUrl,
        caption: cleanCaption,
        access_token: accessToken,
      }),
    }
  );

  const containerData: any = await createRes.json();

  if (!createRes.ok || !containerData.id) {
    console.error("Instagram create error:", containerData);
    throw new Error(containerData.error?.message || "Instagram media create failed");
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
    console.error("Instagram publish error:", publishData);
    throw new Error(publishData.error?.message || "Instagram publish failed");
  }

  return publishData;
}