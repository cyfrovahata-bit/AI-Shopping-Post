import { readEnv, writeEnvVars } from "./facebook-auth";
import { execFile } from "child_process";
import { promisify } from "util";

const API = "https://open.tiktokapis.com/v2";
const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const execFileAsync = promisify(execFile);

export const TIKTOK_PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;

export type TikTokPrivacyLevel = typeof TIKTOK_PRIVACY_LEVELS[number];

export interface TikTokCreatorInfo {
  creatorAvatarUrl: string;
  creatorUsername: string;
  creatorNickname: string;
  privacyLevelOptions: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

export interface TikTokPostSettings {
  privacyLevel: TikTokPrivacyLevel | "";
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  commercialContent: boolean;
  yourBrand: boolean;
  brandedContent: boolean;
  musicUsageAccepted: boolean;
}

export interface TikTokPublishStatus {
  status: string;
  failReason?: string;
  publiclyAvailablePostIds: string[];
  uploadedBytes?: number;
  downloadedBytes?: number;
  raw: Record<string, unknown>;
}

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
    // Always show TikTok's consent page. Besides giving users clear control,
    // this makes the authorization step visible in the audit recording instead
    // of silently reusing an existing TikTok session and showing a blank popup.
    disable_auto_auth: "1",
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

// Calls TikTok's refresh endpoint using the shared dev-app client key/secret.
// Does not persist anywhere — caller decides where the refreshed tokens go
// (global .env for the admin/global connection, or per-user DB row).
export async function refreshTikTokTokenRaw(refreshToken: string): Promise<TikTokTokens> {
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
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    openId: data.open_id as string,
    expiresAt: now + (Number(data.expires_in) || 86400) * 1000,
    refreshExpiresAt: now + (Number(data.refresh_expires_in) || 2592000) * 1000,
  };
}

