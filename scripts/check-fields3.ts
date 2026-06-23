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
  await page.evaluate("window.scrollTo(0, 2500)"); await page.waitForTimeout(500);
  
  const info = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"]'))
      .filter((el) => (el as HTMLElement).offsetParent !== null) as HTMLInputElement[];
    
    return inputs.map((inp, i) => {
      let container: Element = inp;
      let d = 0;
      while (container && d < 10) {
        const parent = container.parentElement;
        if (!parent) break;
        let sib = container.previousElementSibling;
        while (sib) {
          const sibText = ((sib as HTMLElement).innerText || sib.textContent || '').trim();
          if (sibText.length > 2 && sibText.length < 60 && !sibText.includes('\n')) {
            return { index: i, label: sibText };
          }
          sib = sib.previousElementSibling;
        }
        container = parent; d++;
      }
      return { index: i, label: 'NOT FOUND' };
    });
  });
  console.log(JSON.stringify(info, null, 2));
  
  await browser.close();
})();
