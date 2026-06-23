import { chromium, type BrowserContext, type Page } from "playwright";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import { ShafaProduct } from "./shafa.types";

// ─── Утиліти ──────────────────────────────────────────────────────────────

async function fileExists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function humanPause(baseMs: number) {
  const jitter = baseMs * 0.4 * (Math.random() - 0.5);
  await new Promise<void>(r => setTimeout(r, Math.round(baseMs + jitter)));
}

const p = () => humanPause(400);
const P = () => humanPause(1000);

// ─── Модальні вікна ───────────────────────────────────────────────────────

async function dismissModals(page: Page) {
  await humanPause(600);
  const children = await page.locator(".ReactModalPortal *").count();
  if (children === 0) return;

  await page.keyboard.press("Escape");
  await humanPause(700);
  if ((await page.locator(".ReactModalPortal *").count()) === 0) return;

  const closeBtn = page.locator(
    ".ReactModalPortal button[aria-label], .ReactModalPortal button:has-text('×'), .ReactModalPortal button:has-text('✕'), .ReactModalPortal button:has-text('Зрозуміло'), .ReactModalPortal button:has-text('Закрити')"
  ).first();
  if ((await closeBtn.count()) > 0) {
    await closeBtn.click({ force: true });
    await humanPause(700);
    return;
  }

  await page.mouse.click(5, 5);
  await humanPause(700);
}

// ─── Клік по опції ────────────────────────────────────────────────────────

async function clickOption(page: Page, text: string): Promise<boolean> {
  const el = page.getByText(text, { exact: true }).first();
  if (!((await el.count()) > 0 && (await el.isVisible({ timeout: 2000 }).catch(() => false)))) {
    return false;
  }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await humanPause(200);
  await el.click();
  await humanPause(300);
  return true;
}

// ─── Кроки заповнення ─────────────────────────────────────────────────────

async function uploadImages(page: Page, imagePaths: string[]) {
  const resolved = imagePaths.map(i => path.resolve(i));
  for (const rp of resolved) {
    if (!(await fileExists(rp))) throw new Error(`Фото не знайдено: ${rp}`);
  }
  // Wait for file input — after fresh login the React app takes longer to mount
  await page.locator('input[type="file"]').first().waitFor({ state: "attached", timeout: 90000 });
  await page.locator('input[type="file"]').first().setInputFiles(resolved, { timeout: 90000 });
  await page.waitForTimeout(5000);
}

async function fillTitle(page: Page, title: string) {
  let input = page.locator('input[name="titleUk"]').first();
  if (!(await input.isVisible({ timeout: 2000 }).catch(() => false))) {
    input = page.locator('input[placeholder*="Куртка"]').first();
  }
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await humanPause(400);
  await input.fill(title);
  await p();
  await page.keyboard.press("Escape");
  await humanPause(400);
  await dismissModals(page);
}

async function fillCategory(page: Page, categoryPath: string[]) {
  await dismissModals(page);
  for (const cat of categoryPath) {
    const item = page.getByText(cat, { exact: true }).last();
    if (!((await item.count()) > 0 && (await item.isVisible({ timeout: 5000 }).catch(() => false)))) {
      throw new Error(`Категорія не знайдена: ${cat}`);
    }
    await item.scrollIntoViewIfNeeded().catch(() => {});
    await humanPause(500);
    await item.click();
    await humanPause(1200);
  }
  await page.keyboard.press("Escape");
  await humanPause(800);
}

async function fillCondition(page: Page, condition: string) {
  if (!(await clickOption(page, condition))) {
    throw new Error(`Стан "${condition}" не знайдено`);
  }
  await p();
}

async function fillBrand(page: Page, brand?: string) {
  if (!brand) return;
  // Бренд — input без placeholder всередині секції Бренд
  const idx: number = await page.evaluate(
    `(function() {
      var all = Array.from(document.querySelectorAll('*'));
      var lbl = all.find(function(el) {
        var t = (el.innerText||el.textContent||'').trim();
        return t === 'Бренд';
      });
      if (!lbl) return -1;
      var c = lbl.parentElement; var d = 0;
      while (c && d < 8) {
        var inp = c.querySelector('input[type="text"]');
        if (inp && inp.offsetParent !== null) {
          return Array.from(document.querySelectorAll('input[type="text"]')).indexOf(inp);
        }
        c = c.parentElement; d++;
      }
      return -1;
    })()`
  ) as number;
  if (idx < 0) return;
  const input = page.locator('input[type="text"]').nth(idx);
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click();
  await humanPause(400);
  await input.pressSequentially(brand, { delay: 60 });
  await humanPause(800);
  // Вибираємо першу підказку якщо є
  const listbox = page.locator('[role="listbox"], [role="option"]').first();
  if ((await listbox.count()) > 0 && (await listbox.isVisible({ timeout: 500 }).catch(() => false))) {
    await page.keyboard.press("ArrowDown");
    await humanPause(200);
    await page.keyboard.press("Enter");
  }
  await p();
}

