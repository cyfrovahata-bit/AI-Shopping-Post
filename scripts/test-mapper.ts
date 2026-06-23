import { mapProductToShafa } from "../src/shafa/shafa.mapper";

const fakeAI = `I'm unable to process the image, but here is the JSON:

\`\`\`json
{
  "title": "Тест",
  "description": "Опис",
  "keywords": ["тест"],
  "colors": ["Бежевий"],
  "sizes": ["S","M"],
  "seasons": ["Літо"],
  "sleeveLength": null,
  "sleeveStyle": [],
  "features": [],
  "materials": ["Льон"],
  "silhouette": ["Прямі"],
  "fashionCut": [],
  "print": [],
  "style": ["Повсякденний","Романтичний","Casual"],
  "decor": "Без декору",
  "modelFeatures": []
}
\`\`\``;

const product: any = { title: "Тест", price: "1000", sizes: "S,M", photoPaths: [], imageUrls: [] };
const result = mapProductToShafa(product, fakeAI);
console.log("style:", JSON.stringify(result.style));
console.log("print:", JSON.stringify(result.print));
console.log("style filtered correctly:", JSON.stringify(result.style) === '["Повсякденний","Романтичний"]' ? "✓" : "✗");
console.log("print empty (will become Без принту):", result.print?.length === 0 ? "✓" : "✗");
