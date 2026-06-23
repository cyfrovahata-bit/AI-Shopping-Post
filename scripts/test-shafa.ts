import { chromium, type BrowserContext, type Page } from "playwright";
import * as fs from "fs/promises";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

// ─── Тип товару ───────────────────────────────────────────────────────────

type TestProduct = {
  title: string;
  description: string;
  price: string;
  condition: "Новий" | "Ідеальний" | "Дуже хороший" | "Хороший" | "Задовільний";
  brand?: string;
  keywords: string[];
  imagePaths: string[];
  categoryPath: string[];
  gtin?: string;
  videoUrl?: string;
  sizeSystem?: "Міжнародний" | "Європейський" | "🇺🇦 Український";
  size?: string;
  color?: string;
  material?: string;
  sleeveLength?: "Без рукавів" | "Довгий" | "Короткий" | "Три чверті";
  sleeveStyle?: "Рукави буфи" | "Рукави ліхтарики" | "Широкі рукави";
  features?: Array<"Великі розміри" | "Коктейльні" | "На випускний" | "Пишні">;
  season?: "Весна" | "Демісезон" | "Зима" | "Літо" | "Осінь";
  madeInUkraine?: "Виробництво" | "Хендмейд";
  quantity?: string;
};

const testProduct: TestProduct = {
  title: "Синя сукня міді облягаюча на бретелях нова",
  description:
    "Елегантна синя сукня міді облягаючого крою на тонких бретелях з V-подібним вирізом. Підкреслює фігуру, виглядає дорого і стильно. Ідеально підходить для вечірніх прогулянок, побачення, ресторану або вечірки. Щільна еластична тканина тримає форму, не мнеться. Розмір M, довжина нижче коліна. Стан: новий, не носилась, всі бирки на місці.",
  price: "650",
  condition: "Новий",
  keywords: ["синя сукня", "сукня міді", "облягаюча сукня", "вечірня сукня"],
  imagePaths: ["./test-images/dress_1.jpg"],
  categoryPath: ["Жіночий одяг", "Плаття", "Сукні міді"],
  sizeSystem: "Міжнародний",
  size: "M",
  color: "Синій",
  material: "Поліестер",
  sleeveLength: "Без рукавів",
  season: "Літо",
  quantity: "5",
};

// ─── Утиліти ──────────────────────────────────────────────────────────────

async function fileExists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Пауза що імітує людину: base ± 40% рандому */
async function humanPause(baseMs: number) {
  const jitter = baseMs * 0.4 * (Math.random() - 0.5);
  await new Promise<void>(r => setTimeout(r, Math.round(baseMs + jitter)));
}

const p = () => humanPause(400);       // коротка пауза між кроками
const P = () => humanPause(1000);      // довга пауза після важливих дій

async function isAuthorized(page: Page) {
  await page.goto("https://shafa.ua", { waitUntil: "networkidle" });
  return (
    (await page.locator("text=Мій профіль").count()) > 0 ||
    (await page.locator("text=Вийти").count()) > 0 ||
    (await page.locator('a[href*="/profile"]').count()) > 0 ||
    (await page.locator('[class*="avatar"]').count()) > 0
  );
}

async function loginToShafa(
  page: Page, context: BrowserContext,
  sessionPath: string, email: string, password: string
) {
  await page.goto("https://shafa.ua/uk/login", { waitUntil: "networkidle" });
  await humanPause(800);
  await page.locator('input[placeholder*="логін"], input[placeholder*="логин"]').fill(email);
  await humanPause(500);
  await page.locator('input[placeholder*="пароль"], input[placeholder*="пароль"]').fill(password);
  await humanPause(700);
  await page.getByRole("button", { name: /Увійти|Войти/i }).click();
  await page.waitForTimeout(5000);
  await context.storageState({ path: sessionPath });
  console.log("Авторизовано");
}

// ─── Клік по опції (пряме знаходження — без ancestor traversal) ───────────

/**
 * Клікає першу видиму кнопку/елемент з точним текстом optionText.
 * Більшість опцій на Shafa унікальні — пряме знаходження надійне і швидке.
 */
