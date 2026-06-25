import fetch from "node-fetch";
import { readEnv, writeEnvVars } from "./facebook-auth";

const IG_AUTH_URL = "https://www.instagram.com/oauth/authorize";
const IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const IG_LONG_TOKEN_URL = "https://graph.instagram.com/access_token";
const IG_GRAPH = "https://graph.instagram.com/v25.0";

export interface InstagramAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export function buildInstagramAuthUrl(cfg: InstagramAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "instagram_business_basic,instagram_business_content_publish",
    state,
  });
  return `${IG_AUTH_URL}?${params}`;
}

async function exchangeInstagramCode(cfg: InstagramAuthConfig, code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
    code,
  });
  const res = await fetch(IG_TOKEN_URL, { method: "POST", body });
  const data: any = await res.json();
  if (!data.access_token) throw new Error(`Instagram code exchange failed: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

async function getLongLivedInstagramToken(cfg: InstagramAuthConfig, shortToken: string) {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: cfg.appSecret,
    access_token: shortToken,
  });
  const res = await fetch(`${IG_LONG_TOKEN_URL}?${params}`);
  const data: any = await res.json();
  if (!data.access_token) throw new Error(`Instagram long-lived exchange failed: ${JSON.stringify(data)}`);
  return {
    token: data.access_token as string,
    expiresIn: (data.expires_in as number) || 5183944,
  };
}

export async function completeInstagramOAuth(cfg: InstagramAuthConfig, code: string) {
  const shortToken = await exchangeInstagramCode(cfg, code);
  const { token: longToken, expiresIn } = await getLongLivedInstagramToken(cfg, shortToken);

  // Get Instagram user info
  const meRes = await fetch(`${IG_GRAPH}/me?fields=id,username&access_token=${longToken}`);
  const me: any = await meRes.json();
  if (me.error) throw new Error(`Instagram me failed: ${me.error.message}`);

  return {
    id: me.id as string,
    username: me.username as string,
    accessToken: longToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function refreshInstagramToken() {
  const env = readEnv();
  const token = env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN || "";
  if (!token) throw new Error("No Instagram token to refresh");

  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: token,
  });
  const res = await fetch(`${IG_GRAPH}/refresh_access_token?${params}`);
  const data: any = await res.json();
  if (!data.access_token) throw new Error(`Instagram token refresh failed: ${JSON.stringify(data)}`);

  writeEnvVars({
    INSTAGRAM_ACCESS_TOKEN: data.access_token,
    INSTAGRAM_TOKEN_EXPIRES: String(Date.now() + (data.expires_in || 5183944) * 1000),
  });
  return data.access_token as string;
}

export function getInstagramStatus() {
  const env = readEnv();
  const get = (k: string) => env[k] || process.env[k] || "";
  const igId = get("INSTAGRAM_USER_ID");
  const igUsername = get("INSTAGRAM_USERNAME");
  const igToken = get("INSTAGRAM_ACCESS_TOKEN");
  const expires = Number(get("INSTAGRAM_TOKEN_EXPIRES") || 0);
  const daysLeft = expires ? Math.floor((expires - Date.now()) / 86400000) : null;
  return {
    connected: !!(igId && igToken),
    igId,
    igUsername,
    daysLeft,
  };
}
