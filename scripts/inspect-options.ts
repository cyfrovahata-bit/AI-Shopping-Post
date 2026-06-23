import { chromium } from "playwright";

async function getOptions(page: any, ctrlIdx: number, prefix: string) {
  const ctrl = page.locator('[class*="-control"]').nth(ctrlIdx);
  await ctrl.scrollIntoViewIfNeeded().catch(() => {});
  await ctrl.click();
  await page.waitForTimeout(300);
  if (prefix) {
    await page.keyboard.type(prefix, { delay: 50 });
    await page.waitForTimeout(800);
  }
  const menu = page.locator('[class*="-menu"]').first();
  const visible = await menu.isVisible({ timeout: 1500 }).catch(() => false);
  if (!visible) { await page.keyboard.press("Escape"); return []; }
  const opts = await menu.locator('[class*="-option"]').allInnerTexts().catch(() => []);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
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

  // Fill brand to make form progress
  const brandInput = page.locator('input[placeholder*="ренд"]').first();
  if (await brandInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await brandInput.fill("H&M"); await page.waitForTimeout(500);
  }

  // Scroll to additional chars section
  await page.evaluate("window.scrollBy(0, 700)");
  await page.waitForTimeout(800);

  // Enumerate the ctrl indices we care about
  const fields = [
    { name: "Матеріал (no prefix)", ctrl: 3, prefix: "" },
    { name: "Матеріал 'а'", ctrl: 3, prefix: "а" },
    { name: "Силует (no prefix)", ctrl: 5, prefix: "" },
    { name: "Фасон 'б'", ctrl: 8, prefix: "б" },
    { name: "Фасон 'м'", ctrl: 8, prefix: "м" },
    { name: "Стиль (no prefix)", ctrl: 7, prefix: "" },
    { name: "Декор (no prefix)", ctrl: 9, prefix: "" },
    { name: "Особливості моделі (no prefix)", ctrl: 4, prefix: "" },
    { name: "Принт (no prefix)", ctrl: 6, prefix: "" },
  ];

  for (const f of fields) {
    const opts = await getOptions(page, f.ctrl, f.prefix);
    console.log(`\n=== ${f.name} (ctrl=${f.ctrl}) ===`);
    console.log(opts.slice(0, 30).join(" | "));
  }

  await browser.close();
})();