async function clickOption(page: Page, optionText: string, context = ""): Promise<boolean> {
  const el = page.getByText(optionText, { exact: true }).first();
  const ok = (await el.count()) > 0 && (await el.isVisible({ timeout: 2000 }).catch(() => false));
  if (!ok) {
    console.log(`  ✗ "${optionText}"${context ? ` (${context})` : ""} не знайдено`);
    return false;
  }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await humanPause(200);
  await el.click();
  await humanPause(300);
  console.log(`  ✓ "${optionText}"${context ? ` (${context})` : ""}`);
  return true;
}

// ─── Закриття модальних вікон ─────────────────────────────────────────────

/**
 * Закриває будь-яке модальне вікно що з'явилось на сторінці.
 * Shafa показує попапи після завантаження /uk/new.
 */
/**
 * Закриває будь-який ReactModalPortal що заважає взаємодії.
 * Використовуємо count() дочірніх елементів — isVisible() ненадійне для порталів.
 */
async function dismissModals(page: Page) {
  await humanPause(600);
  const children = await page.locator('.ReactModalPortal *').count();
  if (children === 0) return;

  console.log(`Знайдено модальне вікно (${children} ел.), закриваємо...`);

  // 1. Escape — найпростіший спосіб
  await page.keyboard.press("Escape");
  await humanPause(700);
  if ((await page.locator('.ReactModalPortal *').count()) === 0) {
    console.log("Модальне вікно закрито (Escape)");
    return;
  }

  // 2. Кнопка закриття (типово X кнопка або aria-label)
  const closeBtn = page.locator(
    '.ReactModalPortal button[aria-label], .ReactModalPortal button:has-text("×"), .ReactModalPortal button:has-text("✕"), .ReactModalPortal button:has-text("Зрозуміло"), .ReactModalPortal button:has-text("Закрити")'
  ).first();
  if ((await closeBtn.count()) > 0) {
    await closeBtn.click({ force: true });
    await humanPause(700);
    console.log("Модальне вікно закрито (кнопка)");
    return;
  }

  // 3. Клік поза вікном (overlay area)
  await page.mouse.click(5, 5);
  await humanPause(700);
  console.log("Модальне вікно — спроба клік поза");
}

// ─── Заповнення полів ─────────────────────────────────────────────────────

async function uploadImages(page: Page, imagePaths: string[]) {
  const resolved = imagePaths.map(i => path.resolve(i));
  for (const rp of resolved) {
    if (!(await fileExists(rp))) throw new Error(`Фото не знайдено: ${rp}`);
  }
  await page.locator('input[type="file"]').first().setInputFiles(resolved);
  await page.waitForTimeout(5000);
  console.log(`Фото: ${resolved.length}`);
}

async function fillTitle(page: Page, title: string) {
  let input = page.locator('input[name="titleUk"]').first();
  if (!(await input.isVisible({ timeout: 2000 }).catch(() => false))) {
    input = page.locator('input[placeholder*="Куртка"]').first();
  }
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await humanPause(400);
  await input.pressSequentially(title, { delay: 50 });
  await p();

  // Після набору назви з'являється попап "Рекомендована структура заголовка"
  // Закриваємо його Escape перед тим як продовжити
  await page.keyboard.press("Escape");
  await humanPause(500);
  await dismissModals(page);

  console.log("Назва ✓");
}

async function fillCategory(page: Page, categoryPath: string[]) {
  // Перевіряємо що немає попапу перед вибором категорій
  await dismissModals(page);

  for (const cat of categoryPath) {
    // Шукаємо текст категорії — .last() бо в навігації є дублікати (перші в nav)
    const item = page.getByText(cat, { exact: true }).last();

    if (!((await item.count()) > 0 && (await item.isVisible({ timeout: 5000 }).catch(() => false)))) {
      await page.screenshot({ path: `shafa-cat-fail.png`, fullPage: true });
      throw new Error(`Категорія не знайдена: ${cat}`);
    }

    await item.scrollIntoViewIfNeeded().catch(() => {});
    await humanPause(500);
    await item.click();
    await humanPause(1200);
    console.log(`  Категорія: ${cat}`);
  }

  await page.keyboard.press("Escape");
  await humanPause(800);
  await page.screenshot({ path: "shafa-after-category.png", fullPage: true });
}

