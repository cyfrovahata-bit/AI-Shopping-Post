import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { getPlatform } from "./platforms";
import { PlatformId, ProductInput } from "./platform-types";

dotenv.config();

const model = process.env.OPENAI_MODEL || "gpt-4o";
const maxVisionImages = 4;
let openai: OpenAI | null = null;

const mimeByExt: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export type VideoTextOverlay = {
  text: string;
  start: number;
  end: number;
  position: "top" | "center" | "bottom";
};

export type GeneratedVideoTexts = {
  videoTexts: VideoTextOverlay[];
};

export function imageToDataUrl(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = mimeByExt[ext] || "image/jpeg";
  const base64 = fs.readFileSync(filePath).toString("base64");

  return `data:${mime};base64,${base64}`;
}

export async function generatePlatformPost(
  product: ProductInput,
  platformId: PlatformId
) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY не задано в .env");
  }

  openai ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const platform = getPlatform(platformId);
  const prompt = platform.generatePrompt(product);
  const imageInputs = product.photoPaths
    .filter((photoPath) => fs.existsSync(photoPath))
    .slice(0, maxVisionImages)
    .map((photoPath) => ({
      type: "input_image" as const,
      image_url: imageToDataUrl(photoPath),
      detail: "auto" as const,
    }));

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
          ...imageInputs,
        ],
      },
    ],
  });

  return response.output_text.trim();
}

export async function generatePostsForPlatforms(
  product: ProductInput,
  platformIds: PlatformId[]
) {
  const uniquePlatformIds = Array.from(new Set(platformIds));
  const posts = await Promise.all(
    uniquePlatformIds.map(async (platform) => ({
      platform,
      text: await generatePlatformPost(product, platform),
      status: "draft" as const,
    }))
  );

  return posts;
}

export async function generatePost(
  product: Omit<ProductInput, "imageUrls" | "photoPaths"> & {
    imageUrls?: string[];
    photoPaths?: string[];
  }
) {
  return generatePlatformPost(
    {
      ...product,
      imageUrls: product.imageUrls || [],
      photoPaths: product.photoPaths || [],
    },
    "telegram"
  );
}

export type ExtractedProductFields = {
  title?: string;
  price?: string;
  dropPrice?: string;
  colors?: string;
  fabric?: string;
  sizeSystem?: "Міжнародний" | "Європейський" | "Українські";
  sizes?: string[];
  description?: string;
};

const SIZE_LISTS = {
  "Міжнародний": ["XXS","XS","S","M","L","XL","XXL","XXXL","4XL","5XL","6XL","7XL","8XL","9XL","XXS-XS","XS-S","S-M","M-L","L-XL","XL-XXL","One size","Інший"],
  "Європейський": ["32","34","36","38","40","42","44","46","48","50","52","54","56","58","60","62","64","One size","Інший"],
  "Українські": ["38","40","42","44","46","48","50","52","54","56","58","60","62","64","66","68","70","40-42","42-44","42-48","44-46","46-48","48-50","50-52","52-54","54-56","56-58","58-60","60-62","62-64","64-66","66-68","68-70","One size","Інший"],
};

