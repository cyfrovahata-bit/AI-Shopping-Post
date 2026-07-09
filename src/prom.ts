import fetch from "node-fetch";

const API_BASE = "https://my.prom.ua/api/v1";

interface PromApiProduct {
  name: string;
  description: string;
  price: number;
  currency: string;
  keywords: string;
  category?: { id: number };
  main_image?: string;
  images?: { url: string }[];
  status: string;
  presence: string;
  sku?: string;
  quantity_in_stock?: number;
}

function headers(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function promTestConnection(token: string): Promise<{ ok: boolean; shopName?: string; error?: string }> {
  if (!token) return { ok: false, error: "Токен не задано" };
  try {
    const r = await fetch(`${API_BASE}/products/list`, {
      headers: headers(token) as any,
    });
    const d = await r.json() as any;
    if (!r.ok) return { ok: false, error: d.error_message || d.message || `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Search categories by name keyword
export async function promSearchCategories(token: string, query: string): Promise<{ id: number; name: string; fullName: string }[]> {
  try {
    const r = await fetch(`${API_BASE}/categories/list`, { headers: headers(token) as any });
    const d = await r.json() as any;
    if (!d.categories) return [];
    const q = query.toLowerCase();
    return (d.categories as any[])
      .filter(c => (c.full_name || c.name || "").toLowerCase().includes(q))
      .slice(0, 20)
      .map(c => ({ id: c.id, name: c.name, fullName: c.full_name || c.name }));
  } catch { return []; }
}

// Prom's product API only accepts public image URLs (main_image + images[].url) —
// there is no raw file/base64 upload on this endpoint, so a public SITE_URL is required.
function buildPhotos(imageUrls: string[], siteUrl: string): string[] {
  const photos: string[] = [];
  for (const url of imageUrls.slice(0, 10)) {
    if (!url) continue;
    const full = url.startsWith("http")
      ? url
      : siteUrl ? `${siteUrl.replace(/\/$/, "")}${url}` : "";
    if (full.startsWith("http")) photos.push(full);
  }
  return photos;
}

// Build rich HTML description — Prom's product API has no generic "attributes" field,
// so colors/materials/sizes/season/style are folded into the description text instead.
function buildDescription(ai: Record<string, unknown>, product: import("./platform-types").ProductInput): string {
  const base = typeof ai.description === "string" ? ai.description : product.description || product.title;

  const sizes = Array.isArray(ai.sizes) ? (ai.sizes as string[]) : product.sizes?.split(/[,;]/).map(s => s.trim()) || [];
  const materials = Array.isArray(ai.materials) ? (ai.materials as string[]) : product.fabric ? [product.fabric] : [];
  const colors = Array.isArray(ai.colors) ? (ai.colors as string[]) : product.colors?.split(/[,;]/).map(s => s.trim()) || [];
  const seasons = Array.isArray(ai.seasons) ? (ai.seasons as string[]) : [];
  const styles = Array.isArray(ai.style) ? (ai.style as string[]) : [];

  let html = `<p>${base}</p>`;

  if (materials.length || colors.length || sizes.length || seasons.length || styles.length) {
    html += `<br><p><strong>Характеристики:</strong></p><ul>`;
    if (colors.length)    html += `<li>Колір: ${colors.join(", ")}</li>`;
    if (materials.length) html += `<li>Матеріал: ${materials.join(", ")}</li>`;
    if (sizes.length)     html += `<li>Розміри в наявності: ${sizes.join(", ")}</li>`;
    if (seasons.length)   html += `<li>Сезон: ${seasons.join(", ")}</li>`;
    if (styles.length)    html += `<li>Стиль: ${styles.join(", ")}</li>`;
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
  photos: string[];
  sku?: string;
  quantity: number;
  token: string;
}): Promise<{ externalPostId: string }> {
  const token = opts.token;
  if (!token) throw new Error("Prom.ua не підключено. Підключіть свій акаунт у Налаштуваннях.");
  if (!opts.photos.length) throw new Error("Prom.ua вимагає хоча б одне фото товару.");

  const product: PromApiProduct = {
    name: opts.name.slice(0, 110),
    description: opts.description,
    price: opts.price,
    currency: "UAH",
    keywords: opts.keywords,
    main_image: opts.photos[0],
    images: opts.photos.slice(1).map(url => ({ url })),
    status: "on_display",
    presence: "available",
    quantity_in_stock: opts.quantity,
  };

  if (opts.categoryId) product.category = { id: opts.categoryId };
  if (opts.sku) product.sku = opts.sku;

  console.log(`[Prom] sending to /products/edit:`, JSON.stringify({ products: [product] }));

  const r = await fetch(`${API_BASE}/products/edit`, {
    method: "POST",
    headers: headers(token) as any,
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
  creds?: { accessToken: string; categoryId?: number };
}): Promise<{ externalPostId: string }> {
  const { product, text, imageUrls, extras, creds } = opts;
  if (!creds?.accessToken) {
    throw new Error("Prom.ua не підключено. Підключіть свій акаунт у Налаштуваннях.");
  }
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
  const photos = buildPhotos(imageUrls, siteUrl);

  // Category: from extras (per-listing pick) → from AI → from user's saved default
  const categoryId = extras?.categoryId
    ? Number(extras.categoryId)
    : typeof ai.categoryId === "number"
      ? ai.categoryId
      : creds.categoryId;

  const sku = typeof product.model === "string" && product.model ? product.model : undefined;

  return publishToProm({
    name: title,
    description,
    price,
    keywords: keywords.slice(0, 1024),
    categoryId,
    photos,
    sku,
    quantity: 10,
    token: creds.accessToken,
  });
}
