import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "shafa-session.json", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.getByText("Жіночий одяг", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Плаття", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Сукні міді", { exact: true }).last().click(); await page.waitForTimeout(2000);
  
  // Scroll to "Додаткові характеристики"
  const addChars = page.getByText("Додаткові характеристики").first();
  if (await addChars.count() > 0) {
    await addChars.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }
  
  // Take screenshot of this region
  await page.screenshot({ path: "shafa-additional-chars.png", fullPage: false });
  
  // List all text inputs visible
  const allLabels = await page.evaluate(`(function() {
    var allEls = Array.from(document.querySelectorAll('label, [class*="label"], h3, h4, span, p'));
    return allEls
      .filter(el => el.offsetParent !== null && !el.querySelector('*'))
      .map(el => ({ tag: el.tagName, text: (el.innerText||el.textContent||'').trim().substring(0,50) }))
      .filter(el => el.text.length > 2)
      .slice(60, 120);
  })()`);
  console.log("LABELS (60-120):", JSON.stringify(allLabels, null, 2));
  
  await browser.close();
})();