async function fillCondition(page: Page, condition: string) {
  // Варіанти: Новий, Ідеальний, Дуже хороший, Хороший, Задовільний
  const ok = await clickOption(page, condition, "стан");
  if (!ok) throw new Error(`Стан "${condition}" не знайдено`);
  await p();
}

async function fillGtin(page: Page, gtin?: string) {
  if (!gtin) return;
  const input = page.locator('input[placeholder*="Введіть код"]').first();
  if ((await input.count()) > 0) {
    await input.fill(gtin);
    await p();
    console.log(`GTIN: ${gtin}`);
  }
}

async function fillQuantity(page: Page, quantity?: string) {
  if (!quantity) return;
  // Шукаємо числовий input наявності через JS (безпечний string-eval)
  const idx: number = await page.evaluate(
    `(function() {
      var allEls = Array.from(document.querySelectorAll('*'));
      var nayvSection = allEls.find(function(el) {
        var t = (el.innerText || el.textContent || '').trim();
        return t.indexOf('Наявність') !== -1 && t.length < 30;
      });
      if (!nayvSection) return -1;
      var container = nayvSection.parentElement;
      var depth = 0;
      while (container && depth < 8) {
        var inp = container.querySelector('input[type="number"]');
        if (inp && inp.offsetParent !== null) {
          var all = Array.from(document.querySelectorAll('input[type="number"]'));
          return all.indexOf(inp);
        }
        container = container.parentElement;
        depth++;
      }
      return -1;
    })()`
  ) as number;

  if (idx >= 0) {
    const input = page.locator('input[type="number"]').nth(idx);
    await input.fill(quantity);
    await p();
    console.log(`Наявність: ${quantity}`);
  } else {
    console.log("Наявність: поле не знайдено");
  }
}

async function fillBrand(page: Page, brand?: string) {
  if (!brand) return;
  const input = page.locator('input[placeholder=""]').first(); // Бренд — input без placeholder
  if (!(await input.isVisible({ timeout: 1000 }).catch(() => false))) {
    console.log("Бренд: не знайдено"); return;
  }
  await input.click();
  await humanPause(400);
  await input.pressSequentially(brand, { delay: 60 });
  await humanPause(800);
  await page.keyboard.press("ArrowDown");
  await humanPause(300);
  await page.keyboard.press("Enter");
  await p();
  console.log(`Бренд: ${brand}`);
}

async function fillDescription(page: Page, description: string) {
  const ta = page.locator('textarea[placeholder*="параметри"]').first();
  await ta.scrollIntoViewIfNeeded();
  await ta.click();
  await humanPause(400);
  await ta.pressSequentially(description, { delay: 30 });
  await p();
  // Клік по textarea може відкрити попап — закриваємо
  await page.keyboard.press("Escape");
  await humanPause(400);
  await dismissModals(page);
  console.log("Опис ✓");
}

async function fillKeywords(page: Page, keywords: string[]) {
  // Закриваємо будь-який попап перед взаємодією з ключовими словами
  await dismissModals(page);

  // react-select input для ключових слів — шукаємо через aria-label або placeholder
  // id="react-select-4-input" — але ID може змінюватись, шукаємо через JS
  const input = page.locator('input[id^="react-select"]').last();
  if ((await input.count()) === 0) {
    console.log("Ключові слова: react-select input не знайдено"); return;
  }

  await input.scrollIntoViewIfNeeded();
  await humanPause(300);
  await dismissModals(page); // ще раз після scroll

  // Клікаємо один раз — react-select залишає фокус після Enter
  await input.click({ timeout: 5000 });
  await humanPause(400);

  for (const kw of keywords) {
    await input.pressSequentially(kw, { delay: 60 });
    await humanPause(400);
    await page.keyboard.press("Enter");
    await humanPause(500);
    console.log(`  Слово: ${kw}`);
  }
  await P();
}

// ─── Основні характеристики ───────────────────────────────────────────────

