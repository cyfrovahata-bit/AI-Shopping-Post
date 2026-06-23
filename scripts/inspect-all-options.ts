import { chromium } from "playwright";

async function getAllOpts(page: any, ctrlIdx: number, prefix: string = "") {
  const ctrl = page.locator('[class*="-control"]').nth(ctrlIdx);
  await ctrl.scrollIntoViewIfNeeded().catch(() => {});
  await ctrl.click();
  await page.waitForTimeout(400);
  if (prefix) {
    await page.keyboard.type(prefix, { delay: 50 });
    await page.waitForTimeout(1000);
    await page.waitForFunction(`!document.querySelector('[class*="-loading-message"]')`, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  const menu = page.locator('[class*="-menu"]').first();
  const visible = await menu.isVisible({ timeout: 2000 }).catch(() => false);
  if (!visible) { await page.keyboard.press("Escape"); return []; }
  const opts = await menu.locator('[class*="-option"]').allInnerTexts().catch(() => []);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return opts;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "shafa-session.json", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.getByText("Жіночий одяг", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Плаття", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Сукні міді", { exact: true }).last().click(); await page.waitForTimeout(2500);
  await page.evaluate("window.scrollBy(0, 700)"); await page.waitForTimeout(500);

  // Фасон - all options (no prefix)
  let opts = await getAllOpts(page, 8, "");
  console.log(`\n=== Фасон (no prefix, ctrl=8) ===`);
  console.log(opts.join(" | "));
  
  // Матеріал with short prefix
  for (const p of ["а", "б", "в", "г", "д", "е", "ж", "з", "і", "к", "л", "м", "н", "о", "п", "р", "с", "т", "ф", "х", "ц", "ч", "ш", "щ", "ю", "я"]) {
    opts = await getAllOpts(page, 3, p);
    if (opts.length) console.log(`Матеріал '${p}': ${opts.join(" | ")}`);
  }
  
  // Силует all
  opts = await getAllOpts(page, 5, "");
  console.log(`\n=== Силует ===`);
  console.log(opts.join(" | "));
  
  // Особливості моделі all
  opts = await getAllOpts(page, 4, "");
  console.log(`\n=== Особливості моделі ===`);
  console.log(opts.join(" | "));
  
  // Стиль all
  opts = await getAllOpts(page, 7, "");
  console.log(`\n=== Стиль ===`);
  console.log(opts.join(" | "));
  
  await browser.close();
})();
