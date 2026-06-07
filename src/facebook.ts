import fs from "fs";
import FormData from "form-data";
import fetch from "node-fetch";

function buildPublicUrl(fileUrl: string) {
  if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
    return fileUrl;
  }

  const siteUrl = process.env.SITE_URL;

  if (!siteUrl) {
    throw new Error("SITE_URL is missing");
  }

  return `${siteUrl.replace(/\/$/, "")}/${fileUrl.replace(/^\//, "")}`;
}

async function uploadUnpublishedFacebookPhoto(
  pageId: string,
  accessToken: string,
  imageUrl: string
) {
  const publicImageUrl = buildPublicUrl(imageUrl);

  const res = await fetch(
    `https://graph.facebook.com/v25.0/${pageId}/photos`,
    {
      method: "POST",
      body: new URLSearchParams({
        url: publicImageUrl,
        published: "false",
        access_token: accessToken,
      }),
    }
  );

  const data: any = await res.json();

  if (!res.ok || !data.id) {
    console.error("Facebook unpublished photo error:", data);
    throw new Error(data.error?.message || "Facebook photo upload failed");
  }

  return data.id as string;
}

async function uploadUnpublishedFacebookVideo(
  pageId: string,
  accessToken: string,
  videoPath: string
) {
  const form = new FormData();

  form.append("source", fs.createReadStream(videoPath));
  form.append("published", "false");
  form.append("access_token", accessToken);

  const res = await fetch(
    `https://graph-video.facebook.com/v25.0/${pageId}/videos`,
    {
      method: "POST",
      body: form as any,
    }
  );

  const data: any = await res.json();

  if (!res.ok || !data.id) {
    console.error("Facebook unpublished video error:", data);
    throw new Error(data.error?.message || "Facebook video upload failed");
  }

  return data.id as string;
}

async function publishFacebookFeedWithAttachedMedia(
  pageId: string,
  accessToken: string,
  caption: string,
  mediaFbids: string[]
) {
  const attached_media = mediaFbids.map((media_fbid) => ({
    media_fbid,
  }));

  const res = await fetch(
    `https://graph.facebook.com/v25.0/${pageId}/feed`,
    {
      method: "POST",
      body: new URLSearchParams({
        message: caption,
        attached_media: JSON.stringify(attached_media),
        access_token: accessToken,
      }),
    }
  );

  const data: any = await res.json();

  if (!res.ok) {
    console.error("Facebook attached media publish error:", data);
    throw new Error(data.error?.message || "Facebook attached media publish failed");
  }

  return data;
}

export async function publishFacebookPost(
  imageUrl: string | undefined,
  caption: string,
  videoUrl?: string,
  videoPath?: string,
  imageUrls: string[] = []
) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;

  if (!pageId || !accessToken) {
    throw new Error("Facebook credentials missing");
  }

  const allImages =
    imageUrls.length > 0
      ? imageUrls.filter(Boolean)
      : imageUrl
        ? [imageUrl]
        : [];

  /**
   * Відео + фото → один Facebook пост з attached_media.
   */
  if (videoPath && allImages.length > 0) {
    const mediaFbids: string[] = [];

    const videoFbid = await uploadUnpublishedFacebookVideo(
      pageId,
      accessToken,
      videoPath
    );

    mediaFbids.push(videoFbid);

    for (const img of allImages.slice(0, 9)) {
      const photoFbid = await uploadUnpublishedFacebookPhoto(
        pageId,
        accessToken,
        img
      );

      mediaFbids.push(photoFbid);
    }

    return publishFacebookFeedWithAttachedMedia(
      pageId,
      accessToken,
      caption,
      mediaFbids
    );
  }

  /**
   * Тільки відео → старий робочий Facebook video publish.
   */
  if (videoPath) {
    const form = new FormData();

    form.append("source", fs.createReadStream(videoPath));
    form.append("description", caption);
    form.append("access_token", accessToken);

    const res = await fetch(
      `https://graph-video.facebook.com/v25.0/${pageId}/videos`,
      {
        method: "POST",
        body: form as any,
      }
    );

    const data: any = await res.json();

    if (!res.ok) {
      console.log(JSON.stringify(data, null, 2));
      console.error("Facebook video publish error:", data);
      throw new Error(data.error?.message || "Facebook video publish failed");
    }

    return data;
  }

  /**
   * Багато фото → один Facebook пост з attached_media.
   */
  if (allImages.length > 1) {
    const mediaFbids: string[] = [];

    for (const img of allImages.slice(0, 10)) {
      const photoFbid = await uploadUnpublishedFacebookPhoto(
        pageId,
        accessToken,
        img
      );

      mediaFbids.push(photoFbid);
    }

    return publishFacebookFeedWithAttachedMedia(
      pageId,
      accessToken,
      caption,
      mediaFbids
    );
  }

  /**
   * Одне фото → старий робочий Facebook photo publish.
   */
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