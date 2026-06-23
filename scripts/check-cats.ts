import { chromium } from "playwright";

(async () => {
  const stateFile = "shafa-session.json";
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: stateFile });
  const page = await ctx.newPage();
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  // Click "Жіночий одяг"
  const zhino = page.getByText("Жіночий одяг", { exact: true }).last();
  if (await zhino.count() > 0) {
    await zhino.click();
    await page.waitForTimeout(2000);
  }

  // Screenshot to see what appeared
  await page.screenshot({ path: "shafa-cats.png", fullPage: false });

  // Get all li text
  const cats = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("li"))
      .filter(el => el.offsetParent !== null)
      .map(el => el.innerText?.trim())
      .filter(t => t && t.length > 2 && t.length < 80);
  });
  console.log([...new Set(cats)].join("\n"));
  await browser.close();
})();
