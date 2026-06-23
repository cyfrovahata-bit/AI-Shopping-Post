import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "shafa-session.json", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  
  // Select category Плаття > Сукні міді
  await page.getByText("Жіночий одяг", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Плаття", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Сукні міді", { exact: true }).last().click(); await page.waitForTimeout(2000);
  
  // Scroll to bottom to show all fields
  await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
  await page.waitForTimeout(1000);
  
  // Screenshot
  await page.screenshot({ path: "shafa-form-bottom.png", fullPage: true });
  
  // Find Принт field and what's around it
  const printInfo = await page.evaluate(`(function() {
    var all = Array.from(document.querySelectorAll('*'));
    var result = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.offsetParent === null) continue;
      var t = (el.innerText||el.textContent||'').trim();
      if (t === 'Принт' || t === 'Без принту' || t === 'Матеріал') {
        result.push({ tag: el.tagName, class: el.className.substring(0,60), text: t });
      }
    }
    return result.slice(0, 20);
  })()`);
  console.log("PRINT/MATERIAL ELEMENTS:", JSON.stringify(printInfo, null, 2));
  
  await browser.close();
})();
