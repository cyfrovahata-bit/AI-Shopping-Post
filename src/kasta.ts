import fetch from "node-fetch";
import type { ProductInput } from "./platform-types";

// Kasta.ua HUB API — https://hub.kasta.ua/api-docs/index.html
// Auth model: Kasta issues a personal token directly to suppliers with an active
// contract (no public self-serve OAuth app), sent as a raw `Authorization: <token>`
// header — NOT "Bearer "-prefixed, per the spec's own description text.
const API_BASE = "https://hub.kasta.ua/api";

function headers(token: string) {
  return {
    "Authorization": token,
    "Content-Type": "application/json",
  };
}

async function parseKastaResponse(r: { ok: boolean; status: number; text: () => Promise<string> }): Promise<any> {
  const raw = await r.text();
  let data: any;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Kasta: неочікувана відповідь (HTTP ${r.status}): ${raw.slice(0, 200)}`);
  }
  if (!r.ok) {
    const msg = data.message || (data.error ? JSON.stringify(data.error) : null) || `HTTP ${r.status}`;
    throw new Error(`Kasta API помилка: ${msg}`);
  }
  return data;
}

export async function kastaTestConnection(token: string): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: "Токен не задано" };
  try {
    const r = await fetch(`${API_BASE}/products/list`, { headers: headers(token) as any });
    await parseKastaResponse(r);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type KastaKind = { kindId: number; affiliationId: number; fullName: string };

// /api/supplier-content/category/all has no query params — it always returns the
// WHOLE category tree in one response (unlike Rozetka's server-side search
// endpoint), so it's cached in memory per token and filtered client-side here.
const categoryCache = new Map<string, { at: number; items: KastaKind[] }>();
const CATEGORY_CACHE_MS = 60 * 60 * 1000;

async function loadKastaCategories(token: string): Promise<KastaKind[]> {
  const cached = categoryCache.get(token);
  if (cached && Date.now() - cached.at < CATEGORY_CACHE_MS) return cached.items;

  const r = await fetch(`${API_BASE}/supplier-content/category/all`, { headers: headers(token) as any });
  const data = await parseKastaResponse(r);
  const items: KastaKind[] = [];
  for (const group of data.items || []) {
    const groupName = group.name_alias || group.name || "";
    for (const kind of group.kinds || []) {
      const kindName = kind.name_alias || kind.name || "";
      if (kind.kind_id == null || kind.affiliation_id == null) continue;
      items.push({
        kindId: kind.kind_id,
        affiliationId: kind.affiliation_id,
        fullName: groupName && kindName ? `${groupName} / ${kindName}` : (kindName || groupName || String(kind.kind_id)),
      });
    }
  }
  categoryCache.set(token, { at: Date.now(), items });
  return items;
}

export async function kastaSearchCategories(
  token: string,
  query: string
): Promise<{ kindId: number; affiliationId: number; name: string }[]> {
  const items = await loadKastaCategories(token);
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items
    .filter((it) => it.fullName.toLowerCase().includes(q))
    .slice(0, 20)
    .map((it) => ({ kindId: it.kindId, affiliationId: it.affiliationId, name: it.fullName }));
}

type KastaSpecItem = {
  key_name: string;
  human_name: string;
  type: "size" | "characteristic";
  requirements?: { "required?"?: boolean };
  value_ids?: { id: number; value: string }[];
  sizecharts?: { name: string; sizes: { id: number; value: string }[] }[];
};

async function loadKastaCategoryDetails(token: string, kindId: number, affiliationId: number): Promise<KastaSpecItem[]> {
  const q = new URLSearchParams({ kind_id: String(kindId), affiliation_id: String(affiliationId) });
  const r = await fetch(`${API_BASE}/supplier-content/category/details?${q}`, { headers: headers(token) as any });
  const data = await parseKastaResponse(r);
  return (data.schema || []) as KastaSpecItem[];
}

function norm(s: string) {
  return s.trim().toLowerCase();
}

// Kasta requires many category-specific characteristics (country of origin,
// material, color, etc.), each with its own numeric value_ids that must be looked
// up per category — there's no free-text option. Building a full dynamic form for
// every category is out of scope for now (same call made for Rozetka's params
// earlier), so this best-effort matches only what we already collect (color,
// material, size) plus a sensible "Україна" default for country-of-origin, and
// reports back any *required* characteristic it couldn't fill so the caller can
// surface a clear error instead of letting Kasta reject the whole submission.
async function buildKastaCharacteristics(
  token: string,
  kindId: number,
  affiliationId: number,
  product: ProductInput,
  ai: Record<string, unknown>,
  sizeLabel: string
): Promise<{ characteristics: { data: unknown; key_name: string }[]; missingRequired: string[] }> {
  let schema: KastaSpecItem[];
  try {
    schema = await loadKastaCategoryDetails(token, kindId, affiliationId);
  } catch {
    return { characteristics: [], missingRequired: [] };
  }

  const characteristics: { data: unknown; key_name: string }[] = [];
  const missingRequired: string[] = [];

  const colors = Array.isArray(ai.colors)
    ? (ai.colors as string[])
    : (product.colors?.split(/[,;]/).map((s) => s.trim()).filter(Boolean) || []);
  const materials = Array.isArray(ai.materials)
    ? (ai.materials as string[])
    : (product.fabric ? [product.fabric] : []);

  for (const item of schema) {
    const required = !!item.requirements?.["required?"];

    if (item.type === "size") {
      const charts = item.sizecharts || [];
      let matchedId: number | undefined;
      for (const chart of charts) {
        const found = chart.sizes.find((s) => norm(s.value) === norm(sizeLabel));
        if (found) { matchedId = found.id; break; }
      }
      if (!matchedId && sizeLabel) {
        for (const chart of charts) {
          const found = chart.sizes.find((s) => norm(s.value).includes(norm(sizeLabel)) || norm(sizeLabel).includes(norm(s.value)));
          if (found) { matchedId = found.id; break; }
        }
      }
      if (matchedId) {
        characteristics.push({ key_name: item.key_name, data: { sizes: { kasta_size: matchedId } } });
      } else if (required) {
        missingRequired.push(item.human_name);
      }
      continue;
    }

    const nameLc = norm(item.human_name);
    let values: string[] = [];
    if (/колір|колiр|цвет|цвіт/.test(nameLc)) values = colors;
    else if (/матеріал|материал|склад|тканина/.test(nameLc)) values = materials;
    else if (/країна|страна/.test(nameLc)) values = ["Україна", "Украина"];

    if (values.length && item.value_ids?.length) {
      const ids: number[] = [];
      for (const v of values) {
        const vLc = norm(v);
        const found = item.value_ids.find((vi) => {
          const label = norm(vi.value);
          return label && (label.includes(vLc) || vLc.includes(label));
        });
        if (found && !ids.includes(found.id)) ids.push(found.id);
      }
      if (ids.length) {
        characteristics.push({ key_name: item.key_name, data: { ids } });
        continue;
      }
    }

    if (required) missingRequired.push(item.human_name);
  }

  return { characteristics, missingRequired };
}

async function uploadKastaImage(token: string, imageUrl: string): Promise<string> {
  const r = await fetch(`${API_BASE}/supplier-content/submit/image`, {
    method: "POST",
    headers: headers(token) as any,
    body: JSON.stringify({ url: imageUrl }),
  });
  const data = await parseKastaResponse(r);
  if (!data.path) throw new Error("Kasta не повернула шлях до завантаженого фото");
  return data.path as string;
}

export async function publishKastaPost(opts: {
  product: ProductInput;
  text: string;
  photoPaths: string[];
  imageUrls: string[];
  extras?: Record<string, unknown>;
  creds?: { accessToken: string; kindId?: number; affiliationId?: number; categoryName?: string };
}): Promise<{ externalPostId: string }> {
  const creds = opts.creds;
  if (!creds?.accessToken) {
    throw new Error("Kasta не підключено. Додайте токен постачальника у Налаштуваннях.");
  }
  const token = creds.accessToken;

  const kindId = opts.extras?.kindId ? Number(opts.extras.kindId) : creds.kindId;
  const affiliationId = opts.extras?.affiliationId ? Number(opts.extras.affiliationId) : creds.affiliationId;
  if (!kindId || !affiliationId) {
    throw new Error("Не обрано категорію Kasta. Обери категорію товару у Налаштуваннях.");
  }

  const { product, text, imageUrls } = opts;
  const siteUrl = process.env.SITE_URL || "";

  let ai: Record<string, unknown> = {};
  try {
    const m = text.match(/```(?:json)?\s*([\s\S]+?)```/i);
    const raw = m ? m[1].trim() : text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    ai = JSON.parse(raw);
  } catch {
    try {
      const m = text.match(/\{[\s\S]+\}/);
      if (m) ai = JSON.parse(m[0]);
    } catch {}
  }

  const title = (typeof ai.title === "string" ? ai.title : product.title).slice(0, 250);
  const description = typeof ai.description === "string" ? ai.description : product.description || product.title;
  const price = Math.round(parseFloat(String(product.price).replace(/[^\d.]/g, "")) || 0);
  // Kasta's own price fields are "old_price" (displayed/was price) and
  // "supplier_price" (cost price Kasta pays the supplier) — there's no single
  // "retail price" field. We only ever collect one retail price from the seller,
  // so old_price uses it directly; supplier_price falls back to the drop/wholesale
  // price if the seller set one, otherwise the same price (no separate cost data).
  const supplierPrice = product.dropPrice
    ? Math.round(parseFloat(String(product.dropPrice).replace(/[^\d.]/g, "")) || 0)
    : price;

  const urls: string[] = [];
  for (const u of imageUrls) {
    const full = !u.startsWith("http") && siteUrl ? `${siteUrl.replace(/\/$/, "")}${u}` : u;
    if (full.startsWith("http")) urls.push(full);
  }
  if (!urls.length) {
    throw new Error("Немає жодного публічного фото для публікації на Kasta (потрібен налаштований SITE_URL)");
  }

  const uploadedImages: string[] = [];
  for (const u of urls.slice(0, 10)) {
    uploadedImages.push(await uploadKastaImage(token, u));
  }

  const sizes = Array.isArray(ai.sizes)
    ? (ai.sizes as string[])
    : (product.sizes?.split(/[,;]/).map((s) => s.trim()).filter(Boolean) || []);
  const colorsArr = Array.isArray(ai.colors)
    ? (ai.colors as string[])
    : (product.colors?.split(/[,;]/).map((s) => s.trim()).filter(Boolean) || []);
  const color = colorsArr[0] || "";
  const brand = (typeof ai.brand === "string" && ai.brand.trim()) || "Без бренду";

  const variants: Record<string, unknown>[] = [];
  const missingByVariant: string[][] = [];
  const targetSizes = sizes.length ? sizes : ["one size"];

  for (const size of targetSizes) {
    const { characteristics, missingRequired } = await buildKastaCharacteristics(token, kindId, affiliationId, product, ai, size);
    missingByVariant.push(missingRequired);
    variants.push({
      color,
      images: uploadedImages,
      name_uk: title,
      brand,
      description_uk: description,
      model: product.model || "",
      code: `${product.title.replace(/\s+/g, "-").slice(0, 30)}-${size}`.toLowerCase(),
      old_price: price,
      supplier_price: supplierPrice,
      characteristics,
      size,
      stock: 1,
    });
  }

  const allMissing = [...new Set(missingByVariant.flat())];
  if (allMissing.length) {
    throw new Error(`Kasta вимагає ще характеристики для цієї категорії, які не заповнюються автоматично: ${allMissing.join(", ")}`);
  }

  const r = await fetch(`${API_BASE}/supplier-content/submit/products`, {
    method: "POST",
    headers: headers(token) as any,
    body: JSON.stringify({ kind_id: kindId, affiliation_id: affiliationId, update: true, data: variants }),
  });
  const data = await parseKastaResponse(r);

  if (!data.upload_id) {
    throw new Error("Kasta не повернула ID завантаження товару");
  }

  return { externalPostId: String(data.upload_id) };
}
