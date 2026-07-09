import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const GRAPH = "https://graph.facebook.com/v25.0";

export interface FacebookAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface FacebookTokens {
  userToken: string;
  userTokenExpiresAt: number; // unix ms
  pageId: string;
  pageName: string;
  pageToken: string; // never expires
  instagramUserId?: string;
  instagramUsername?: string;
}

function envPath() {
  // On Railway: persist tokens to Volume so they survive container restarts
  if (fs.existsSync("/data")) return "/data/.env";
  return path.resolve(process.cwd(), ".env");
}

// Read .env as key=value map (merges local + volume .env)
export function readEnv(): Record<string, string> {
  const map: Record<string, string> = {};
  const localPath = path.resolve(process.cwd(), ".env");
  const volumePath = envPath();
  const filesToRead = localPath === volumePath ? [localPath] : [localPath, volumePath];
  for (const p of filesToRead) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      for (const line of raw.split("\n")) {
        const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
        if (m) map[m[1].trim()] = m[2].trim();
      }
    } catch { /* file may not exist */ }
  }
  return map;
}

// Write changed keys back to .env (preserves comments and order)
export function writeEnvVars(vars: Record<string, string>) {
  const envFile = envPath();
  let raw = "";
  try { raw = fs.readFileSync(envFile, "utf8"); } catch { /**/ }

  for (const [key, value] of Object.entries(vars)) {
    const escaped = value.includes(" ") || value.includes("#") ? `"${value}"` : value;
    const re = new RegExp(`^(${key}\\s*=).*$`, "m");
    if (re.test(raw)) {
      raw = raw.replace(re, `$1${escaped}`);
    } else {
      raw = raw.trimEnd() + `\n${key}=${escaped}\n`;
    }
  }
  fs.writeFileSync(envFile, raw, "utf8");

  // Apply to current process
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
}

// Build the Facebook OAuth URL
export function buildAuthUrl(cfg: FacebookAuthConfig, state: string): string {
  const scopes = [
    "pages_show_list",
    "pages_manage_posts",
    "pages_read_engagement",
    "business_management",
    "instagram_basic",
    "instagram_content_publish",
  ].join(",");

  const params = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    scope: scopes,
    response_type: "code",
    auth_type: "rerequest",
    state,
  });
  return `https://www.facebook.com/dialog/oauth?${params}`;
}

