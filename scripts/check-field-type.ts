import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await browser.newContext({ storageState: "shafa-session.json", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.getByText("Жіночий одяг", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Плаття", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Сукні міді", { exact: true }).last().click(); await page.waitForTimeout(2500);
  await page.evaluate("window.scrollTo(0, 2500)"); await page.waitForTimeout(500);
  
  // Click on the 3rd input (index 2 = Матеріал) and type
  const input = page.locator('input[type="text"]').nth(2);
  await input.scrollIntoViewIfNeeded();
  
  // Check if it's inside a react-select control
  const hasReactSelect = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"]'))
      .filter((el) => (el as HTMLElement).offsetParent !== null) as HTMLInputElement[];
    const inp = inputs[2];
    if (!inp) return { found: false };
    
    // Check parents for react-select classes
    let el: Element | null = inp;
    let d = 0;
    while (el && d < 8) {
      const cls = el.className || '';
      if (cls.includes('-control') || cls.includes('-container')) {
        return { isReactSelect: true, depth: d, className: cls.substring(0, 80) };
      }
      el = el.parentElement; d++;
    }
    return { isReactSelect: false };
  });
  
  console.log("Field type check:", JSON.stringify(hasReactSelect));
  
  // Try clicking the control and typing
  await input.click();
  await page.waitForTimeout(500);
  await page.keyboard.type("А", { delay: 100 });
  await page.waitForTimeout(2000);
  
  // Check what appeared
  const options = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="-option"], [class*="-menu"] li'))
      .filter(el => (el as HTMLElement).offsetParent !== null)
      .map(el => (el as HTMLElement).innerText?.trim())
      .filter(Boolean).slice(0, 10);
  });
  
  console.log("Options after typing 'А':", JSON.stringify(options));
  
  await page.screenshot({ path: "shafa-material-typing.png", fullPage: false });
  await browser.close();
})();