async function fillQuantity(page: Page, quantity?: string) {
  if (!quantity) return;
  const idx: number = await page.evaluate(
    `(function() {
      var all = Array.from(document.querySelectorAll('*'));
      var sec = all.find(function(el) {
        var t = (el.innerText||el.textContent||'').trim();
        return t.indexOf('Наявність') !== -1 && t.length < 30;
      });
      if (!sec) return -1;
      var c = sec.parentElement; var d = 0;
      while (c && d < 8) {
        var i = c.querySelector('input[type="number"]');
        if (i && i.offsetParent !== null) {
          return Array.from(document.querySelectorAll('input[type="number"]')).indexOf(i);
        }
        c = c.parentElement; d++;
      }
      return -1;
    })()`
  ) as number;
  if (idx >= 0) {
    await page.locator('input[type="number"]').nth(idx).fill(quantity);
    await p();
  }
}

async function fillDescription(page: Page, description: string) {
  const ta = page.locator('textarea[placeholder*="параметри"]').first();
  await ta.scrollIntoViewIfNeeded();
  await ta.click();
  await humanPause(400);
  await ta.fill(description);
  await p();
  await page.keyboard.press("Escape");
  await humanPause(400);
  await dismissModals(page);
}

// ─── Ключові слова ────────────────────────────────────────────────────────

async function fillKeywords(page: Page, keywords: string[]) {
  if (!keywords.length) return;

  // Скролимо вниз щоб форма повністю відрендерилась
  await page.evaluate("window.scrollBy(0, 600)");
  await humanPause(600);
  await dismissModals(page);

  const findKwIdx = () => page.evaluate(`(function() {
    var allControls = Array.from(document.querySelectorAll('[class*="-control"]'));
    for (var i = 0; i < allControls.length; i++) {
      var ctrl = allControls[i];
      var placeholder = ctrl.querySelector('[class*="-placeholder"]');
      if (placeholder) {
        var t = (placeholder.innerText || placeholder.textContent || '').toLowerCase();
        if (t.indexOf('ключові') !== -1) return i;
      }
      var ctrlText = (ctrl.innerText || ctrl.textContent || '').trim();
      if (ctrlText.toLowerCase().indexOf('ключові') !== -1) return i;
    }
    // Fallback: шукаємо input з id react-select і перевіряємо label поруч
    var inputs = Array.from(document.querySelectorAll('input[id*="react-select"]'));
    for (var j = 0; j < inputs.length; j++) {
      var inp = inputs[j];
      var container = inp.closest('[class*="-container"]');
      if (!container) continue;
      var nearby = container.previousElementSibling || container.parentElement;
      if (nearby) {
        var nt = (nearby.innerText || nearby.textContent || '').toLowerCase();
        if (nt.indexOf('ключові') !== -1) {
          var ctrl2 = container.querySelector('[class*="-control"]');
          if (ctrl2) {
            return Array.from(document.querySelectorAll('[class*="-control"]')).indexOf(ctrl2);
          }
        }
      }
    }
    return -1;
  })()`);

  let kwIdx: number = await findKwIdx() as number;

  // Retry: прокручуємо нижче і шукаємо ще раз
  if (kwIdx < 0) {
    await page.evaluate("window.scrollBy(0, 400)");
    await humanPause(800);
    kwIdx = await findKwIdx() as number;
  }

  if (kwIdx < 0) {
    console.log("[Shafa] Keywords field not found, skipping");
    return;
  }
  console.log(`[Shafa] Keywords control found at index ${kwIdx}, entering ${keywords.length} keywords`);

  const kwControl = page.locator('[class*="-control"]').nth(kwIdx);
  await kwControl.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await humanPause(600);
  await kwControl.click({ force: true });
  await humanPause(500);
  await dismissModals(page);

  // Цикл: для кожного keyword — клік, введення, чекаємо loading, Enter або клік на підказку
  for (const kw of keywords) {
    await kwControl.click({ force: true });
    await humanPause(200);
    await page.keyboard.type(kw, { delay: 60 });
    await humanPause(500);
    // Чекаємо поки зникне "Loading..."
    await page.waitForFunction(
      `!document.querySelector('[class*="-loading-message"]')`,
      { timeout: 2500 }
    ).catch(() => {});
    await humanPause(300);

    const firstOption = page.locator('[class*="-option"]').first();
    if (await firstOption.isVisible({ timeout: 600 }).catch(() => false)) {
      await firstOption.click({ force: true });
    } else {
      await page.keyboard.press("Enter");
    }
    await humanPause(400);
  }

  await page.keyboard.press("Escape");
  await humanPause(300);
  await page.evaluate("document.activeElement && document.activeElement.blur()");
  await P();
}

