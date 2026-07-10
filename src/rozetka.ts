import fetch from "node-fetch";
import fs from "fs";
import type { ProductInput } from "./platform-types";

// Rozetka Marketplace API — https://api-seller.rozetka.com.ua/apidoc/
// Auth model: each seller generates their own long-lived API token in their own
// cabinet (seller.rozetka.com.ua → Налаштування → Безпека API → "Згенерувати API
// токен"). There is no shared dev OAuth app for Rozetka — every request below is
// authenticated with that per-user token.
const API_BASE = "https://api-seller.rozetka.com.ua";

type RozetkaCategory = { id: number; title: string; title_ua: string; parent_id: number; is_vendor_required: number };
type RozetkaAttribute = { id: number; title: string; title_ua: string; type: string };
type RozetkaAttributeValue = { id: number; title: string; title_ua: string };

function headers(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Content-Language": "uk",
  };
}

// Rozetka returns HTTP 200 even for logical errors — the real result is in the
// { success, content } / { success, errors } envelope, not the status code.
async function parseRozetkaResponse(r: { ok: boolean; status: number; text: () => Promise<string> }): Promise<any> {
  const raw = await r.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Rozetka: неочікувана відповідь (HTTP ${r.status}): ${raw.slice(0, 200)}`);
  }
  if (data.success === false) {
    const msg = data.errors?.message || (data.errors?.details ? JSON.stringify(data.errors.details) : null) || `HTTP ${r.status}`;
    throw new Error(`Rozetka API помилка: ${msg}`);
  }
  return data.content;
}

export async function rozetkaTestConnection(token: string): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: "Токен не задано" };
  try {
    const r = await fetch(`${API_BASE}/balances/status`, { headers: headers(token) as any });
    await parseRozetkaResponse(r);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function rozetkaSearchCategories(token: string, title: string): Promise<{ id: number; name: string; fullName: string }[]> {
  const q = new URLSearchParams({ title, is_vendor_required: "0", pageSize: "20" });
  const r = await fetch(`${API_BASE}/items-create/categories?${q}`, { headers: headers(token) as any });
  const content = await parseRozetkaResponse(r);
  const categories = (content?.categories || []) as RozetkaCategory[];
  return categories.map((c) => ({ id: c.id, name: c.title_ua || c.title, fullName: c.title_ua || c.title }));
}

async function rozetkaGetAttributes(token: string, categoryId: number): Promise<RozetkaAttribute[]> {
  const q = new URLSearchParams({ category_id: String(categoryId), pageSize: "100" });
  const r = await fetch(`${API_BASE}/items-create/attributes?${q}`, { headers: headers(token) as any });
  const content = await parseRozetkaResponse(r);
  return (content?.attributes || []) as RozetkaAttribute[];
}

async function rozetkaGetValues(token: string, categoryId: number, attributeId: number): Promise<RozetkaAttributeValue[]> {
  const q = new URLSearchParams({ category_id: String(categoryId), attribute_id: String(attributeId), pageSize: "50" });
  const r = await fetch(`${API_BASE}/items-create/values?${q}`, { headers: headers(token) as any });
  const content = await parseRozetkaResponse(r);
  return (content?.attributeValues || []) as RozetkaAttributeValue[];
}

const LIST_ATTR_TYPES = new Set(["List", "ListValues", "ComboBox", "CheckBoxGroup", "CheckBoxGroupValues"]);
const TEXT_ATTR_TYPES = new Set(["Text", "TextArea", "TextInput"]);

// Rozetka's product characteristics ("params") aren't free text — each one must be
// looked up by category (id/type), and list-type values must be matched to an option
// id from Rozetka's own dictionary. Building a full attribute-mapping UI is out of
// scope for now, so this best-effort matches only the fields that matter most for a
// clothing listing (color, size, material) by name, and silently skips the rest —
// a listing without an exact attribute match is still far better than one that fails
// to publish at all.
async function buildRozetkaParams(
  token: string,
  categoryId: number,
  product: ProductInput,
  ai: Record<string, unknown>
): Promise<{ id: number; title: string; type: string; value: unknown; value_ua?: string }[]> {
  const params: { id: number; title: string; type: string; value: unknown; value_ua?: string }[] = [];

  let attributes: RozetkaAttribute[];
  try {
    attributes = await rozetkaGetAttributes(token, categoryId);
  } catch {
    return params;
  }

  const colors = Array.isArray(ai.colors) ? (ai.colors as string[]) : (product.colors?.split(/[,;]/).map((s) => s.trim()).filter(Boolean) || []);
  const sizes = Array.isArray(ai.sizes) ? (ai.sizes as string[]) : (product.sizes?.split(/[,;]/).map((s) => s.trim()).filter(Boolean) || []);
  const materials = Array.isArray(ai.materials) ? (ai.materials as string[]) : (product.fabric ? [product.fabric] : []);

  const wanted: { pattern: RegExp; values: string[] }[] = [];
  if (colors.length) wanted.push({ pattern: /колір|цвет/i, values: colors });
  if (sizes.length) wanted.push({ pattern: /розмір|размер/i, values: sizes });
  if (materials.length) wanted.push({ pattern: /матеріал|материал|тканина|склад/i, values: materials });

  for (const w of wanted) {
    const attr = attributes.find((a) => w.pattern.test(a.title_ua || a.title));
    if (!attr) continue;

    if (LIST_ATTR_TYPES.has(attr.type)) {
      let values: RozetkaAttributeValue[];
      try {
        values = await rozetkaGetValues(token, categoryId, attr.id);
      } catch {
        continue;
      }
      const matched: { id: number; value: string }[] = [];
      for (const wantedValue of w.values) {
        const wv = wantedValue.toLowerCase();
        const found = values.find((v) => {
          const label = (v.title_ua || v.title || "").toLowerCase();
          return label && (label.includes(wv) || wv.includes(label));
        });
        if (found && !matched.some((m) => m.id === found.id)) {
          matched.push({ id: found.id, value: found.title_ua || found.title });
        }
      }
      if (matched.length) {
        params.push({ id: attr.id, title: attr.title_ua || attr.title, type: attr.type, value: matched });
      }
    } else if (TEXT_ATTR_TYPES.has(attr.type)) {
      const joined = w.values.join(", ");
      params.push({ id: attr.id, title: attr.title_ua || attr.title, type: attr.type, value: joined, value_ua: joined });
    }
  }

  return params;
}

export async function publishRozetkaPost(opts: {
  product: ProductInput;
  text: string;
  photoPaths: string[];
  imageUrls: string[];
  extras?: Record<string, unknown>;
  creds?: { accessToken: string; categoryId?: number; categoryName?: string };
}): Promise<{ externalPostId: string }> {
  const creds = opts.creds;
  if (!creds?.accessToken) {
    throw new Error("Rozetka не підключено. Додайте API-токен у Налаштуваннях.");
  }
  const token = creds.accessToken;

  const categoryId = opts.extras?.categoryId ? Number(opts.extras.categoryId) : creds.categoryId;
  if (!categoryId) {
    throw new Error("Не обрано категорію Rozetka. Обери категорію товару у Налаштуваннях.");
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
    try {
      const m = text.match(/\{[\s\S]+\}/);
      if (m) ai = JSON.parse(m[0]);
    } catch {}
  }

  const title = (typeof ai.title === "string" ? ai.title : product.title).slice(0, 250);
  const description = typeof ai.description === "string" ? ai.description : product.description || product.title;
  const price = Math.round(parseFloat(String(product.price).replace(/[^\d.]/g, "")) || 0);

  // Rozetka accepts either a public image URL or a base64-encoded file body per
  // picture — no separate upload endpoint. Prefer URLs (cheaper/faster), fall back
  // to base64 only if we have no public URL to offer.
  const pictures: { link?: string; body?: string }[] = [];
  for (const u of imageUrls.slice(0, 15)) {
    const full = !u.startsWith("http") && siteUrl ? `${siteUrl.replace(/\/$/, "")}${u}` : u;
    if (full.startsWith("http")) pictures.push({ link: full });
  }
  if (!pictures.length) {
    for (const p of photoPaths.slice(0, 15)) {
      if (fs.existsSync(p)) pictures.push({ body: fs.readFileSync(p).toString("base64") });
    }
  }
  if (!pictures.length) {
    throw new Error("Немає жодного фото для публікації на Rozetka");
  }

  const params = await buildRozetkaParams(token, categoryId, product, ai);

  const body: Record<string, unknown> = {
    name: title,
    name_ua: title,
    category_id: categoryId,
    price,
    stock_quantity: 1,
    state: 1, // новий товар
    pictures,
    description,
    description_ua: description,
    is_approve: true, // одразу відправити на модерацію, а не лишити чернеткою
  };
  if (product.model) body.article = product.model;
  if (params.length) body.params = params;

  const r = await fetch(`${API_BASE}/items-create/create`, {
    method: "POST",
    headers: headers(token) as any,
    body: JSON.stringify(body),
  });
  const content = await parseRozetkaResponse(r);

  const itemId = content?.item?.item_id;
  if (!itemId) {
    throw new Error("Rozetka не повернула ID створеного товару");
  }

  return { externalPostId: String(itemId) };
}
