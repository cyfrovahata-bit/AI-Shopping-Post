import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "shafa-session.json" });
  const page = await ctx.newPage();
  
  await page.goto("https://shafa.ua/uk/item/212647218/edit", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const url = page.url();
  console.log("URL:", url);
  
  // Full screenshot
  await page.screenshot({ path: "shafa-edit-check.png", fullPage: false });
  await browser.close();
})();
