import * as dotenv from "dotenv";
dotenv.config();
import { publishToShafa } from "../src/shafa/shafa.publisher";

(async () => {
  const product = {
    title: "Молочна в'язана сукня-светр оверсайз міді з довгим рукавом та коміром-стійкою — тепла трикотажна жіноча сукня для осені та зими, вільний крій, натуральна нитка, стиль бохо та повсякденний",
    description: `Розкішна в'язана сукня-светр оверсайз у ніжному молочному кольорі — ідеальне поєднання тепла, комфорту та стилю. Виготовлена з м'якого трикотажного полотна з натуральної нитки, яка приємна до шкіри і не викликає подразнення.

Особливості моделі:
• Комір-стійка (turtle neck) захищає від холоду
• Довгий рукав — максимальний затишок у прохолодну пору
• Вільний оверсайз-крій — дозволяє рухатись вільно, ховає недоліки фігури
• Довжина міді — зупиняється нижче коліна, стройнить силует
• Ребриста в'язка на манжетах і по подолу — класична деталь, що тримає форму
• Колір молочний (cream white) — універсальний, поєднується з усіма кольорами

Ця сукня ідеально підходить для:
— прогулянок у прохолодний день
— вихідних у місті або заміській поїздки
— домашнього comfort look
— роботи в офісі з вільним дрес-кодом

Склад: 70% акрил, 20% вовна, 10% нейлон — зберігає форму після прання, не тягнеться.
Догляд: ручне прання або делікатний режим при 30°С, не вичавлювати, сушити горизонтально.

Розмірна сітка:
XS — обхват грудей 80–84 см
S — обхват грудей 84–88 см
M — обхват грудей 88–92 см
L — обхват грудей 92–96 см
XL — обхват грудей 96–102 см

Завдяки оверсайз-крою сукня на 1–2 розміри більша за стандарт, тому радимо обирати свій звичайний розмір або менший.`,
    price: "1890",
    condition: "Новий" as const,
    keywords: [
      "В'язана сукня",
      "Сукня светр",
      "Оверсайз сукня",
      "Трикотажна сукня",
      "Сукня з горловиною",
      "Молочна сукня",
      "Тепла сукня міді",
    ],
    imagePaths: [
      "test-images/linen-jumpsuit/photo_1.jpg",
      "test-images/linen-jumpsuit/photo_2.jpg",
      "test-images/linen-jumpsuit/photo_3.jpg",
      "test-images/linen-jumpsuit/photo_4.jpg",
      "test-images/linen-jumpsuit/photo_5.jpg",
      "test-images/linen-jumpsuit/photo_6.jpg",
      "test-images/linen-jumpsuit/photo_7.jpg",
      "test-images/linen-jumpsuit/photo_8.jpg",
      "test-images/linen-jumpsuit/photo_9.jpg",
      "test-images/linen-jumpsuit/photo_10.jpg",
    ],
    categoryPath: ["Жіночий одяг", "Плаття", "Сукні міді"],
    quantity: "5",
    sizeSystem: "Міжнародний" as const,
    sizes: ["ХS", "S", "M", "L", "XL"],
    colors: ["Молочний"],
    materials: ["Трикотаж"],
    seasons: ["Осінь", "Зима", "Демісезон"],
    sleeveLength: "Довгий",
    sleeveStyle: [],
    features: [],
    silhouette: ["Оверсайз", "Прямі"],
    fashionCut: ["Плаття-светр"],
    print: [],
    style: ["Повсякденний", "Бохо", "Класичний"],
    decor: "Без декору",
    modelFeatures: ["З коміром", "З кишенями"],
  };

  const result = await publishToShafa(product);
  console.log("RESULT:", JSON.stringify(result));
})().catch(err => console.error("ERROR:", err.message));
