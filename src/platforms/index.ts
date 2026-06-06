import { publishInstagramPost } from "../instagram";
import { sendTelegramPost } from "../telegram";
import { PlatformId, ProductInput, PublishingPlatform } from "../platform-types";

const bannedPhrases = `
- "must have";
- "виглядає дорого";
- "без зайвих деталей";
- "збирає погляди";
- "база гардеробу";
- "на всі випадки життя";
- "ідеально під все";
- "тренд сезону";
- "родзинка образу".
`;

function productFacts(product: ProductInput) {
  return `
Назва: ${product.title || "не вказано"}
Модель/артикул: ${product.model || "не вказано"}
Ціна: ${product.price || "не вказано"}
Дроп ціна: ${product.dropPrice || "не вказано"}
Розміри: ${product.sizes || "не вказано"}
Кольори: ${product.colors || "не вказано"}
Тканина/матеріал: ${product.fabric || "не вказано"}
Додатковий опис: ${product.description || "не вказано"}
`.trim();
}

function commonRules(product: ProductInput) {
  return `
Ти — український SMM-копірайтер для живого магазину жіночого одягу.

Дані товару:
${productFacts(product)}

Фото товару додані як візуальний контекст. Використовуй їх обережно: можна врахувати загальне враження, але не вигадуй тканину, склад, розміри, кольори, модель чи інші характеристики, якщо цього немає у текстових даних.

Загальні правила:
- Пиши тільки українською мовою.
- Не використовуй англійські фрази.
- Не використовуй ці фрази:
${bannedPhrases}
- Не вигадуй характеристик, яких немає в даних.
- Не перебільшуй і не роби шаблонний рекламний текст.
- Пиши природно для магазину жіночого одягу.
`.trim();
}

export const telegramPlatform: PublishingPlatform = {
  id: "telegram",
  name: "Telegram",
  supportsPublishing: true,
  generatePrompt(product) {
    return `
${commonRules(product)}

Створи готовий пост для Telegram.

Правила Telegram:
- Можна використовувати HTML Telegram.
- Дозволені тільки теги <b>, <i>, <u>, <s>, <code>.
- Не використовуй markdown.
- Не використовуй <br>, <p>, <div>, <span>, <ul>, <li>.
- Для нового рядка використовуй звичайний перенос рядка.
- Не додавай посилання і не згадуй кнопку замовлення.

Структура:
1. Короткий заголовок.
2. Продаючий опис.
3. Характеристики.
4. Ціна / дроп ціна.
5. Заклик до замовлення без фраз "пишіть в дірект" і "для замовлення звертайтесь".
6. 3-5 релевантних українських хештегів.

Поверни тільки готовий текст поста.
`.trim();
  },
  async publish({ text, photoPaths }) {
    const result = await sendTelegramPost(text, photoPaths[0]);

    return {
      externalChatId: result.chatId,
      externalPostId: String(result.messageId),
      raw: result,
    };
  },
};

export const instagramPlatform: PublishingPlatform = {
  id: "instagram",
  name: "Instagram",
  supportsPublishing: true,
  generatePrompt(product) {
    return `
${commonRules(product)}

Створи готовий пост для Instagram.

Правила Instagram:
- Без HTML і markdown.
- Текст коротший, теплий і емоційний, але без перебільшень.
- Використовуй нормальні абзаци.
- CTA без "пишіть в дірект", якщо це не вказано користувачем.
- 5-10 релевантних українських хештегів.
- Не використовуй англійські фрази.

Поверни тільки готовий текст поста.
`.trim();
  },
  async publish({ text, imageUrls }) {
    if (!imageUrls[0]) {
      throw new Error("Instagram потребує фото товару для публікації");
    }

    const result = await publishInstagramPost(imageUrls[0], text);

    return {
      externalPostId: result.id,
      raw: result,
    };
  },
};

function createFuturePlatform(id: PlatformId, name: string): PublishingPlatform {
  return {
    id,
    name,
    supportsPublishing: false,
    generatePrompt(product) {
      return `
${commonRules(product)}

Підготуй чернетку товарного поста для платформи ${name}. Не вигадуй дані, пиши природно, додай короткий CTA і релевантні українські хештеги, якщо це доречно для платформи.
`.trim();
    },
    async publish() {
      throw new Error(`${name} ще не підключено для публікації`);
    },
  };
}

export const platforms: Record<PlatformId, PublishingPlatform> = {
  telegram: telegramPlatform,
  instagram: instagramPlatform,
  facebook: createFuturePlatform("facebook", "Facebook"),
  viber: createFuturePlatform("viber", "Viber"),
  prom: createFuturePlatform("prom", "Prom"),
  rozetka: createFuturePlatform("rozetka", "Rozetka"),
  olx: createFuturePlatform("olx", "OLX"),
  shafa: createFuturePlatform("shafa", "Shafa.ua"),
};

export const enabledPlatformIds: PlatformId[] = ["telegram", "instagram"];

export function getPlatform(id: PlatformId) {
  const platform = platforms[id];

  if (!platform) {
    throw new Error(`Невідома платформа: ${id}`);
  }

  return platform;
}

export function isPlatformId(value: string): value is PlatformId {
  return value in platforms;
}
