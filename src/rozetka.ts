import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import type { ProductInput } from "./platform-types";

// Rozetka Partner API — requires partnership agreement at rozetka.com.ua
// API endpoint for approved partners: https://api.seller.rozetka.com.ua
const API_BASE = "https://api.seller.rozetka.com.ua";

function getToken() {
  return process.env.ROZETKA_ACCESS_TOKEN || "";
}

function headers() {
  return {
    "Authorization": `Bearer ${getToken()}`,
    "Content-Type": "application/json",
  };
}

export async function rozetkaTestConnection(): Promise<{ ok: boolean; shopName?: string; error?: string }> {
  const token = getToken();
  if (!token) return { ok: false, error: "ROZETKA_ACCESS_TOKEN не задано" };
  try {
    const r = await fetch(`${API_BASE}/sites`, { headers: headers() as any });
    const d = await r.json() as any;
    if (!r.ok) return { ok: false, error: d.message || `HTTP ${r.status}` };
    const shopName = d.data?.sites?.[0]?.title || "OK";
    return { ok: true, shopName };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function rozetkaLogin(): Promise<void> {
  const login = process.env.ROZETKA_LOGIN || "";
  const password = process.env.ROZETKA_PASSWORD || "";
  if (!login || !password) throw new Error("ROZETKA_LOGIN і ROZETKA_PASSWORD не задано");

  const r = await fetch(`${API_BASE}/sites/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" } as any,
    body: JSON.stringify({ username: login, password }),
  });

  const d = await r.json() as any;
  if (!d.data?.access_token) throw new Error(`Rozetka login failed: ${d.message || JSON.stringify(d)}`);

  const { writeEnvVars } = await import("./facebook-auth");
  writeEnvVars({ ROZETKA_ACCESS_TOKEN: d.data.access_token });
}

// Upload a photo from file or URL and return Rozetka photo object
async function uploadPhoto(filePath: string): Promise<{ url: string } | null> {
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
        "Authorization": `Bearer ${getToken()}`,
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
}): Promise<{ externalPostId: string }> {
  const token = getToken();
  if (!token) {
    // Try to login first
    await rozetkaLogin();
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
      const res = await uploadPhoto(p);
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
    : process.env.ROZETKA_DEFAULT_CATEGORY_ID
      ? Number(process.env.ROZETKA_DEFAULT_CATEGORY_ID)
      : undefined;

  const siteId = process.env.ROZETKA_SITE_ID ? Number(process.env.ROZETKA_SITE_ID) : undefined;

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

  const r = await fetch(`${API_BASE}/goods/add`, {
    method: "POST",
    headers: headers() as any,
    body: JSON.stringify(body),
  });

  const data = await r.json() as any;

  if (!r.ok || data.status === "error") {
    const msg = data.message || data.errors?.join(", ") || `HTTP ${r.status}`;
    throw new Error(`Rozetka API помилка: ${msg}`);
  }

  const goodsId = data.data?.id;
  const url = goodsId
    ? `https://seller.rozetka.com.ua/goods/${goodsId}`
    : "https://seller.rozetka.com.ua/goods";
  return { externalPostId: url };
}
