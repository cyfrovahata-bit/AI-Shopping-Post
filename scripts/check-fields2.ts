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
  
  // Scroll down to load all
  await page.evaluate("window.scrollTo(0, 3000)");
  await page.waitForTimeout(500);
  
  // Get ALL input[type=text] placeholders and surrounding text
  const inputs = await page.evaluate(`(function() {
    return Array.from(document.querySelectorAll('input[type="text"]'))
      .filter(el => el.offsetParent !== null)
      .map(function(inp, i) {
        var parent = inp.parentElement;
        var d = 0;
        var labelText = '';
        while (parent && d < 6) {
          var prevEl = parent.previousElementSibling;
          if (prevEl) {
            var t = (prevEl.innerText||prevEl.textContent||'').trim().substring(0,50);
            if (t.length > 2) { labelText = t; break; }
          }
          var parentText = '';
          for (var c of parent.childNodes) {
            if (c.nodeType === 3) parentText += c.textContent;
          }
          if (parentText.trim().length > 2) { labelText = parentText.trim().substring(0,50); break; }
          parent = parent.parentElement; d++;
        }
        return { index: i, placeholder: inp.placeholder, value: inp.value, nearLabel: labelText };
      });
  })()`);
  console.log("TEXT INPUTS:", JSON.stringify(inputs, null, 2));
  
  // Take screenshot of additional chars section
  await page.evaluate("window.scrollTo(0, 2500)");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shafa-scroll2500.png", fullPage: false });
  
  await browser.close();
})();
