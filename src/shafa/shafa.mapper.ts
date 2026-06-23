import { ProductInput } from "../platform-types";
import { ShafaProduct, SHAFA_SIZES_INT } from "./shafa.types";

function parseSizes(sizesStr: string): string[] {
  if (!sizesStr) return [];
  const result: string[] = [];
  for (const part of sizesStr.split(/[,;\/]/)) {
    const up = part.trim().toUpperCase();
    const found = SHAFA_SIZES_INT.find(v => v.toUpperCase() === up);
    if (found) result.push(found);
  }
  return result;
}

function fallbackKeywords(title: string, description: string): string[] {
  const words = (title + " " + description)
    .toLowerCase()
    .replace(/[^\wа-яёіїєґ\s]/gi, " ")
    .split(/\s+/)
    .filter(w => w.length > 3);
  return Array.from(new Set(words)).slice(0, 20);
}

export function mapProductToShafa(
  product: ProductInput,
  aiJson: string
): ShafaProduct {
  let ai: Record<string, unknown> = {};
  try {
    const clean = aiJson.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    ai = JSON.parse(clean);
  } catch {
    // AI повернув не JSON — використаємо aiJson як опис (fallback)
  }

  const fallbackSizes = parseSizes(product.sizes || "");

  const title = typeof ai.title === "string" ? ai.title : product.title;
  const description = typeof ai.description === "string" ? ai.description : aiJson;
  const keywords = Array.isArray(ai.keywords) ? (ai.keywords as string[]) : fallbackKeywords(product.title, product.description || "");
  const colors = Array.isArray(ai.colors) ? (ai.colors as string[]).slice(0, 2) : [];
  const sizes = Array.isArray(ai.sizes) && (ai.sizes as string[]).length
    ? (ai.sizes as string[])
    : fallbackSizes.length ? fallbackSizes : ["S", "M", "L"];

  // Матеріали: з AI або з product.fabric
  let materials: string[] = [];
  if (Array.isArray(ai.materials) && ai.materials.length) {
    materials = ai.materials as string[];
  } else if (typeof ai.material === "string" && ai.material) {
    materials = [ai.material];
  } else if (product.fabric) {
    materials = product.fabric.split(/[,;\/]/).map(s => s.trim()).filter(Boolean);
  }

  return {
    title: title.slice(0, 150),
    description,
    price: product.price,
    condition: "Новий",
    keywords,
    imagePaths: product.photoPaths,
    categoryPath: ["Жіночий одяг", "Плаття", "Сукні міді"],
    quantity: "3",
    sizeSystem: sizes.length ? "Міжнародний" : undefined,
    sizes,
    colors,
    materials,
    sleeveLength: typeof ai.sleeveLength === "string" ? ai.sleeveLength : undefined,
    sleeveStyle: Array.isArray(ai.sleeveStyle) ? (ai.sleeveStyle as string[]) : [],
    seasons: Array.isArray(ai.seasons) ? (ai.seasons as string[]) : [],
    features: Array.isArray(ai.features) ? (ai.features as string[]) : [],
    silhouette: Array.isArray(ai.silhouette) ? (ai.silhouette as string[]) : [],
    fashionCut: Array.isArray(ai.fashionCut) ? (ai.fashionCut as string[]) : [],
    // Принт — тільки якщо є реальний принт (не однотонна/без принту)
    print: (() => {
      const p = Array.isArray(ai.print) ? (ai.print as string[]) : [];
      return p.filter(v => !/(однотон|без принт)/i.test(v));
    })(),
    style: Array.isArray(ai.style) ? (ai.style as string[]) : [],
    decor: typeof ai.decor === "string" ? ai.decor : undefined,
    modelFeatures: Array.isArray(ai.modelFeatures) ? (ai.modelFeatures as string[]) : [],
    madeInUkraine: undefined,
  };
}
