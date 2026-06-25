import { readEnv, writeEnvVars } from "./facebook-auth";

const API = "https://open.tiktokapis.com/v2";
const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  openId: string;
  expiresAt: number;   // unix ms
  refreshExpiresAt: number;
}

function loadTokens(): TikTokTokens | null {
  const env = readEnv();
  const accessToken = env.TIKTOK_ACCESS_TOKEN || process.env.TIKTOK_ACCESS_TOKEN || "";
  const refreshToken = env.TIKTOK_REFRESH_TOKEN || process.env.TIKTOK_REFRESH_TOKEN || "";
  const openId = env.TIKTOK_OPEN_ID || process.env.TIKTOK_OPEN_ID || "";
  const expiresAt = parseInt(env.TIKTOK_EXPIRES_AT || process.env.TIKTOK_EXPIRES_AT || "0", 10);
  const refreshExpiresAt = parseInt(env.TIKTOK_REFRESH_EXPIRES_AT || process.env.TIKTOK_REFRESH_EXPIRES_AT || "0", 10);
  if (!accessToken || !openId) return null;
  return { accessToken, refreshToken, openId, expiresAt, refreshExpiresAt };
}

function saveTokens(t: TikTokTokens) {
  writeEnvVars({
    TIKTOK_ACCESS_TOKEN: t.accessToken,
    TIKTOK_REFRESH_TOKEN: t.refreshToken,
    TIKTOK_OPEN_ID: t.openId,
    TIKTOK_EXPIRES_AT: String(t.expiresAt),
    TIKTOK_REFRESH_EXPIRES_AT: String(t.refreshExpiresAt),
  });
}

function clientKey(): string {
  const env = readEnv();
  return env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_KEY || "";
}

function clientSecret(): string {
  const env = readEnv();
  return env.TIKTOK_CLIENT_SECRET || process.env.TIKTOK_CLIENT_SECRET || "";
}