// ─── Розміри (кнопки) ─────────────────────────────────────────────────────

async function selectSizes(page: Page, sizes?: string[], sizeSystem = "Міжнародний") {
  if (!sizes || sizes.length === 0) return;

  // Прокручуємо до секції Розмір та клікаємо систему розмірів через Playwright
  const sizeHeader = page.getByText(/Розмір/i).first();
  if ((await sizeHeader.count()) > 0) {
    await sizeHeader.scrollIntoViewIfNeeded().catch(() => {});
    await humanPause(400);
  }

  // Клік по системі розмірів: Playwright getByRole для надійного кліку
  const sysBtn = page.getByRole("button", { name: sizeSystem, exact: true });
  if ((await sysBtn.count()) > 0) {
    await sysBtn.first().scrollIntoViewIfNeeded().catch(() => {});
    await sysBtn.first().click();
    await humanPause(800);
  }

  // Клік по кожному розміру: шукаємо кнопку точно в секції розмірів
  for (const size of sizes) {
    // Спочатку Playwright getByRole
    const sizeBtn = page.getByRole("button", { name: size, exact: true });
    const sizeBtnCount = await sizeBtn.count();
    if (sizeBtnCount > 0) {
      await sizeBtn.first().scrollIntoViewIfNeeded().catch(() => {});
      await sizeBtn.first().click({ force: true });
      await humanPause(400);
    } else {
      // Fallback: JS click в межах секції Розмір
      await page.evaluate(`(function(sz) {
        var all = Array.from(document.querySelectorAll('*'));
        var sizeLabel = null; var minLen = Infinity;
        for (var i = 0; i < all.length; i++) {
          var t = (all[i].innerText||all[i].textContent||'').trim();
          if (t.indexOf('Розмір') !== -1 && t.length < minLen && all[i].offsetParent !== null) {
            minLen = t.length; sizeLabel = all[i];
          }
        }
        if (!sizeLabel) return;
        var container = sizeLabel.parentElement; var d = 0;
        while (container && d < 8) {
          var btns = Array.from(container.querySelectorAll('button'));
          var b = btns.find(function(btn) { return btn.innerText.trim() === sz && btn.offsetParent !== null; });
          if (b) { b.scrollIntoView({ block:'nearest' }); b.click(); return; }
          container = container.parentElement; d++;
        }
      })(${JSON.stringify(size)})`);
      await humanPause(400);
    }
  }
  await p();
}

// ─── Кольори (кнопки) ─────────────────────────────────────────────────────

async function selectColors(page: Page, colors?: string[]) {
  if (!colors || colors.length === 0) return;
  const label = page.getByText(/відтінків/i).first();
  if ((await label.count()) > 0) {
    await label.scrollIntoViewIfNeeded().catch(() => {});
    await humanPause(400);
  }
  for (const color of colors.slice(0, 2)) {
    await clickOption(page, color);
    await p();
  }
}

// ─── Текстове поле з автодоповненням (як матеріал) ────────────────────────

