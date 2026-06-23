import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: "shafa-session.json" });
  const page = await ctx.newPage();
  
  // Open the just-published listing in edit mode to see what was filled
  await page.goto("https://shafa.ua/uk/item/212647218/edit", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Check keywords
  const kwTags = await page.evaluate(`(function() {
    var tags = Array.from(document.querySelectorAll('[class*="-multi-value"]'));
    return tags.map(function(t) { return (t.innerText||t.textContent||'').trim(); }).filter(Boolean).slice(0, 30);
  })()`);
  console.log("KEYWORDS:", JSON.stringify(kwTags));
  
  // Check material inputs
  const inputs = await page.evaluate(`(function() {
    return Array.from(document.querySelectorAll('input[type="text"]'))
      .filter(el => el.offsetParent !== null)
      .map(el => ({ placeholder: el.placeholder, value: el.value }))
      .filter(el => el.value || el.placeholder)
      .slice(0, 15);
  })()`);
  console.log("INPUTS:", JSON.stringify(inputs, null, 2));
  
  // Screenshot of additional characteristics section
  await page.screenshot({ path: "shafa-listing-check.png", fullPage: false, clip: { x: 0, y: 500, width: 1280, height: 900 } });
  await browser.close();
})();
