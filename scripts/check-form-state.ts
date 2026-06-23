import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const ctx = await browser.newContext({ storageState: "shafa-session.json" });
  const page = await ctx.newPage();
  await page.goto("https://shafa.ua/uk/new/212647165", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "shafa-check-listing.png", fullPage: true });
  await browser.close();
  console.log("done");
})();