async function fillLabeledTextField(page: Page, labelText: string, value: string) {
  // Знаходимо ctrl за допомогою evaluateHandle: знаходимо перший ctrl що СЛІДУЄ за label
  const ctrlHandle = await page.evaluateHandle((lbl: string) => {
    const all = Array.from(document.querySelectorAll("*"));
    const label = all.reduce((best: Element | null, el: Element) => {
      if ((el as HTMLElement).offsetParent === null) return best;
      const t = ((el as HTMLElement).innerText || el.textContent || "").trim().toLowerCase();
      const lblL = lbl.toLowerCase();
      if (!((t === lblL) || (t.indexOf(lblL) !== -1 && t.length < lbl.length + 8))) return best;
      if (!best) return el;
      return t.length < ((best as HTMLElement).innerText || best.textContent || "").trim().length ? el : best;
    }, null);
    if (!label) return null;
    // Знаходимо перший ctrl що СЛІДУЄ за label в DOM order і знаходиться поруч (спільний предок до 6 рівнів)
    const allCtrls = Array.from(document.querySelectorAll("[class*=\"-control\"]"));
    return allCtrls.find(c => {
      if (label.contains(c)) return false;
      if (!(label.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      let a = label.parentElement; let d = 0;
      while (a && d < 6) { if (a.contains(c)) return true; a = a.parentElement; d++; }
      return false;
    }) || null;
  }, labelText);

  const ctrlElement = ctrlHandle.asElement();
  if (!ctrlElement) {
    console.log(`[Shafa] Field "${labelText}" not found`);
    return;
  }

  const ctrl = ctrlElement;
  await ctrl.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await ctrl.click({ timeout: 5000 });
  } catch(e: any) {
    console.log(`[Shafa] "${labelText}" click error: ${(e as Error).message?.slice(0,80)}`);
    return;
  }
  await humanPause(500);

  const menu = page.locator('[class*="-menu"]').first();
  let menuVisible = await menu.isVisible({ timeout: 1000 }).catch(() => false);

  // Якщо меню не відкрилось (server-side autocomplete) — вводимо першу літеру
  let prefixTyped = '';
  if (!menuVisible) {
    prefixTyped = value.charAt(0).toLowerCase();
    await page.keyboard.type(prefixTyped, { delay: 60 });
    await humanPause(800);
    await page.waitForFunction(
      `!document.querySelector('[class*="-loading-message"]')`,
      { timeout: 3000 }
    ).catch(() => {});
    menuVisible = await menu.isVisible({ timeout: 1000 }).catch(() => false);
  }

  if (!menuVisible) {
    console.log(`[Shafa] "${labelText}" → no dropdown for: "${value}"`);
    await page.keyboard.press("Escape");
    return;
  }

  // Допоміжна функція: scroll option into view + click at coordinates
  const tryClickOption = async (val: string): Promise<boolean> => {
    const result2 = await page.evaluate((v: string) => {
      const opts = Array.from(document.querySelectorAll('[class*="-option"]'));
      const allTexts = opts.map(o => ((o as HTMLElement).innerText || o.textContent || '').trim()).slice(0, 20);
      const opt = opts.find(o => ((o as HTMLElement).innerText || o.textContent || '').trim() === v) as HTMLElement | undefined;
      if (!opt) return { found: false, allTexts };
      opt.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const r = opt.getBoundingClientRect();
      return { found: true, allTexts, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, val);
    if (!result2.found) return false;
    await humanPause(60);
    await page.mouse.click(result2.x!, result2.y!);
    return true;
  };

  if (await tryClickOption(value)) {
    console.log(`[Shafa] "${labelText}" → clicked: "${value}"`);
  } else {
    // Опція не знайдена — вводимо решту значення (після вже введеного префіксу)
    const remainingToType = prefixTyped && value.toLowerCase().startsWith(prefixTyped)
      ? value.slice(prefixTyped.length)
      : value;
    if (remainingToType !== value) {
      // Вже є перша літера — просто дописуємо решту
      await page.keyboard.type(remainingToType, { delay: 60 });
    } else {
      // Очищаємо та вводимо знову
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Backspace");
      await humanPause(100);
      await page.keyboard.type(value, { delay: 60 });
    }
    await humanPause(700);
    await page.waitForFunction(
      `!document.querySelector('[class*="-loading-message"]')`,
      { timeout: 3000 }
    ).catch(() => {});
    await humanPause(300);
    if (await tryClickOption(value)) {
      console.log(`[Shafa] "${labelText}" → clicked via search: "${value}"`);
    } else {
      const firstOpt = menu.locator('[class*="-option"]').first();
      if (await firstOpt.isVisible({ timeout: 1000 }).catch(() => false)) {
        const optText = await firstOpt.innerText().catch(() => "?");
        await firstOpt.click({ force: true });
        console.log(`[Shafa] "${labelText}" → clicked first opt: "${optText.trim()}"`);
      } else {
        console.log(`[Shafa] "${labelText}" → no option for: "${value}"`);
        await page.keyboard.press("Escape");
      }
    }
  }
  await humanPause(400);
}

async function fillLabeledTextFields(page: Page, labelText: string, values?: string[]) {
  if (!values || values.length === 0) return;
  for (const v of values) {
    await fillLabeledTextField(page, labelText, v);
  }
}

// ─── Кнопки-опції (масив) ─────────────────────────────────────────────────

async function clickOptions(page: Page, values?: string[]) {
  if (!values || values.length === 0) return;
  for (const v of values) {
    await clickOption(page, v);
    await p();
  }
}

// ─── Ціна ─────────────────────────────────────────────────────────────────

async function fillPrice(page: Page, price: string) {
  let input = page.locator('input[name="price"]').first();
  if (!(await input.isVisible({ timeout: 1000 }).catch(() => false))) {
    input = page.locator('input[placeholder="150"]').last();
  }
  if (!(await input.isVisible({ timeout: 1000 }).catch(() => false))) return;
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await humanPause(300);
  await input.fill(price);
  await p();
}

// ─── Основний потік ───────────────────────────────────────────────────────

async function fillShafaForm(page: Page, product: ShafaProduct) {
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "domcontentloaded", timeout: 90000 });
  await humanPause(3000);
  console.log(`[Shafa] After goto /uk/new — url: ${page.url()}`);
  const debugDir = fsSync.existsSync("/data") ? "/data" : ".";
  await page.screenshot({ path: `${debugDir}/shafa-debug-new-page.png`, fullPage: false }).catch(() => {});

  await dismissModals(page);
  await uploadImages(page, product.imagePaths);
  await P();
  await fillTitle(page, product.title);
  await P();
  await fillCategory(page, product.categoryPath);
  await P();
  await fillCondition(page, product.condition);
  await fillBrand(page, product.brand);
  await fillQuantity(page, product.quantity);
  await P();
  await fillDescription(page, product.description);
  await P();
  await fillKeywords(page, product.keywords);

  // ── Основні характеристики ──
  await selectSizes(page, product.sizes, product.sizeSystem);
  await selectColors(page, product.colors);

  // ── Додаткові характеристики — текстові поля ──
  await fillLabeledTextFields(page, "Матеріал",            product.materials);
  await P();
  await fillLabeledTextFields(page, "Силует",              product.silhouette);
  await fillLabeledTextFields(page, "Фасон",               product.fashionCut);
  await fillLabeledTextFields(page, "Стиль",               product.style);
  if (product.decor) await fillLabeledTextField(page, "Декор", product.decor);
  await fillLabeledTextFields(page, "Особливості моделі",  product.modelFeatures);
  // Принт: якщо є — вводимо, якщо нема — "Без принту" (автодоповнення)
  const printValues = (product.print && product.print.length > 0)
    ? product.print
    : ["Без принту"];
  await fillLabeledTextFields(page, "Принт", printValues);

  // ── Додаткові характеристики — кнопки ──
  if (product.sleeveLength) { await clickOption(page, product.sleeveLength); await p(); }
  await clickOptions(page, product.sleeveStyle);
  await clickOptions(page, product.features);
  await clickOptions(page, product.seasons);
  if (product.madeInUkraine) { await clickOption(page, product.madeInUkraine); await p(); }

  await P();
  await fillPrice(page, product.price);
  await P();
}

// ─── Авторизація ──────────────────────────────────────────────────────────

async function isAuthorized(page: Page) {
  await page.goto("https://shafa.ua", { waitUntil: "domcontentloaded", timeout: 60000 });
  return (
    (await page.locator("text=Мій профіль").count()) > 0 ||
    (await page.locator("text=Вийти").count()) > 0 ||
    (await page.locator('a[href*="/profile"]').count()) > 0 ||
    (await page.locator('[class*="avatar"]').count()) > 0
  );
}

async function saveSession(context: BrowserContext, sessionPath: string) {
  const dir = path.dirname(path.resolve(sessionPath));
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
  await context.storageState({ path: sessionPath });
}

async function loginToShafa(
  page: Page, context: BrowserContext,
  sessionPath: string, email: string, password: string
) {
  await page.goto("https://shafa.ua/uk/login", { waitUntil: "domcontentloaded" });
  await humanPause(2000);
  console.log(`[Shafa] Login page url: ${page.url()}`);
  const debugDir = fsSync.existsSync("/data") ? "/data" : ".";
  await page.screenshot({ path: `${debugDir}/shafa-debug-login.png` }).catch(() => {});

  // Try multiple login field selectors
  const loginInput = page.locator('input[placeholder*="логін"], input[placeholder*="логин"], input[type="email"], input[name="login"], input[name="email"]').first();
  await loginInput.waitFor({ timeout: 15000 });
  await loginInput.fill(email);
  await humanPause(500);

  const passwordInput = page.locator('input[placeholder*="пароль"], input[type="password"]').first();
  await passwordInput.fill(password);
  await humanPause(700);

  await page.getByRole("button", { name: /Увійти|Войти/i }).click();
  await page.waitForTimeout(6000);
  console.log(`[Shafa] After login url: ${page.url()}`);
  await page.screenshot({ path: `${debugDir}/shafa-debug-after-login.png` }).catch(() => {});
  await saveSession(context, sessionPath);
}

// ─── Публічна функція ─────────────────────────────────────────────────────

export type ShafaPublishResult = {
  externalPostId?: string;
  raw?: unknown;
};

export async function publishToShafa(product: ShafaProduct): Promise<ShafaPublishResult> {
  const email = process.env.SHAFA_EMAIL;
  const password = process.env.SHAFA_PASSWORD;
  if (!email || !password) throw new Error("SHAFA_EMAIL або SHAFA_PASSWORD не задані в .env");

  const sessionPath = process.env.SHAFA_SESSION_PATH || "/data/shafa-session.json";
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const context = (await fileExists(sessionPath))
    ? await browser.newContext({ storageState: sessionPath })
    : await browser.newContext();

  const page = await context.newPage();

  try {
    if (!(await isAuthorized(page))) {
      await loginToShafa(page, context, sessionPath, email, password);
    }

    await fillShafaForm(page, product);

    // Закриваємо будь-які відкриті dropdown перед сабмітом
    await page.keyboard.press("Escape");
    await humanPause(300);
    await page.evaluate("document.body.click()");
    await humanPause(500);

    const debugDir = fsSync.existsSync("/data") ? "/data" : ".";

    // Скріншот перед сабмітом
    await page.screenshot({ path: `${debugDir}/shafa-before-submit.png`, fullPage: true }).catch(() => {});

    // Натискаємо "Додати річ"
    const btn = page.getByRole("button", { name: /Додати річ|Добавить вещь/i });
    const btnCount = await btn.count();
    console.log(`[Shafa] Submit btn count: ${btnCount}, url: ${page.url()}`);

    if (btnCount > 0) {
      await btn.first().evaluate(el => el.scrollIntoView({ block: "center" }));
      await humanPause(600);
      await btn.first().click({ force: true });
      console.log("[Shafa] Submit btn clicked via Playwright");
    } else {
      const jsFound = await page.evaluate(`(function() {
        var btns = Array.from(document.querySelectorAll('button'));
        var b = btns.find(function(b) {
          return /Додати річ|Добавить вещь|Зберегти/i.test((b.innerText||b.textContent||'').trim());
        });
        if (b) { b.scrollIntoView({ block:'center' }); b.click(); return b.innerText.trim(); }
        return null;
      })()`);
      console.log("[Shafa] JS submit btn:", jsFound);
      if (!jsFound) throw new Error("Кнопка 'Додати річ' не знайдена на сторінці");
    }

    // Чекаємо переходу на сторінку опублікованого товару
    // Shafa після успішної публікації редиректить на /uk/item/... або /uk/closet
    let finalUrl = page.url();
    try {
      await page.waitForURL(
        url => url.toString().includes("/item/") || url.toString().includes("/closet") || url.toString().includes("/profile"),
        { timeout: 30000 }
      );
      finalUrl = page.url();
      console.log(`[Shafa] Success! Redirected to: ${finalUrl}`);
    } catch {
      // URL не змінився — перевіримо помилки на сторінці
      finalUrl = page.url();
      console.log(`[Shafa] No redirect after 30s, current url: ${finalUrl}`);

      const errorText = await page.locator('[class*="error"], [class*="Error"], .alert, [role="alert"]').first().textContent().catch(() => "");
      await page.screenshot({ path: `${debugDir}/shafa-submit-error.png`, fullPage: true }).catch(() => {});

      if (errorText) throw new Error(`Shafa показала помилку: ${errorText.trim()}`);
      if (finalUrl.includes("/new") || finalUrl.includes("/edit")) {
        throw new Error("Форма не відправилась — сторінка не змінилась після сабміту");
      }
    }

    // Save updated session
    await saveSession(context, sessionPath).catch(() => {});

    await page.screenshot({ path: `${debugDir}/shafa-after-submit.png`, fullPage: true }).catch(() => {});
    return { externalPostId: finalUrl };
  } finally {
    await browser.close();
  }
}