async function refreshTikTokToken(refreshToken: string): Promise<TikTokTokens> {
  const tokens = await refreshTikTokTokenRaw(refreshToken);
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

async function tiktokFetchWithTokens(
  endpoint: string,
  body: Record<string, unknown>,
  tokens: TikTokTokens
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${tokens.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json() as any;
  const error = data?.error;
  if (!res.ok || (error && error.code !== "ok")) {
    throw new Error(`TikTok API error: ${JSON.stringify(error || data)}`);
  }
  return data?.data ?? data;
}

function asPrivacyLevel(value: unknown): TikTokPrivacyLevel | "" {
  return TIKTOK_PRIVACY_LEVELS.includes(value as TikTokPrivacyLevel)
    ? value as TikTokPrivacyLevel
    : "";
}

export function normalizeTikTokPostSettings(value: unknown): TikTokPostSettings {
  const raw = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const commercialContent = raw.commercialContent === true;
  return {
    privacyLevel: asPrivacyLevel(raw.privacyLevel),
    allowComment: raw.allowComment === true,
    allowDuet: raw.allowDuet === true,
    allowStitch: raw.allowStitch === true,
    commercialContent,
    yourBrand: commercialContent && raw.yourBrand === true,
    brandedContent: commercialContent && raw.brandedContent === true,
    musicUsageAccepted: raw.musicUsageAccepted === true,
  };
}

export function validateTikTokPostSettings(
  value: unknown,
  creatorInfo?: TikTokCreatorInfo
): TikTokPostSettings {
  const settings = normalizeTikTokPostSettings(value);
  if (!settings.privacyLevel) {
    throw new Error("TikTok: вручну виберіть видимість публікації");
  }
  if (creatorInfo && !creatorInfo.privacyLevelOptions.includes(settings.privacyLevel)) {
    throw new Error("TikTok: вибрана видимість більше недоступна для цього акаунта");
  }
  if (settings.allowComment && creatorInfo?.commentDisabled) {
    throw new Error("TikTok: коментарі вимкнені в налаштуваннях акаунта");
  }
  if (settings.allowDuet && creatorInfo?.duetDisabled) {
    throw new Error("TikTok: Duet вимкнений у налаштуваннях акаунта");
  }
  if (settings.allowStitch && creatorInfo?.stitchDisabled) {
    throw new Error("TikTok: Stitch вимкнений у налаштуваннях акаунта");
  }
  if (settings.commercialContent && !settings.yourBrand && !settings.brandedContent) {
    throw new Error("TikTok: вкажіть, чи контент просуває ваш бренд, сторонній бренд або обидва");
  }
  if (settings.brandedContent && settings.privacyLevel === "SELF_ONLY") {
    throw new Error("TikTok: брендований контент не можна публікувати з видимістю «Лише я»");
  }
  if (!settings.musicUsageAccepted) {
    throw new Error("TikTok: підтвердьте Music Usage Confirmation перед публікацією");
  }
  return settings;
}

export async function queryTikTokCreatorInfo(forcedTokens?: TikTokTokens): Promise<TikTokCreatorInfo> {
  const data = forcedTokens
    ? await tiktokFetchWithTokens("/post/publish/creator_info/query/", {}, forcedTokens)
    : await tiktokFetch("/post/publish/creator_info/query/", {});
  const rawOptions = Array.isArray((data as any)?.privacy_level_options)
    ? (data as any).privacy_level_options
    : [];
  return {
    creatorAvatarUrl: String((data as any)?.creator_avatar_url || ""),
    creatorUsername: String((data as any)?.creator_username || ""),
    creatorNickname: String((data as any)?.creator_nickname || ""),
    privacyLevelOptions: rawOptions
      .map(asPrivacyLevel)
      .filter(Boolean) as TikTokPrivacyLevel[],
    commentDisabled: (data as any)?.comment_disabled === true,
    duetDisabled: (data as any)?.duet_disabled === true,
    stitchDisabled: (data as any)?.stitch_disabled === true,
    maxVideoPostDurationSec: Number((data as any)?.max_video_post_duration_sec || 0),
  };
}

export async function getVideoDurationSeconds(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const duration = Number(String(stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("TikTok: не вдалося визначити тривалість відео");
  }
  return duration;
}

async function fetchPublishStatus(publishId: string, forcedTokens?: TikTokTokens): Promise<Record<string, unknown>> {
  if (forcedTokens) {
    const res = await fetch(`${API}/post/publish/status/fetch/`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${forcedTokens.accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const data = await res.json() as any;
    if (data?.error && data.error.code !== "ok") {
      throw new Error(`TikTok API error: ${JSON.stringify(data.error)}`);
    }
    return data?.data ?? data;
  }
  return tiktokFetch("/post/publish/status/fetch/", { publish_id: publishId });
}

export async function getTikTokPublishStatus(
  publishId: string,
  forcedTokens?: TikTokTokens
): Promise<TikTokPublishStatus> {
  const data = await fetchPublishStatus(publishId, forcedTokens);
  const postIds = (data as any)?.publicaly_available_post_id
    ?? (data as any)?.publicly_available_post_id
    ?? [];
  return {
    status: String((data as any)?.status || "UNKNOWN"),
    failReason: (data as any)?.fail_reason ? String((data as any).fail_reason) : undefined,
    publiclyAvailablePostIds: Array.isArray(postIds) ? postIds.map(String) : [],
    uploadedBytes: Number.isFinite(Number((data as any)?.uploaded_bytes))
      ? Number((data as any).uploaded_bytes)
      : undefined,
    downloadedBytes: Number.isFinite(Number((data as any)?.downloaded_bytes))
      ? Number((data as any).downloaded_bytes)
      : undefined,
    raw: data,
  };
}

export async function publishTikTokVideo(
  videoUrl: string,
  caption: string,
  forcedTokens: TikTokTokens | undefined,
  postSettings: unknown,
  videoPath?: string
): Promise<string> {
  console.log("[TikTok] Publishing video via PULL_FROM_URL");
  if (!forcedTokens) {
    throw new Error("TikTok не підключено. Підключіть свій акаунт у Налаштуваннях.");
  }
  const creatorInfo = await queryTikTokCreatorInfo(forcedTokens);
  const settings = validateTikTokPostSettings(postSettings, creatorInfo);
  if (videoPath && creatorInfo.maxVideoPostDurationSec > 0) {
    const duration = await getVideoDurationSeconds(videoPath);
    if (duration > creatorInfo.maxVideoPostDurationSec + 0.05) {
      throw new Error(
        `TikTok: відео триває ${Math.ceil(duration)} с, але цей акаунт дозволяє максимум ${creatorInfo.maxVideoPostDurationSec} с`
      );
    }
  }
  const data = await tiktokFetchWithTokens(
    "/post/publish/video/init/",
    {
      post_info: {
        title: caption.slice(0, 2200),
        privacy_level: settings.privacyLevel,
        disable_duet: !settings.allowDuet,
        disable_comment: !settings.allowComment,
        disable_stitch: !settings.allowStitch,
        video_cover_timestamp_ms: 1000,
        brand_content_toggle: settings.brandedContent,
        brand_organic_toggle: settings.yourBrand,
      },
      source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
    },
    forcedTokens
  );
  const publishId = (data as any)?.publish_id as string;
  if (!publishId) throw new Error(`TikTok: no publish_id: ${JSON.stringify(data)}`);
  return publishId;
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

  return publishId;
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
