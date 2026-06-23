import { chromium } from "playwright";
import path from "path";
import * as fsp from "fs/promises";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "shafa-session.json", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  
  // Upload image
  await page.locator('input[type="file"]').first().setInputFiles(path.resolve("test-images/blue-satin/1.webp"));
  await page.waitForTimeout(5000);
  
  // Title
  await page.locator('input[name="titleUk"]').first().fill("Блакитна сукня");
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  
  // Category
  await page.getByText("Жіночий одяг", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Плаття", { exact: true }).last().click(); await page.waitForTimeout(1500);
  await page.getByText("Сукні міді", { exact: true }).last().click(); await page.waitForTimeout(2000);
  
  // Fill 2 keywords
  await page.evaluate("window.scrollBy(0, 600)"); await page.waitForTimeout(600);
  
  const kwIdx: number = await page.evaluate(`(function() {
    var allControls = Array.from(document.querySelectorAll('[class*="-control"]'));
    for (var i = 0; i < allControls.length; i++) {
      var ctrl = allControls[i];
      var placeholder = ctrl.querySelector('[class*="-placeholder"]');
      if (placeholder) {
        var t = (placeholder.innerText || placeholder.textContent || '').toLowerCase();
        if (t.indexOf('ключові') !== -1) return i;
      }
    }
    return -1;
  })()`);
  
  if (kwIdx >= 0) {
    const kwCtrl = page.locator('[class*="-control"]').nth(kwIdx);
    await kwCtrl.click({ force: true }); await page.waitForTimeout(200);
    await page.keyboard.type("Атлас", { delay: 60 }); await page.waitForTimeout(1000);
    await page.waitForFunction(`!document.querySelector('[class*="-loading-message"]')`, { timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(300);
    const opt = page.locator('[class*="-option"]').first();
    if (await opt.isVisible({ timeout: 600 }).catch(() => false)) await opt.click({ force: true });
    else await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  }
  
  // Now check what inputs exist
  const inputInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input[type="text"]'))
      .filter(el => (el as HTMLElement).offsetParent !== null)
      .map((inp, i) => {
        let el: Element = inp;
        let d = 0;
        let nearText = '';
        while (el && d < 8) {
          const parent = el.parentElement;
          if (!parent) break;
          let sib = el.previousElementSibling;
          while (sib) {
            const t = ((sib as HTMLElement).innerText || sib.textContent || '').trim();
            if (t.length > 2 && t.length < 60) { nearText = t; break; }
            sib = sib.previousElementSibling;
          }
          if (nearText) break;
          el = parent; d++;
        }
        return { i, nearText: nearText.substring(0, 40) };
      });
  });
  
  console.log("Inputs after keywords fill:");
  inputInfo.forEach((inp: any) => console.log(`  [${inp.i}] near: "${inp.nearText}"`));
  
  // Also test the label search
  const matIdx = await page.evaluate(`(function() {
    var all = Array.from(document.querySelectorAll('*'));
    var label = all.reduce(function(best, el) {
      var t = (el.innerText||el.textContent||'').trim().toLowerCase();
      var lbl = 'матеріал';
      var match = (t === lbl) || (t.indexOf(lbl) !== -1 && t.length < lbl.length + 8);
      if (!match) return best;
      if (!best) return el;
      return t.length < (best.innerText||best.textContent||'').trim().length ? el : best;
    }, null);
    if (!label) return -99;
    var labelText = (label.innerText||label.textContent||'').trim();
    var allInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(function(el) { return el.offsetParent !== null; });
    var c = label.parentElement; var d = 0;
    while (c && d < 4) {
      var inputs = Array.from(c.querySelectorAll('input[type="text"]'));
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        if (inp.offsetParent === null) continue;
        if (!(label.compareDocumentPosition(inp) & 4)) continue;
        return allInputs.indexOf(inp);
      }
      c = c.parentElement; d++;
    }
    return -1;
  })()`);
  console.log("Матеріал inputIdx after kw fill:", matIdx);
  
  await browser.close();
})();
