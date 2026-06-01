import fetch from "node-fetch";

export async function publishInstagramPost(
  imageUrl: string,
  caption: string
) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!userId || !accessToken) {
    throw new Error("Instagram credentials missing");
  }

  const createContainer = await fetch(
    `https://graph.instagram.com/v23.0/${userId}/media`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      }),
    }
  );

  const containerData: any = await createContainer.json();

  if (!containerData.id) {
    throw new Error(
      containerData.error?.message || "Instagram media create failed"
    );
  }

  const publish = await fetch(
    `https://graph.instagram.com/v23.0/${userId}/media_publish`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: accessToken,
      }),
    }
  );

  const publishData: any = await publish.json();

  if (!publishData.id) {
    throw new Error(
      publishData.error?.message || "Instagram publish failed"
    );
  }

  return publishData;
}