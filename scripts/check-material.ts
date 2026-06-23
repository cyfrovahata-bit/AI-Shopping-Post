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
  
  // Run exactly the same code as fillLabeledTextField
  const result = await page.evaluate((lbl: string) => {
    const all = Array.from(document.querySelectorAll('*'));
    const label = all.reduce((best: Element | null, el: Element) => {
      const t = ((el as HTMLElement).innerText || el.textContent || '').trim().toLowerCase();
      const match = (t === lbl.toLowerCase()) || (t.indexOf(lbl.toLowerCase()) !== -1 && t.length < lbl.length + 8);
      if (!match) return best;
      if (!best) return el;
      const bLen = ((best as HTMLElement).innerText || best.textContent || '').trim().length;
      const eLen = t.length;
      return eLen < bLen ? el : best;
    }, null);
    
    if (!label) return { found: false, labelText: null, idx: -1 };
    
    const labelText = ((label as HTMLElement).innerText || label.textContent || '').trim();
    const allInputs = Array.from(document.querySelectorAll('input[type="text"]'));
    
    let c: Element | null = label.parentElement;
    let d = 0;
    while (c && d < 4) {
      const inputs = Array.from(c.querySelectorAll('input[type="text"]'));
      for (const inp of inputs) {
        if ((inp as HTMLElement).offsetParent === null) continue;
        const pos = label.compareDocumentPosition(inp);
        if (pos & 4) { return { found: true, labelText, depth: d, idx: allInputs.indexOf(inp) }; }
      }
      c = c.parentElement; d++;
    }
    return { found: true, labelText, depth: -1, idx: -1, msg: "no input found in 4 levels" };
  }, "Матеріал");
  
  console.log("Матеріал result:", JSON.stringify(result));
  
  // Same for Принт
  const printResult = await page.evaluate((lbl: string) => {
    const all = Array.from(document.querySelectorAll('*'));
    const label = all.reduce((best: Element | null, el: Element) => {
      const t = ((el as HTMLElement).innerText || el.textContent || '').trim().toLowerCase();
      const match = (t === lbl.toLowerCase()) || (t.indexOf(lbl.toLowerCase()) !== -1 && t.length < lbl.length + 8);
      if (!match) return best;
      if (!best) return el;
      const bLen = ((best as HTMLElement).innerText || best.textContent || '').trim().length;
      const eLen = t.length;
      return eLen < bLen ? el : best;
    }, null);
    
    if (!label) return { found: false };
    
    const labelText = ((label as HTMLElement).innerText || label.textContent || '').trim();
    const allInputs = Array.from(document.querySelectorAll('input[type="text"]'));
    
    let c: Element | null = label.parentElement;
    let d = 0;
    while (c && d < 4) {
      const inputs = Array.from(c.querySelectorAll('input[type="text"]'));
      for (const inp of inputs) {
        if ((inp as HTMLElement).offsetParent === null) continue;
        const pos = label.compareDocumentPosition(inp);
        if (pos & 4) { return { found: true, labelText, depth: d, idx: allInputs.indexOf(inp) }; }
      }
      c = c.parentElement; d++;
    }
    return { found: true, labelText, depth: -1, idx: -1 };
  }, "Принт");
  
  console.log("Принт result:", JSON.stringify(printResult));
  
  await browser.close();
})();
