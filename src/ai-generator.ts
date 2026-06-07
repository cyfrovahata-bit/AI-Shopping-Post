import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { getPlatform } from "./platforms";
import { PlatformId, ProductInput } from "./platform-types";

dotenv.config();

const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
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
      "text": "короткий хук",
      "start": 0,
      "end": 2.5,
      "position": "top"
    },
    {
      "text": "перевага або ціна",
      "start": 2.5,
      "end": 5,
      "position": "center"
    },
    {
      "text": "заклик до дії",
      "start": 5,
      "end": 8,
      "position": "bottom"
    }
  ]
}

Правила:
- текст українською;
- максимум 3–5 слів в одному написі;
- без лапок у самому тексті;
- без довгих речень;
- без слова "must have";
- не пиши "виглядає дорого";
- не пиши "збирає погляди";
- не пиши "без зайвих деталей";
- позиції тільки: top, center, bottom;
- зроби тексти живими, як для Instagram Reels.
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