// Exchange code for short-lived token
async function exchangeCode(cfg: FacebookAuthConfig, code: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    redirect_uri: cfg.redirectUri,
    code,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token?${params}`);
  const data: any = await res.json();
  if (!data.access_token) throw new Error(`FB code exchange failed: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

// Exchange short-lived for long-lived user token (60 days)
async function getLongLivedToken(cfg: FacebookAuthConfig, shortToken: string) {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token?${params}`);
  const data: any = await res.json();
  if (!data.access_token) throw new Error(`Long-lived exchange failed: ${JSON.stringify(data)}`);
  return {
    token: data.access_token as string,
    expiresIn: (data.expires_in as number) || 5183944, // ~60 days
  };
}

// Get all Pages + their never-expiring tokens
async function getPages(userToken: string) {
  const res = await fetch(`${GRAPH}/me/accounts?access_token=${userToken}&fields=id,name,access_token`);
  const data: any = await res.json();
  if (!data.data) throw new Error(`Get pages failed: ${JSON.stringify(data)}`);
  return data.data as { id: string; name: string; access_token: string }[];
}

// Get Instagram Business Account linked to a Page
async function getInstagramAccount(pageId: string, pageToken: string) {
  const res = await fetch(
    `${GRAPH}/${pageId}?fields=instagram_business_account&access_token=${pageToken}`
  );
  const data: any = await res.json();
  const igId = data.instagram_business_account?.id as string | undefined;
  if (!igId) return null;

  // Get username
  const igRes = await fetch(`${GRAPH}/${igId}?fields=username&access_token=${pageToken}`);
  const igData: any = await igRes.json();
  return { id: igId, username: igData.username as string | undefined };
}

// Full token setup after OAuth callback
export async function completeFacebookOAuth(
  cfg: FacebookAuthConfig,
  code: string
): Promise<{ pages: { id: string; name: string }[]; userToken: string; userTokenExpiresAt: number }> {
  const shortToken = await exchangeCode(cfg, code);
  const { token: longToken, expiresIn } = await getLongLivedToken(cfg, shortToken);

  const pages = await getPages(longToken);

  // Empty accounts is OK — user will enter page ID manually (New Page Experience issue)
  return {
    pages: pages.map(p => ({ id: p.id, name: p.name })),
    userToken: longToken,
    userTokenExpiresAt: Date.now() + expiresIn * 1000,
  };
}

// Fetch a specific page directly by ID (fallback for New Page Experience when /me/accounts returns empty)
export async function selectFacebookPageManual(pageId: string, userTokenOverride?: string, saveGlobal = true) {
  const env = readEnv();
  const userToken = userTokenOverride || env.FACEBOOK_USER_TOKEN || process.env.FACEBOOK_USER_TOKEN;
  if (!userToken) throw new Error("Немає user token. Спершу підключи Facebook.");

  let resolvedId = pageId;
  let resolvedName = "";
  let pageToken = userToken; // NPE default: user token works for posting

  // Attempt 1: standard page lookup with access_token field
  try {
    const res = await fetch(`${GRAPH}/${pageId}?fields=id,name,access_token&access_token=${userToken}`);
    const page: any = await res.json();
    if (!page.error) {
      resolvedId = page.id;
      resolvedName = page.name;
      pageToken = page.access_token || userToken;
    } else {
      // Attempt 2: basic lookup without access_token (NPE pages)
      const basicRes = await fetch(`${GRAPH}/${pageId}?fields=id,name&access_token=${userToken}`);
      const basic: any = await basicRes.json();
      if (!basic.error) {
        resolvedId = basic.id;
        resolvedName = basic.name;
        // NPE: no separate page token; user token is used directly for Graph API calls
      }
      // Attempt 3 (implicit): both failed — trust the user-provided ID, use user token.
      // Posting will fail later if creds are actually wrong.
    }
  } catch { /* network error — proceed with user-provided data */ }

  const ig = await getInstagramAccount(resolvedId, pageToken).catch(() => null);

  const vars: Record<string, string> = {
    FACEBOOK_PAGE_ID: resolvedId,
    FACEBOOK_PAGE_NAME: resolvedName || resolvedId,
    FACEBOOK_ACCESS_TOKEN: pageToken,
  };
  if (ig) {
    vars.INSTAGRAM_USER_ID = ig.id;
    if (ig.username) vars.INSTAGRAM_USERNAME = ig.username;
    vars.INSTAGRAM_ACCESS_TOKEN = userToken;
  }

  if (saveGlobal) writeEnvVars(vars);
  return { page: { id: resolvedId, name: resolvedName || resolvedId, token: pageToken }, instagram: ig };
}

// User selects a page → save page token + instagram info
export async function selectFacebookPage(pageId: string, userTokenOverride?: string, saveGlobal = true) {
  const env = readEnv();
  const userToken = userTokenOverride || env.FACEBOOK_USER_TOKEN || process.env.FACEBOOK_USER_TOKEN;
  if (!userToken) throw new Error("Немає user token. Спершу підключи Facebook.");

  const pages = await getPages(userToken);
  const page = pages.find(p => p.id === pageId);
  if (!page) throw new Error(`Сторінка ${pageId} не знайдена`);

  const ig = await getInstagramAccount(page.id, page.access_token).catch(() => null);

  const vars: Record<string, string> = {
    FACEBOOK_PAGE_ID: page.id,
    FACEBOOK_PAGE_NAME: page.name,
    FACEBOOK_ACCESS_TOKEN: page.access_token,
  };

  if (ig) {
    vars.INSTAGRAM_USER_ID = ig.id;
    if (ig.username) vars.INSTAGRAM_USERNAME = ig.username;
    vars.INSTAGRAM_ACCESS_TOKEN = userToken;
  }

  if (saveGlobal) writeEnvVars(vars);
  return { page: { id: page.id, name: page.name, token: page.access_token }, instagram: ig };
}

// Check current token status
export function getFacebookStatus() {
  const env = readEnv();
  const get = (k: string) => env[k] || process.env[k] || "";

  const pageToken = get("FACEBOOK_ACCESS_TOKEN");
  const pageId = get("FACEBOOK_PAGE_ID");
  const pageName = get("FACEBOOK_PAGE_NAME");
  const igId = get("INSTAGRAM_USER_ID");
  const igName = get("INSTAGRAM_USERNAME");
  const userExpires = Number(get("FACEBOOK_USER_TOKEN_EXPIRES") || 0);

  return {
    connected: !!(pageToken && pageId),
    pageId,
    pageName,
    instagramId: igId,
    instagramUsername: igName,
    userTokenExpiresAt: userExpires || null,
    userTokenDaysLeft: userExpires ? Math.max(0, Math.round((userExpires - Date.now()) / 86400000)) : null,
  };
}
