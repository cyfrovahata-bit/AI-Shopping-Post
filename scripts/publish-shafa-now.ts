import dotenv from "dotenv";
dotenv.config();

import { generatePlatformPost } from "../src/ai-generator";
import { mapProductToShafa } from "../src/shafa/shafa.mapper";
import { publishToShafa } from "../src/shafa/shafa.publisher";
import { ProductInput } from "../src/platform-types";

const product: ProductInput = {
  title: "Синя сукня міді",
  description: "Облягаюча сукня міді синього кольору на бретелях, з V-подібним вирізом. Щільна еластична тканина добре тримає форму. Підходить для вечірок, побачень, ресторану.",
  price: "650",
  sizes: "M",
  colors: "Синій",
  fabric: "Поліестер",
  photoPaths: [
    "./test-images/dress_1.jpg",
    "./test-images/dress_2.jpg",
    "./test-images/dress_3.jpg",
  ],
  imageUrls: [],
};

async function main() {
  console.log("1. Генерую картку через AI...");
  const aiJson = await generatePlatformPost(product, "shafa");
  console.log("\n── AI JSON ──");
  console.log(aiJson);
  console.log("────────────\n");

  console.log("2. Маплю в ShafaProduct...");
  const shafaProduct = mapProductToShafa(product, aiJson);
  console.log("Назва:", shafaProduct.title);
  console.log("Довжина назви:", shafaProduct.title.length);
  console.log("Keywords:", shafaProduct.keywords.length, "шт.");
  console.log("Кольори:", shafaProduct.colors);
  console.log("Сезони:", shafaProduct.seasons);
  console.log("Рукав:", shafaProduct.sleeveLength);
  console.log("Фасон рукава:", shafaProduct.sleeveStyle);
  console.log("Особливості:", shafaProduct.features);
  console.log("Силует:", shafaProduct.silhouette);
  console.log("Принт:", shafaProduct.print);
  console.log("Стиль:", shafaProduct.style);
  console.log("Декор:", shafaProduct.decor);
  console.log("Матеріали:", shafaProduct.materials);

  console.log("\n3. Публікую на Shafa.ua...");
  const result = await publishToShafa(shafaProduct);
  console.log("\n✓ Опубліковано:", result.externalPostId);
}

main().catch(err => { console.error("❌", err); process.exit(1); });
