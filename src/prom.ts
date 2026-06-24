import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { readEnv } from "./facebook-auth";

const API_BASE = "https://my.prom.ua/api/v1";

interface PromPhoto {
  url?: string;
  base64_data?: string;
  base64_name?: string;
}

interface PromAttribute {
  name: string;
  value: string;
}

interface PromApiProduct {
  name: string;
  description: string;
  price: number;
  currency: string;
  keywords: string;
  category_id?: number;
  photos: PromPhoto[];
  status: string;
  presence: string;
  sku?: string;
  quantity?: number;
  attributes?: PromAttribute[];
}

function getToken() {
  const env = readEnv();
  return env.PROM_API_TOKEN || process.env.PROM_API_TOKEN || "";
}

function headers() {
  return {
    "Authorization": `Bearer ${getToken()}`,
    "Content-Type": "application/json",
  };
}

export async function promTestConnection(): Promise<{ ok: boolean; shopName?: string; error?: string }> {
  const token = getToken();
  if (!token) return { ok: false, error: "PROM_API_TOKEN не задано" };
  try {
    const r = await fetch(`${API_BASE}/products/list`, {
      headers: headers() as any,
    });
    const d = await r.json() as any;
    if (!r.ok) return { ok: false, error: d.error_message || d.message || `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Search categories by name keyword
export async function promSearchCategories(query: string): Promise<{ id: number; name: string; fullName: string }[]> {
  try {
    const r = await fetch(`${API_BASE}/categories/list`, { headers: headers() as any });
    const d = await r.json() as any;
    if (!d.categories) return [];
    const q = query.toLowerCase();
    return (d.categories as any[])
      .filter(c => (c.full_name || c.name || "").toLowerCase().includes(q))
      .slice(0, 20)
      .map(c => ({ id: c.id, name: c.name, fullName: c.full_name || c.name }));
  } catch { return []; }
}

function fileToBase64(filePath: string): { base64_data: string; base64_name: string } | null {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase() || "jpg";
    return {
      base64_data: `data:image/${ext};base64,${data.toString("base64")}`,
      base64_name: path.basename(filePath),
    };
  } catch { return null; }
}

function buildPhotos(photoPaths: string[], imageUrls: string[], siteUrl: string): PromPhoto[] {
  const photos: PromPhoto[] = [];
  for (let i = 0; i < Math.min(photoPaths.length, 10); i++) {
    const localPath = photoPaths[i];
    if (localPath && fs.existsSync(localPath)) {
      const b64 = fileToBase64(localPath);
      if (b64) { photos.push(b64); continue; }
    }
    if (siteUrl && imageUrls[i]) {
      const url = imageUrls[i].startsWith("http")
        ? imageUrls[i]
        : `${siteUrl.replace(/\/$/, "")}${imageUrls[i]}`;
      photos.push({ url });
    }
  }
  if (!photos.length) {
    for (const url of imageUrls.slice(0, 10)) {
      const full = siteUrl && !url.startsWith("http") ? `${siteUrl.replace(/\/$/, "")}${url}` : url;
      if (full.startsWith("http")) photos.push({ url: full });
    }
  }
  return photos;
}

// Build attributes array from product data
function buildAttributes(ai: Record<string, unknown>, product: import("./platform-types").ProductInput): PromAttribute[] {
  const attrs: PromAttribute[] = [];

  // Colors
  const colors: string[] = Array.isArray(ai.colors)
    ? (ai.colors as string[])
    : product.colors ? product.colors.split(/[,;]/).map(s => s.trim()).filter(Boolean) : [];
  if (colors.length) attrs.push({ name: "Колір", value: colors.join(", ") });

  // Sizes
  const sizes: string[] = Array.isArray(ai.sizes)
    ? (ai.sizes as string[])
    : product.sizes ? product.sizes.split(/[,;]/).map(s => s.trim()).filter(Boolean) : [];
  if (sizes.length) attrs.push({ name: "Розмір", value: sizes.join(", ") });

  // Material/fabric
  const materials: string[] = Array.isArray(ai.materials)
    ? (ai.materials as string[])
    : product.fabric ? product.fabric.split(/[,;]/).map(s => s.trim()).filter(Boolean) : [];
  if (materials.length) attrs.push({ name: "Матеріал", value: materials.join(", ") });

  // Season
  const seasons: string[] = Array.isArray(ai.seasons) ? (ai.seasons as string[]) : [];
  if (seasons.length) attrs.push({ name: "Сезон", value: seasons.join(", ") });

  // Style
  const styles: string[] = Array.isArray(ai.style) ? (ai.style as string[]) : [];
  if (styles.length) attrs.push({ name: "Стиль", value: styles.join(", ") });

  // Country
  attrs.push({ name: "Країна виробник", value: "Україна" });

  return attrs;
}

// Build rich HTML description
function buildDescription(ai: Record<string, unknown>, product: import("./platform-types").ProductInput): string {
  const base = typeof ai.description === "string" ? ai.description : product.description || product.title;

  const sizes = Array.isArray(ai.sizes) ? (ai.sizes as string[]) : product.sizes?.split(/[,;]/).map(s => s.trim()) || [];
  const materials = Array.isArray(ai.materials) ? (ai.materials as string[]) : product.fabric ? [product.fabric] : [];
  const colors = Array.isArray(ai.colors) ? (ai.colors as string[]) : product.colors?.split(/[,;]/).map(s => s.trim()) || [];

  let html = `<p>${base}</p>`;

  if (materials.length || colors.length || sizes.length) {
    html += `<br><p><strong>Характеристики:</strong></p><ul>`;
    if (colors.length)    html += `<li>Колір: ${colors.join(", ")}</li>`;
    if (materials.length) html += `<li>Матеріал: ${materials.join(", ")}</li>`;
    if (sizes.length)     html += `<li>Розміри в наявності: ${sizes.join(", ")}</li>`;
    html += `</ul>`;
  }

  if (product.description && base !== product.description) {
    html += `<p>${product.description}</p>`;
  }

  html += `<p><strong>Виробництво:</strong> Україна</p>`;

  return html;
}

export async function publishToProm(opts: {
  name: string;
  description: string;
  price: number;
  keywords: string;
  categoryId?: number;
  photos: PromPhoto[];
  attributes: PromAttribute[];
  sku?: string;
  quantity: number;
}): Promise<{ externalPostId: string }> {
  const token = getToken();
  if (!token) throw new Error("PROM_API_TOKEN не задано у .env");

  const product: PromApiProduct = {
    name: opts.name.slice(0, 120),
    description: opts.description,
    price: opts.price,
    currency: "UAH",
    keywords: opts.keywords,
    photos: opts.photos,
    status: "on_display",
    presence: "available",
    quantity: opts.quantity,
    attributes: opts.attributes,
  };

  if (opts.categoryId) product.category_id = opts.categoryId;
  if (opts.sku) product.sku = opts.sku;

  const tokenVal = getToken();
  console.log(`[Prom] token present: ${!!tokenVal}, length: ${tokenVal.length}`);

  // Prom API: { products: [...] } returns 200; log minimal body for debugging
  const minProduct = { name: product.name, price: product.price, currency: product.currency, status: product.status, presence: product.presence };
  console.log(`[Prom] request body (minimal): ${JSON.stringify({ products: [minProduct] })}`);

  const r = await fetch(`${API_BASE}/products/edit_list`, {
    method: "POST",
    headers: headers() as any,
    body: JSON.stringify({ products: [product] }),
  });

  const rawText = await r.text();
  console.log(`[Prom] response status: ${r.status}, full body: ${rawText.slice(0, 1000)}`);

  let data: any;
  try { data = JSON.parse(rawText); }
  catch { throw new Error(`Prom API повернув не-JSON (${r.status}): ${rawText.slice(0, 300)}`); }

  // Check for errors — errors can be object or array
  const hasErrors = Array.isArray(data.errors)
    ? data.errors.length > 0
    : data.errors && Object.keys(data.errors).length > 0;
  if (!r.ok || hasErrors) {
    const errMsg = Array.isArray(data.errors) ? data.errors[0] : (data.errors?.error || data.error_message || data.message || `HTTP ${r.status}`);
    throw new Error(`Prom API помилка: ${JSON.stringify(errMsg)}`);
  }

  const createdId = data.processed_ids?.[0] ?? data.ids?.[0];
  const url = createdId
    ? `https://my.prom.ua/cms/product/list`
    : "https://my.prom.ua/cms/product/list";

  return { externalPostId: url };
}

export async function publishPromPost(opts: {
  product: import("./platform-types").ProductInput;
  text: string;
  photoPaths: string[];
  imageUrls: string[];
  extras?: Record<string, unknown>;
}): Promise<{ externalPostId: string }> {
  const { product, text, photoPaths, imageUrls, extras } = opts;
  const siteUrl = process.env.SITE_URL || "";

  // Parse AI JSON (handle markdown code blocks and prefix text)
  let ai: Record<string, unknown> = {};
  try {
    const m = text.match(/```(?:json)?\s*([\s\S]+?)```/i);
    const raw = m ? m[1].trim() : text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    ai = JSON.parse(raw);
  } catch {
    try { const m = text.match(/\{[\s\S]+\}/); if (m) ai = JSON.parse(m[0]); } catch {}
  }

  const title = typeof ai.title === "string" ? ai.title : product.title;
  const description = buildDescription(ai, product);
  const keywords = Array.isArray(ai.keywords)
    ? (ai.keywords as string[]).join(", ")
    : [product.title, product.colors, product.fabric].filter(Boolean).join(", ");

  const price = parseFloat(String(product.price).replace(/[^\d.]/g, "")) || 0;
  const photos = buildPhotos(photoPaths, imageUrls, siteUrl);
  const attributes = buildAttributes(ai, product);

  // Category: from extras (user pick) → from AI → from env default
  const categoryId = extras?.categoryId
    ? Number(extras.categoryId)
    : typeof ai.categoryId === "number"
      ? ai.categoryId
      : process.env.PROM_DEFAULT_CATEGORY_ID
        ? Number(process.env.PROM_DEFAULT_CATEGORY_ID)
        : undefined;

  const sku = typeof product.model === "string" && product.model ? product.model : undefined;

  return publishToProm({
    name: title,
    description,
    price,
    keywords,
    categoryId,
    photos,
    attributes,
    sku,
    quantity: 10,
  });
}