export function getTikTokAuthUrl(redirectUri: string, state = ""): string {
  const params = new URLSearchParams({
    client_key: clientKey(),
    response_type: "code",
    scope: "video.upload,video.publish",
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeTikTokCode(code: string, redirectUri: string): Promise<TikTokTokens> {
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey(),
      client_secret: clientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok || data.error) {
    throw new Error(`TikTok token error: ${JSON.stringify(data)}`);
  }
  const now = Date.now();
  const tokens: TikTokTokens = {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    openId: data.open_id as string,
    expiresAt: now + (Number(data.expires_in) || 86400) * 1000,
    refreshExpiresAt: now + (Number(data.refresh_expires_in) || 2592000) * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

async function refreshTikTokToken(refreshToken: string): Promise<TikTokTokens> {
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok || data.error) {
    throw new Error(`TikTok refresh error: ${JSON.stringify(data)}`);
  }
  const now = Date.now();
  const tokens: TikTokTokens = {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    openId: data.open_id as string,
    expiresAt: now + (Number(data.expires_in) || 86400) * 1000,
    refreshExpiresAt: now + (Number(data.refresh_expires_in) || 2592000) * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

async function getValidToken(): Promise<TikTokTokens> {
  const t = loadTokens();
  if (!t) throw new Error("TikTok не підключено");
  if (Date.now() < t.expiresAt - 60_000) return t;
  if (!t.refreshToken) throw new Error("TikTok: токен протух, потрібна повторна авторизація");
  return refreshTikTokToken(t.refreshToken);
}

async function tiktokFetch(endpoint: string, body: Record<string, unknown>, retried = false): Promise<Record<string, unknown>> {
  const t = await getValidToken();
  const res = await fetch(`${API}${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${t.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json() as Record<string, unknown>;
  // 401 → try refresh once
  if (res.status === 401 && !retried && t.refreshToken) {
    await refreshTikTokToken(t.refreshToken);
    return tiktokFetch(endpoint, body, true);
  }
  const err = (data as any)?.error;
  if (err && err.code !== "ok") {
    throw new Error(`TikTok API error: ${JSON.stringify(err)}`);
  }
  return (data as any)?.data ?? data;
}

async function pollPublishStatus(publishId: string, maxWaitMs = 120_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const d = await tiktokFetch("/post/publish/status/fetch/", { publish_id: publishId });
    const status = (d as any)?.status;
    console.log(`[TikTok] publish status: ${status}`);
    if (status === "PUBLISH_COMPLETE") return publishId;
    if (status === "FAILED") throw new Error(`TikTok publish failed: ${JSON.stringify(d)}`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error("TikTok: timeout waiting for publish");
}

export async function publishTikTokVideo(videoUrl: string, caption: string, forcedTokens?: TikTokTokens): Promise<string> {
  console.log("[TikTok] Publishing video via PULL_FROM_URL");
  if (forcedTokens) {
    // Use provided tokens directly (per-user flow)
    const res = await fetch(`${API}/post/publish/video/init/`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${forcedTokens.accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: { title: caption.slice(0, 2200), privacy_level: "SELF_ONLY", disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000 },
        source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
      }),
    });
    const data = await res.json() as any;
    const publishId = data?.data?.publish_id as string;
    if (!publishId) throw new Error(`TikTok: no publish_id: ${JSON.stringify(data)}`);
    return pollPublishStatus(publishId);
  }
  const d = await tiktokFetch("/post/publish/video/init/", {
    post_info: {
      title: caption.slice(0, 2200),
      privacy_level: "SELF_ONLY",  // sandbox-safe; change to PUBLIC_TO_EVERYONE after approval
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
      video_cover_timestamp_ms: 1000,
    },
    source_info: {
      source: "PULL_FROM_URL",
      video_url: videoUrl,
    },
  });
  const publishId = (d as any)?.publish_id as string;
  if (!publishId) throw new Error(`TikTok: no publish_id in response: ${JSON.stringify(d)}`);
  console.log(`[TikTok] publish_id: ${publishId}`);
  return pollPublishStatus(publishId);
}

export async function publishTikTokPhotos(photoPaths: string[], caption: string): Promise<string> {
  if (!photoPaths.length) throw new Error("TikTok: no images provided");
  const paths = photoPaths.slice(0, 35);
  console.log(`[TikTok] Publishing ${paths.length} photo(s) via FILE_UPLOAD`);

  // Step 1: init upload — get upload_urls from TikTok
  // Try DIRECT_POST first; if source_info rejected, fallback to UPLOAD_TO_INBOX
  const makeBody = (postMode: string) => ({
    post_info: {
      description: caption.slice(0, 2200),
      privacy_level: "SELF_ONLY",
      disable_comment: false,
    },
    source_info: {
      source: "FILE_UPLOAD",
      photo_count: paths.length,
    },
    post_mode: postMode,
    media_type: "PHOTO",
  });

  let body = makeBody("DIRECT_POST");
  console.log(`[TikTok] Photo init body:`, JSON.stringify(body));
  let init: Record<string, unknown>;
  try {
    init = await tiktokFetch("/post/publish/content/init/", body);
  } catch (e: any) {
    if (e.message?.includes("source info")) {
      console.log(`[TikTok] DIRECT_POST rejected, trying UPLOAD_TO_INBOX`);
      body = makeBody("UPLOAD_TO_INBOX");
      init = await tiktokFetch("/post/publish/content/init/", body);
    } else throw e;
  }

  const publishId = (init as any)?.publish_id as string;
  const uploadUrls = (init as any)?.upload_urls as Array<{ upload_url: string; content_type: string }>;
  if (!publishId) throw new Error(`TikTok: no publish_id: ${JSON.stringify(init)}`);
  if (!uploadUrls?.length) throw new Error(`TikTok: no upload_urls: ${JSON.stringify(init)}`);
  console.log(`[TikTok] publish_id: ${publishId}, upload slots: ${uploadUrls.length}`);

  // Step 2: upload each photo file to TikTok's pre-signed URL
  const fsNode = await import("fs");
  for (let i = 0; i < paths.length; i++) {
    const slot = uploadUrls[i];
    if (!slot) { console.log(`[TikTok] No upload slot for photo ${i}`); continue; }
    const fileBuffer = fsNode.readFileSync(paths[i]);
    const contentType = slot.content_type || "image/jpeg";
    const upRes = await fetch(slot.upload_url, {
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-Length": String(fileBuffer.length) },
      body: fileBuffer,
    });
    if (!upRes.ok) throw new Error(`TikTok: photo ${i} upload failed: ${upRes.status} ${await upRes.text()}`);
    console.log(`[TikTok] Photo ${i + 1}/${paths.length} uploaded`);
  }

  return pollPublishStatus(publishId);
}

export function getTikTokStatus(): { connected: boolean; openId?: string; expiresAt?: number } {
  const t = loadTokens();
  if (!t) return { connected: false };
  const expired = Date.now() > t.expiresAt;
  return { connected: !expired, openId: t.openId, expiresAt: t.expiresAt };
}

export function disconnectTikTok() {
  writeEnvVars({
    TIKTOK_ACCESS_TOKEN: "",
    TIKTOK_REFRESH_TOKEN: "",
    TIKTOK_OPEN_ID: "",
    TIKTOK_EXPIRES_AT: "",
    TIKTOK_REFRESH_EXPIRES_AT: "",
  });
}