// Cheap, text-only (no images) extraction of structured product fields from a
// pasted free-form post (e.g. an old Instagram/Telegram caption). Used to
// autofill the upload form without paying for the much more expensive
// per-platform post generation.
export async function extractProductFields(rawText: string): Promise<ExtractedProductFields> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY не задано в .env");
  }
  if (!rawText || !rawText.trim()) return {};

  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `
Тобі дали довільний текст поста про товар (можливо, скопійований зі старого допису в Instagram/Telegram — з емодзі, ціною, розмірами, контактами, посиланнями на соцмережі тощо).

Твоя задача — витягнути з нього структуровані поля товару. ГОЛОВНЕ ПРАВИЛО: якщо якесь поле не вказано в тексті явно, або ти не впевнений у значенні — поверни для нього null. Ніколи не вигадуй і не досі домислюй дані.

Текст:
"""
${rawText}
"""

Поверни строго JSON без markdown:
{
  "title": "коротка назва товару (тип виробу), або null",
  "price": "ціна як написана в тексті (наприклад '980 грн'), або null",
  "dropPrice": "дроп-ціна/ціна для реселерів, якщо явно вказана окремо від звичайної ціни, або null",
  "colors": "кольори через кому, як у тексті, або null",
  "fabric": "склад тканини/матеріал, або null",
  "sizeSystem": "одне з: \"Міжнародний\", \"Європейський\", \"Українські\", або null якщо розміри не вказані чи незрозуміло яка система",
  "sizes": ["масив розмірів ТІЛЬКИ з дозволеного списку обраної sizeSystem, або null"],
  "description": "решта опису — тільки емоційний/описовий текст про сам товар (посадка, тканина на дотик, для чого підходить). ВИДАЛИ звідси: ціну, розміри, склад тканини (вони вже окремі поля), контакти, посилання на соцмережі, заклики типу 'пишіть в директ', артикули/модель. Якщо після очищення нічого змістовного не залишилось — null."
}

Дозволені розміри для кожної системи (використовуй ТІЛЬКИ ці значення, нічого іншого):
Міжнародний: ${JSON.stringify(SIZE_LISTS["Міжнародний"])}
Європейський: ${JSON.stringify(SIZE_LISTS["Європейський"])}
Українські: ${JSON.stringify(SIZE_LISTS["Українські"])}

Якщо в тексті розмір вказано як діапазон, що не збігається точно з жодним значенням зі списку (наприклад "42-46" при відсутності такого значення в списку) — залиш "sizes": null, не підбирай приблизне.
`.trim();

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
  });

  const raw = response.output_text.trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    const result: ExtractedProductFields = {};
    if (typeof parsed.title === "string" && parsed.title.trim()) result.title = parsed.title.trim();
    if (typeof parsed.price === "string" && parsed.price.trim()) result.price = parsed.price.trim();
    if (typeof parsed.dropPrice === "string" && parsed.dropPrice.trim()) result.dropPrice = parsed.dropPrice.trim();
    if (typeof parsed.colors === "string" && parsed.colors.trim()) result.colors = parsed.colors.trim();
    if (typeof parsed.fabric === "string" && parsed.fabric.trim()) result.fabric = parsed.fabric.trim();
    if (typeof parsed.description === "string" && parsed.description.trim()) result.description = parsed.description.trim();
    if (
      (parsed.sizeSystem === "Міжнародний" || parsed.sizeSystem === "Європейський" || parsed.sizeSystem === "Українські") &&
      Array.isArray(parsed.sizes) && parsed.sizes.length
    ) {
      const allowed = new Set(SIZE_LISTS[parsed.sizeSystem as keyof typeof SIZE_LISTS]);
      const validSizes = (parsed.sizes as unknown[]).filter((s): s is string => typeof s === "string" && allowed.has(s));
      if (validSizes.length) {
        result.sizeSystem = parsed.sizeSystem;
        result.sizes = validSizes;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function generateVideoTexts(product: ProductInput) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY не задано в .env");
  }

  openai ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const prompt = `
Ти створюєш короткі написи для відео Reels українською мовою.

Товар:
Назва: ${product.title || ""}
Опис: ${product.description || ""}
Ціна: ${product.price || ""}

Поверни строго JSON без markdown, без пояснень:

{
  "videoTexts": [
    {
      "text": "Новинка",
      "start": 0,
      "end": 2.5,
      "position": "top"
    },
    {
      "text": "3000 грн",
      "start": 2.5,
      "end": 5,
      "position": "center"
    },
    {
      "text": "Замовляй",
      "start": 5,
      "end": 8,
      "position": "bottom"
    }
  ]
}

Правила:
- текст українською;
- кожен напис максимум 2–3 слова;
- максимум 16 символів в одному написі;
- не використовуй довгі речення;
- не використовуй перенос рядка;
- не використовуй крапки в кінці;
- не пиши "для тебе";
- не пиши "вже сьогодні";
- не пиши "ціна лише";
- ціну пиши коротко, наприклад: "3000 грн";
- CTA пиши коротко, наприклад: "Замовляй" або "Пиши нам";
- позиції тільки: top, center, bottom.
`;

  const imageInputs = product.photoPaths
    .filter((photoPath) => fs.existsSync(photoPath))
    .slice(0, maxVisionImages)
    .map((photoPath) => ({
      type: "input_image" as const,
      image_url: imageToDataUrl(photoPath),
      detail: "auto" as const,
    }));

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
          ...imageInputs,
        ],
      },
    ],
  });

  const raw = response.output_text.trim();

  try {
    const parsed = JSON.parse(raw) as GeneratedVideoTexts;

    if (!Array.isArray(parsed.videoTexts)) {
      throw new Error("videoTexts is not array");
    }

    return parsed.videoTexts;
  } catch {
    return [
      {
        text: "🔥 Новинка",
        start: 0,
        end: 2.5,
        position: "top" as const,
      },
      {
        text: product.price ? `💰 ${product.price}` : "Гарний вибір",
        start: 2.5,
        end: 5,
        position: "center" as const,
      },
      {
        text: "📩 Пиши в Direct",
        start: 5,
        end: 8,
        position: "bottom" as const,
      },
    ];
  }
}
