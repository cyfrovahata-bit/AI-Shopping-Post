import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import type { ProductInput } from "./platform-types";

// Rozetka Partner API — requires partnership agreement at rozetka.com.ua
// API endpoint for approved partners: https://api.seller.rozetka.com.ua
const API_BASE = "https://api.seller.rozetka.com.ua";

function headers(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function rozetkaTestConnection(token: string): Promise<{ ok: boolean; shopName?: string; error?: string }> {
  if (!token) return { ok: false, error: "Токен не задано" };
  try {
    const r = await fetch(`${API_BASE}/sites`, { headers: headers(token) as any });
    const d = await r.json() as any;
    if (!r.ok) return { ok: false, error: d.message || `HTTP ${r.status}` };
    const shopName = d.data?.sites?.[0]?.title || "OK";
    return { ok: true, shopName };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Logs in with the seller's own Rozetka credentials and returns a fresh access token.
export async function rozetkaLogin(login: string, password: string): Promise<string> {
  if (!login || !password) throw new Error("Потрібні логін і пароль від Rozetka");

  const r = await fetch(`${API_BASE}/sites/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" } as any,
    body: JSON.stringify({ username: login, password }),
  });

  const d = await r.json() as any;
  if (!d.data?.access_token) throw new Error(`Rozetka login failed: ${d.message || JSON.stringify(d)}`);

  return d.data.access_token as string;
}

// Upload a photo from file or URL and return Rozetka photo object
async function uploadPhoto(token: string, filePath: string): Promise<{ url: string } | null> {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1) || "jpg";
    const mime = `image/${ext === "jpg" ? "jpeg" : ext}`;

    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("file", data, { filename: path.basename(filePath), contentType: mime });

    const r = await fetch(`${API_BASE}/upload/item/photo`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        ...form.getHeaders(),
      } as any,
      body: form as any,
    });

    const d = await r.json() as any;
    return d.data?.url ? { url: d.data.url } : null;
  } catch { return null; }
}

export async function publishRozetkaPost(opts: {
  product: ProductInput;
  text: string;
  photoPaths: string[];
  imageUrls: string[];
  extras?: Record<string, unknown>;
  creds?: { login: string; password: string; accessToken?: string; categoryId?: number; siteId?: number };
}): Promise<{ externalPostId: string; refreshedAccessToken?: string }> {
  const creds = opts.creds;
  if (!creds?.login || !creds?.password) {
    throw new Error("Rozetka не підключено. Підключіть свій акаунт у Налаштуваннях.");
  }

  let token = creds.accessToken || "";
  let refreshedAccessToken: string | undefined;
  if (!token) {
    token = await rozetkaLogin(creds.login, creds.password);
    refreshedAccessToken = token;
  }

  const { product, text, photoPaths, imageUrls } = opts;
  const siteUrl = process.env.SITE_URL || "";

  // Parse AI JSON
  let ai: Record<string, unknown> = {};
  try {
    const m = text.match(/```(?:json)?\s*([\s\S]+?)```/i);
    const raw = m ? m[1].trim() : text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    ai = JSON.parse(raw);
  } catch {
    try { const m = text.match(/\{[\s\S]+\}/); if (m) ai = JSON.parse(m[0]); } catch {}
  }

  const title = (typeof ai.title === "string" ? ai.title : product.title).slice(0, 255);
  const description = typeof ai.description === "string" ? ai.description : product.description || product.title;
  const price = parseFloat(String(product.price).replace(/[^\d.]/g, "")) || 0;

  // Upload photos
  const photos: string[] = [];
  for (const p of photoPaths.slice(0, 10)) {
    if (fs.existsSync(p)) {
      const res = await uploadPhoto(token, p);
      if (res?.url) photos.push(res.url);
    }
  }
  // Fallback to URLs
  if (!photos.length) {
    for (const u of imageUrls.slice(0, 10)) {
      const full = !u.startsWith("http") && siteUrl ? `${siteUrl.replace(/\/$/, "")}${u}` : u;
      if (full.startsWith("http")) photos.push(full);
    }
  }

  const categoryId = opts.extras?.categoryId
    ? Number(opts.extras.categoryId)
    : creds.categoryId;

  const siteId = creds.siteId;

  const body: Record<string, unknown> = {
    name: title,
    name_ua: title,
    description_ua: description,
    description: description,
    price,
    currency: "UAH",
    status: 1, // 1 = active
    photos: photos.map((url, i) => ({ url, sort: i + 1, main: i === 0 })),
  };

  if (categoryId) body.category_id = categoryId;
  if (siteId) body.site_id = siteId;

  // Article/SKU
  if (product.model) body.article = product.model;

  // Attributes
  const attrs: { name: string; value: string }[] = [];
  const colors = Array.isArray(ai.colors) ? (ai.colors as string[]) : product.colors?.split(/[,;]/).map(s => s.trim()) || [];
  const sizes = Array.isArray(ai.sizes) ? (ai.sizes as string[]) : product.sizes?.split(/[,;]/).map(s => s.trim()) || [];
  const materials = Array.isArray(ai.materials) ? (ai.materials as string[]) : product.fabric ? [product.fabric] : [];

  if (colors.length) attrs.push({ name: "Колір", value: colors.join(", ") });
  if (sizes.length) attrs.push({ name: "Розмір", value: sizes.join(", ") });
  if (materials.length) attrs.push({ name: "Матеріал", value: materials.join(", ") });

  if (attrs.length) body.attributes = attrs;

  const doRequest = async (bearer: string) => {
    const r = await fetch(`${API_BASE}/goods/add`, {
      method: "POST",
      headers: headers(bearer) as any,
      body: JSON.stringify(body),
    });
    const data = await r.json() as any;
    return { r, data };
  };

  let { r, data } = await doRequest(token);

  // Access token may have gone stale — re-login once with the seller's own creds and retry.
  if (r.status === 401) {
    token = await rozetkaLogin(creds.login, creds.password);
    refreshedAccessToken = token;
    ({ r, data } = await doRequest(token));
  }

  if (!r.ok || data.status === "error") {
    const msg = data.message || data.errors?.join(", ") || `HTTP ${r.status}`;
    throw new Error(`Rozetka API помилка: ${msg}`);
  }

  const goodsId = data.data?.id;
  const url = goodsId
    ? `https://seller.rozetka.com.ua/goods/${goodsId}`
    : "https://seller.rozetka.com.ua/goods";
  return { externalPostId: url, refreshedAccessToken };
}
