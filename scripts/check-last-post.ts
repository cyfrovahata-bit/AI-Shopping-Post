import { mapProductToShafa } from "../src/shafa/shafa.mapper";

// Simulate the exact AI text that was generated for the last post
// (fetch from API)
async function main() {
  const res = await fetch("http://localhost:3000/api/products/23");
  const data = await res.json() as any;
  const shafaPost = data.platformPosts?.find((p: any) => p.platform === "shafa");
  if (!shafaPost) { console.log("no shafa post"); return; }

  const product = {
    title: data.title,
    price: data.price,
    sizes: data.sizes,
    fabric: data.fabric,
    colors: data.colors,
    description: data.description,
    photoPaths: [],
    imageUrls: [],
  };

  const mapped = mapProductToShafa(product as any, shafaPost.text);
  console.log("=== Mapped values ===");
  console.log("style:", JSON.stringify(mapped.style));
  console.log("print:", JSON.stringify(mapped.print));
  console.log("materials:", JSON.stringify(mapped.materials));
  console.log("silhouette:", JSON.stringify(mapped.silhouette));
  console.log("decor:", mapped.decor);
  console.log("fashionCut:", JSON.stringify(mapped.fashionCut));
  console.log("modelFeatures:", JSON.stringify(mapped.modelFeatures));
}

main().catch(console.error);
