import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import type { ProductInput } from "./platform-types";

// OLX Ukraine API v2 — https://developer.olx.ua/api/doc
const API_BASE = "https://www.olx.ua/api/v2";

function headers(token: string, contentType = "application/json") {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": contentType,
  };
}

export async function olxTestConnection(token: string): Promise<{ ok: boolean; name?: string; accountId?: string; error?: string }> {
  if (!token) return { ok: false, error: "Токен не задано" };
  try {
    const r = await fetch(`${API_BASE}/users/me`, { headers: headers(token) as any });
    const d = await r.json() as any;
    if (!r.ok) return { ok: false, error: d.error?.message || `HTTP ${r.status}` };
    const name = d.data?.name || d.data?.email || "OK";
    // OLX access tokens rotate on refresh, so (unlike Prom/Rozetka) a token hash isn't
    // a stable identity signal — the numeric OLX user id is, and doesn't change.
    const accountId = d.data?.id != null ? String(d.data.id) : undefined;
    return { ok: true, name, accountId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Upload a photo and return its id
async function uploadPhoto(token: string, filePath: string): Promise<string | null> {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1) || "jpg";
    const mime = `image/${ext === "jpg" ? "jpeg" : ext}`;

    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("file", data, { filename: path.basename(filePath), contentType: mime });

    const r = await fetch(`${API_BASE}/images`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        ...form.getHeaders(),
      } as any,
      body: form as any,
    });
    const d = await r.json() as any;
    return d.data?.id || null;
  } catch { return null; }
}

export async function publishOlxPost(opts: {
  product: ProductInput;
  text: string;
  photoPaths: string[];
  imageUrls: string[];
  extras?: Record<string, unknown>;
  creds?: { accessToken: string; categoryId?: number };
}): Promise<{ externalPostId: string }> {
  const token = opts.creds?.accessToken;
  if (!token) throw new Error("OLX не підключено. Підключіть свій акаунт у Налаштуваннях.");

  const { product, text, photoPaths } = opts;

  // Parse AI JSON
  let ai: Record<string, unknown> = {};
  try {
    const m = text.match(/```(?:json)?\s*([\s\S]+?)```/i);
    const raw = m ? m[1].trim() : text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    ai = JSON.parse(raw);
  } catch {
    try { const m = text.match(/\{[\s\S]+\}/); if (m) ai = JSON.parse(m[0]); } catch {}
  }

  const title = (typeof ai.title === "string" ? ai.title : product.title).slice(0, 70);
  const description = typeof ai.description === "string" ? ai.description : product.description || product.title;
  const price = parseFloat(String(product.price).replace(/[^\d.]/g, "")) || 0;

  // Upload photos (max 8 for OLX)
  const imageIds: string[] = [];
  for (const p of photoPaths.slice(0, 8)) {
    if (fs.existsSync(p)) {
      const id = await uploadPhoto(token, p);
      if (id) imageIds.push(id);
    }
  }

  // Build params — OLX requires category-specific params
  // Default category: women's clothing, unless the user saved their own default
  const categoryId = opts.extras?.categoryId
    ? Number(opts.extras.categoryId)
    : opts.creds?.categoryId || 1397; // Жіночий одяг

  const params: Record<string, unknown>[] = [];

  // Price
  const sizes = Array.isArray(ai.sizes) ? (ai.sizes as string[]) : product.sizes?.split(/[,;]/).map(s => s.trim()) || [];
  if (sizes.length) {
    params.push({ key: "size", value: sizes[0] });
  }

  const body: Record<string, unknown> = {
    title,
    description,
    category_id: categoryId,
    advertiser_type: "private",
    price: { value: price, currency: "UAH" },
    contact: { name: product.title },
    location: {
      city_id: process.env.OLX_CITY_ID ? Number(process.env.OLX_CITY_ID) : 7, // Київ
    },
    images: imageIds.map(id => ({ id })),
  };

  if (params.length) body.params = params;

  const r = await fetch(`${API_BASE}/adverts`, {
    method: "POST",
    headers: headers(token) as any,
    body: JSON.stringify(body),
  });

  const data = await r.json() as any;

  if (!r.ok) {
    const msg = data.error?.details || data.error?.message || JSON.stringify(data);
    throw new Error(`OLX API помилка: ${msg}`);
  }

  const advertId = data.data?.id;
  const url = advertId ? `https://www.olx.ua/uk/obyavlenie/${advertId}` : "https://www.olx.ua/cabinet";
  return { externalPostId: url };
}

export function getOlxAuthUrl(state: string): string {
  const clientId = process.env.OLX_CLIENT_ID || "";
  const redirectUri = process.env.OLX_REDIRECT_URI || `${process.env.SITE_URL || "http://localhost:3000"}/auth/olx/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "read write",
    redirect_uri: redirectUri,
    state,
  });
  return `https://www.olx.ua/oauth/authorize?${params}`;
}

export interface OlxTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export async function completeOlxOAuth(code: string): Promise<OlxTokens> {
  const clientId = process.env.OLX_CLIENT_ID || "";
  const clientSecret = process.env.OLX_CLIENT_SECRET || "";
  const redirectUri = process.env.OLX_REDIRECT_URI || `${process.env.SITE_URL || "http://localhost:3000"}/auth/olx/callback`;

  const r = await fetch("https://www.olx.ua/api/open/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" } as any,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });

  const d = await r.json() as any;
  if (!d.access_token) throw new Error(`OLX OAuth failed: ${JSON.stringify(d)}`);

  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token || undefined,
    expiresAt: d.expires_in ? Date.now() + d.expires_in * 1000 : undefined,
  };
}

// Refreshes a per-user OLX token using the shared dev-app client_id/secret.
export async function refreshOlxToken(refreshToken: string): Promise<OlxTokens> {
  const clientId = process.env.OLX_CLIENT_ID || "";
  const clientSecret = process.env.OLX_CLIENT_SECRET || "";

  const r = await fetch("https://www.olx.ua/api/open/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" } as any,
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });

  const d = await r.json() as any;
  if (!d.access_token) throw new Error(`OLX refresh failed: ${JSON.stringify(d)}`);

  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token || refreshToken,
    expiresAt: d.expires_in ? Date.now() + d.expires_in * 1000 : undefined,
  };
}
