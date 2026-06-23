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
  
  // Find "Матеріал" label and check its ancestors up to 10 levels
  const domInfo = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    
    // Find smallest element with "Матеріал" text
    let matLabel: Element | null = null;
    let minLen = Infinity;
    for (const el of all) {
      if ((el as HTMLElement).offsetParent === null) continue;
      const t = ((el as HTMLElement).innerText || el.textContent || '').trim();
      if (t.toLowerCase().includes('матеріал') && t.length < minLen) {
        minLen = t.length;
        matLabel = el;
      }
    }
    
    if (!matLabel) return { found: false };
    
    const matText = ((matLabel as HTMLElement).innerText || matLabel.textContent || '').trim();
    
    // Walk up 10 levels checking for inputs
    const levels: any[] = [];
    let c: Element | null = matLabel.parentElement;
    let d = 0;
    while (c && d < 12) {
      const inputs = Array.from(c.querySelectorAll('input[type="text"]'))
        .filter(i => (i as HTMLElement).offsetParent !== null);
      const inpCount = inputs.length;
      const tagInfo = c.tagName + '.' + c.className.substring(0, 30);
      levels.push({ depth: d, tag: tagInfo, inputsFound: inpCount });
      c = c.parentElement; d++;
    }
    
    return { found: true, labelText: matText, levels };
  });
  
  console.log(JSON.stringify(domInfo, null, 2));
  await browser.close();
})();