async function selectSize(page: Page, size?: string, sizeSystem = "Міжнародний") {
  if (!size) return;
  // Прокручуємо до зони розмірів
  const sizeLabel = page.getByText("Розмір", { exact: false }).first();
  if ((await sizeLabel.count()) > 0) {
    await sizeLabel.scrollIntoViewIfNeeded().catch(() => {});
    await humanPause(400);
  }
  await clickOption(page, sizeSystem, "система розмірів");
  await humanPause(600);
  await clickOption(page, size, "розмір");
  await p();
}

async function selectColor(page: Page, color?: string) {
  if (!color) return;
  // "Виберіть до 2 відтінків * (+4%)" — колір унікальний на сторінці
  const colorLabel = page.getByText(/відтінків/i).first();
  if ((await colorLabel.count()) > 0) {
    await colorLabel.scrollIntoViewIfNeeded().catch(() => {});
    await humanPause(400);
  }
  await clickOption(page, color, "колір");
  await p();
}

// ─── Ціна ─────────────────────────────────────────────────────────────────

async function fillPrice(page: Page, price: string) {
  // Спочатку input[name="price"], потім placeholder="150"
  let input = page.locator('input[name="price"]').first();
  if (!(await input.isVisible({ timeout: 1000 }).catch(() => false))) {
    input = page.locator('input[placeholder="150"]').last();
  }
  if (!(await input.isVisible({ timeout: 1000 }).catch(() => false))) {
    console.log("Ціна: поле не знайдено"); return;
  }
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await humanPause(300);
  await input.fill(price);
  await p();
  console.log(`Ціна: ${price}`);
}

// ─── Матеріал ─────────────────────────────────────────────────────────────

async function fillMaterial(page: Page, material?: string) {
  if (!material) return;

  // Прокручуємо до секції
  const section = page.getByText("Додаткові характеристики", { exact: false }).first();
  if ((await section.count()) > 0) {
    await section.scrollIntoViewIfNeeded().catch(() => {});
    await humanPause(500);
  }

  // Шукаємо text input без placeholder у зоні "матеріал" через JS string-eval
  const idx: number = await page.evaluate(
    `(function() {
      function textOf(el) { return (el.innerText || el.textContent || '').trim(); }
      var all = Array.from(document.querySelectorAll('*'));
      var matLabel = all.find(function(el) {
        var t = textOf(el);
        return t.toLowerCase().indexOf('матеріал') !== -1 && t.length < 30;
      });
      var startEl = matLabel || all.find(function(el) {
        var t = textOf(el);
        return t.indexOf('Додаткові характеристики') !== -1 && t.length < 40;
      });
      if (!startEl) return -1;
      var container = startEl.parentElement;
      var depth = 0;
      while (container && depth < 10) {
        var inputs = Array.from(container.querySelectorAll('input[type="text"]'));
        for (var i = 0; i < inputs.length; i++) {
          var inp = inputs[i];
          if (inp.offsetParent !== null && !inp.placeholder) {
            var allInputs = Array.from(document.querySelectorAll('input[type="text"]'));
            return allInputs.indexOf(inp);
          }
        }
        container = container.parentElement;
        depth++;
      }
      return -1;
    })()`
  ) as number;

  if (idx < 0) { console.log("Матеріал: поле не знайдено"); return; }

  const input = page.locator('input[type="text"]').nth(idx);
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click();
  await humanPause(400);
  await input.pressSequentially(material, { delay: 60 });
  await humanPause(800);

  // Перевіряємо dropdown
  const dropdown = page.locator('[role="listbox"]').first();
  if ((await dropdown.count()) > 0 && (await dropdown.isVisible({ timeout: 500 }).catch(() => false))) {
    await page.keyboard.press("ArrowDown");
    await humanPause(200);
    await page.keyboard.press("Enter");
    console.log(`Матеріал (dropdown): ${material}`);
  } else {
    // Натискаємо Tab щоб перейти до наступного поля (безпечніше ніж Enter)
    await page.keyboard.press("Tab");
    console.log(`Матеріал: ${material}`);
  }
  await humanPause(400);
}

// ─── Додаткові характеристики ─────────────────────────────────────────────

