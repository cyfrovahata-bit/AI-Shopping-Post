import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "shafa-session.json", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.getByText("Жіночий одяг", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Плаття", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Сукні міді", { exact: true }).last().click(); await page.waitForTimeout(2500);
  
  // Simulate what happens after filling keywords - scroll down
  await page.evaluate("window.scrollBy(0, 600)");
  await page.waitForTimeout(600);
  await page.evaluate("window.scrollBy(0, 400)");
  await page.waitForTimeout(800);
  
  // Now check labels
  const fields = ["Матеріал", "Силует", "Фасон", "Стиль", "Декор", "Особливості моделі", "Принт"];
  
  for (const lbl of fields) {
    const info = await page.evaluate((lbl: string) => {
      const all = Array.from(document.querySelectorAll('*'));
      const candidates = all
        .map(el => ({ el, t: ((el as HTMLElement).innerText || el.textContent || '').trim() }))
        .filter(({ el, t }) => 
          (el as HTMLElement).offsetParent !== null &&
          t.toLowerCase().includes(lbl.toLowerCase()) &&
          t.length < lbl.length + 10
        )
        .map(({ t }) => t);
      
      return { lbl, candidates: candidates.slice(0, 5) };
    }, lbl);
    console.log(JSON.stringify(info));
  }
  
  await browser.close();
})();
