import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "shafa-session.json" });
  const page = await ctx.newPage();
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  // Click "Жіночий одяг" then "Костюми"
  await page.getByText("Жіночий одяг", { exact: true }).last().click();
  await page.waitForTimeout(2000);
  await page.getByText("Костюми", { exact: true }).last().click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: "shafa-costumes.png", fullPage: false });

  const cats = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("li"))
      .filter(el => el.offsetParent !== null)
      .map(el => el.innerText?.trim())
      .filter(t => t && t.length > 2 && t.length < 80);
  });
  console.log([...new Set(cats)].join("\n"));
  await browser.close();
})();