async function fillAdditionalCharacteristics(page: Page, product: TestProduct) {
  console.log("\n── Додаткові характеристики ──");

  await fillMaterial(page, product.material);

  if (product.madeInUkraine) {
    // Варіанти: "Виробництво" | "Хендмейд"
    await clickOption(page, product.madeInUkraine, "зроблено в Україні");
    await p();
  }

  if (product.sleeveLength) {
    // "Без рукавів" | "Довгий" | "Короткий" | "Три чверті"
    await clickOption(page, product.sleeveLength, "довжина рукава");
    await p();
  }

  if (product.sleeveStyle) {
    // "Рукави буфи" | "Рукави ліхтарики" | "Широкі рукави"
    await clickOption(page, product.sleeveStyle, "фасон рукава");
    await p();
  }

  if (product.features?.length) {
    for (const f of product.features) {
      await clickOption(page, f, "особливості");
      await p();
    }
  }

  if (product.season) {
    // "Весна" | "Демісезон" | "Зима" | "Літо" | "Осінь" — дає +4%
    await clickOption(page, product.season, "сезон");
    await p();
  }

  await page.screenshot({ path: "shafa-after-additional.png", fullPage: true });
  console.log("── /Додаткові характеристики ──\n");
}

// ─── Submit ───────────────────────────────────────────────────────────────

async function submitIfNeeded(page: Page) {
  await page.screenshot({ path: "shafa-before-submit.png", fullPage: true });
  if (process.env.SHAFA_AUTO_SUBMIT !== "true") {
    console.log("SHAFA_AUTO_SUBMIT!=true → не публікуємо");
    return;
  }
  await P();
  const btn = page.getByRole("button", { name: /Додати річ|Добавить вещь/i });
  await btn.scrollIntoViewIfNeeded();
  await humanPause(600);
  await btn.click();
  console.log("Натиснуто 'Додати річ'");
  await page.waitForTimeout(8000);
  await page.screenshot({ path: "shafa-after-submit.png", fullPage: true });
}

// ─── Основний потік ───────────────────────────────────────────────────────

async function fillShafaForm(page: Page, product: TestProduct) {
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "networkidle" });
  await humanPause(1200);
  console.log("Відкрито /uk/new");

  // Закриваємо будь-який попап що міг з'явитись
  await dismissModals(page);

  await uploadImages(page, product.imagePaths);
  await P();
  await fillTitle(page, product.title);
  await P();

  // Закриваємо модалку ще раз — може з'явитись після upload
  await dismissModals(page);

  await fillCategory(page, product.categoryPath);
  await P();
  await fillCondition(page, product.condition);
  await fillGtin(page, product.gtin);
  await fillQuantity(page, product.quantity);
  await fillBrand(page, product.brand);
  await P();
  await fillDescription(page, product.description);
  await P();
  await fillKeywords(page, product.keywords);

  console.log("\n── Основні характеристики ──");
  await selectSize(page, product.size, product.sizeSystem);
  await selectColor(page, product.color);
  console.log("── /Основні характеристики ──");

  await fillAdditionalCharacteristics(page, product);

  await P();
  await fillPrice(page, product.price);

  await P();
  await submitIfNeeded(page);

  await page.screenshot({ path: "shafa-filled.png", fullPage: true });
  console.log("✓ Готово. Screenshot: shafa-filled.png");
}

async function main() {
  const email = process.env.SHAFA_EMAIL;
  const password = process.env.SHAFA_PASSWORD;
  if (!email || !password) throw new Error("SHAFA_EMAIL або SHAFA_PASSWORD не задані");

  const sessionPath = process.env.SHAFA_SESSION_PATH || "./shafa-session.json";
  const headless = process.env.SHAFA_HEADLESS !== "false";
  const browser = await chromium.launch({ headless });

  const context = (await fileExists(sessionPath))
    ? await browser.newContext({ storageState: sessionPath })
    : await browser.newContext();

  const page = await context.newPage();

  if (!(await isAuthorized(page))) {
    await loginToShafa(page, context, sessionPath, email, password);
  } else {
    console.log("Вже авторизований");
  }

  await fillShafaForm(page, testProduct);
  console.log("✓ Успішно");

  if (headless) await browser.close();
  else console.log("Браузер відкритий для перевірки");
}

main().catch(err => { console.error("❌", err); process.exit(1); });
