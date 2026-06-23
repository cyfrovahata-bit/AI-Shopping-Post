import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const API_BASE = "https://my.prom.ua/api/v1";

interface PromPhoto {
  url?: string;
  base64_data?: string;
  base64_name?: string;
}

interface PromProductInput {
  name: string;
  description: string;
  price: number;
  currency: "UAH";
  keywords: string;
  categoryId?: number;
  photos: PromPhoto[];
  status: "on_display" | "draft";
  presence: "available" | "not_available" | "order";
  sku?: string;
  quantity?: number;
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
}

function getToken() {
  return process.env.PROM_API_TOKEN || "";
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
    const r = await fetch(`${API_BASE}/products/list?limit=1`, {
      headers: headers() as any,
    });
    const d = await r.json() as any;
    if (!r.ok) return { ok: false, error: d.error_message || d.message || `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Convert local file path to base64 for Prom upload
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

  // Prefer local files (base64) if available, else use public URLs
  for (let i = 0; i < Math.min(photoPaths.length, 10); i++) {
    const localPath = photoPaths[i];
    if (localPath && fs.existsSync(localPath)) {
      const b64 = fileToBase64(localPath);
      if (b64) { photos.push(b64); continue; }
    }
    // Fallback: construct public URL
    if (siteUrl && imageUrls[i]) {
      const url = imageUrls[i].startsWith("http")
        ? imageUrls[i]
        : `${siteUrl.replace(/\/$/, "")}${imageUrls[i]}`;
      photos.push({ url });
    }
  }

  // If no local files, use URLs only
  if (!photos.length) {
    for (const url of imageUrls.slice(0, 10)) {
      const full = siteUrl && !url.startsWith("http")
        ? `${siteUrl.replace(/\/$/, "")}${url}`
        : url;
      if (full.startsWith("http")) photos.push({ url: full });
    }
  }

  return photos;
}

export async function publishToProm(input: PromProductInput): Promise<{ externalPostId: string }> {
  const token = getToken();
  if (!token) throw new Error("PROM_API_TOKEN не задано у .env");

  const product: PromApiProduct = {
    name: input.name.slice(0, 120),
    description: input.description,
    price: input.price,
    currency: "UAH",
    keywords: input.keywords,
    photos: input.photos,
    status: input.status,
    presence: input.presence,
  };

  if (input.categoryId) product.category_id = input.categoryId;
  if (input.sku) product.sku = input.sku;
  if (input.quantity != null) product.quantity = input.quantity;

  const body = JSON.stringify({ products: [product] });

  const r = await fetch(`${API_BASE}/products/edit_list`, {
    method: "POST",
    headers: headers() as any,
    body,
  });

  const data = await r.json() as any;

  if (!r.ok || data.errors?.length) {
    const errMsg = data.errors?.[0] || data.error_message || data.message || `HTTP ${r.status}`;
    throw new Error(`Prom API помилка: ${errMsg}`);
  }

  const created = data.processed_ids?.[0] ?? data.ids?.[0];
  const productId = String(created || "created");
  const url = created ? `https://prom.ua/p${productId}` : "https://my.prom.ua/cms/product/list";

  return { externalPostId: url };
}

// Fetch top-level categories for clothing section (for UI display)
export async function promGetCategories(): Promise<{ id: number; name: string }[]> {
  const r = await fetch(`${API_BASE}/categories/list`, { headers: headers() as any });
  const d = await r.json() as any;
  if (!d.categories) return [];
  return (d.categories as any[]).map(c => ({ id: c.id, name: c.full_name || c.name }));
}

// Main entry: map ProductInput → publish
export async function publishPromPost(opts: {
  product: import("./platform-types").ProductInput;
  text: string;
  photoPaths: string[];
  imageUrls: string[];
  extras?: Record<string, unknown>;
}): Promise<{ externalPostId: string }> {
  const { product, text, photoPaths, imageUrls, extras } = opts;
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

  const title = typeof ai.title === "string" ? ai.title : product.title;
  const description = typeof ai.description === "string" ? ai.description : text;
  const keywords = Array.isArray(ai.keywords)
    ? (ai.keywords as string[]).join(", ")
    : (product.title + (product.colors ? ", " + product.colors : ""));

  const price = parseFloat(String(product.price).replace(/[^\d.]/g, "")) || 0;
  const photos = buildPhotos(photoPaths, imageUrls, siteUrl);

  const categoryId = extras?.categoryId
    ? Number(extras.categoryId)
    : (typeof ai.categoryId === "number" ? ai.categoryId : undefined);

  const sku = typeof product.model === "string" && product.model ? product.model : undefined;

  return publishToProm({
    name: title,
    description,
    price,
    currency: "UAH",
    keywords,
    categoryId,
    photos,
    status: "on_display",
    presence: "available",
    sku,
    quantity: 10,
  });
}
