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

    const allImages =
    imageUrls.length > 0
      ? imageUrls.filter(Boolean)
      : imageUrl
        ? [imageUrl]
        : [];

  if (allImages.length > 1) {
    const attached_media: any[] = [];

    for (const img of allImages) {
      const publicImageUrl = buildPublicUrl(img);

      const uploadRes = await fetch(
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

      const uploadData: any = await uploadRes.json();

      if (!uploadRes.ok) {
        console.error("Facebook album photo error:", uploadData);

        throw new Error(
          uploadData.error?.message ||
            "Facebook album photo upload failed"
        );
      }

      attached_media.push({
        media_fbid: uploadData.id,
      });
    }

    const albumRes = await fetch(
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

    const albumData: any = await albumRes.json();

    if (!albumRes.ok) {
      console.error("Facebook album publish error:", albumData);

      throw new Error(
        albumData.error?.message ||
          "Facebook album publish failed"
      );
    }

    return albumData;
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