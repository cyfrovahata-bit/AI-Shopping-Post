import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import * as fs from "fs/promises";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

type TestProduct = {
  title: string;
  description: string;
  price: string;
  condition: string;
  brand?: string;
  keywords: string[];
  imagePaths: string[];
  categoryPath: string[];
  gtin?: string;
  videoUrl?: string;
  size?: string;
  color?: string;
  quantity?: string;
};

const testProduct: TestProduct = {
  title: "Тестовий товар AI Shopping Post",
  description:
    "Тестовий опис товару з AI Shopping Post. Перевіряємо автозаповнення Shafa через Playwright.",
  price: "500",
  condition: "Новий",
  brand: undefined,
  keywords: ["шорти", "жіночі шорти", "літні шорти"],
  imagePaths: ["./test-images/1.jpg"],
  categoryPath: ["Жіночий одяг", "Плаття", "Сукні міді"],
  gtin: "",
  videoUrl: "",
  size: "M",
  color: "Блакитний",
  quantity: "1",
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isAuthorized(page: Page): Promise<boolean> {
  await page.goto("https://shafa.ua", { waitUntil: "networkidle" });

  return (
    (await page.locator("text=Мій профіль").count()) > 0 ||
    (await page.locator("text=Мой профиль").count()) > 0 ||
    (await page.locator("text=Вийти").count()) > 0 ||
    (await page.locator("text=Выйти").count()) > 0 ||
    (await page.locator('a[href*="/profile"]').count()) > 0 ||
    (await page.locator('[class*="avatar"], [class*="user"]').count()) > 0
  );
}

async function loginToShafa(
  page: Page,
  context: BrowserContext,
  sessionPath: string,
  email: string,
  password: string
): Promise<void> {
  console.log("Сесія відсутня або протухла");
  console.log("Логінюся через логін + пароль");

  await page.goto("https://shafa.ua/uk/login", { waitUntil: "networkidle" });

  await page
    .locator('input[placeholder="Введіть логін"], input[placeholder="Введите логин"]')
    .fill(email);

  await page
    .locator('input[placeholder="Введіть пароль"], input[placeholder="Введите пароль"]')
    .fill(password);

  await page.getByRole("button", { name: /Увійти|Войти/i }).click();
  await page.waitForTimeout(5000);

  if (!(await isAuthorized(page))) {
    await page.screenshot({ path: "shafa-login-failed.png", fullPage: true });
    throw new Error("Не вдалося авторизуватись у Shafa");
  }

  await context.storageState({ path: sessionPath });
  console.log(`Сесію Shafa збережено: ${sessionPath}`);
}

function byPlaceholder(page: Page, text: string): Locator {
  return page.locator(`input[placeholder*="${text}"], textarea[placeholder*="${text}"]`).first();
}

async function clickText(page: Page, text: string): Promise<boolean> {
  const item = page.getByText(text, { exact: true }).last();

  if ((await item.count()) > 0 && (await item.isVisible().catch(() => false))) {
    await item.scrollIntoViewIfNeeded();
    await item.click();
    await page.waitForTimeout(700);
    return true;
  }

  return false;
}

async function uploadImages(page: Page, imagePaths: string[]): Promise<void> {
  const resolvedPaths = imagePaths.map((imagePath) => path.resolve(imagePath));

  for (const imagePath of resolvedPaths) {
    if (!(await fileExists(imagePath))) {
      throw new Error(`Фото не знайдено: ${imagePath}`);
    }
  }

  await page.locator('input[type="file"]').first().setInputFiles(resolvedPaths);
  await page.waitForTimeout(5000);

  console.log(`Фото завантажено: ${resolvedPaths.length}`);
}

async function fillVideoUrl(page: Page, videoUrl?: string): Promise<void> {
  if (!videoUrl) return;

  const input = page.locator('input[placeholder*="youtube"], input[placeholder*="watch"]').first();

  if ((await input.count()) > 0) {
    await input.fill(videoUrl);
    console.log("Відео URL заповнено");
  }
}

async function fillCategory(page: Page, categoryPath: string[]): Promise<void> {
  for (const categoryName of categoryPath) {
    const clicked = await clickText(page, categoryName);

    if (!clicked) {
      await page.screenshot({
        path: `shafa-category-not-found-${categoryName}.png`,
        fullPage: true,
      });

      throw new Error(`Категорію не знайдено: ${categoryName}`);
    }

    console.log(`Категорію вибрано: ${categoryName}`);
    await page.waitForTimeout(1000);
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);

  await page.screenshot({ path: "shafa-after-category.png", fullPage: true });
}

async function fillGtin(page: Page, gtin?: string): Promise<void> {
  if (!gtin) {
    console.log("GTIN не заданий, пропускаю");
    return;
  }

  const input = byPlaceholder(page, "Введіть код");

  if ((await input.count()) > 0) {
    await input.fill(gtin);
    console.log("GTIN заповнено");
  }
}

async function fillCondition(page: Page, condition: string): Promise<void> {
  const clicked = await clickText(page, condition);

  if (!clicked) {
    throw new Error(`Стан не знайдено: ${condition}`);
  }

  console.log(`Стан вибрано: ${condition}`);
}

async function fillBrand(page: Page, brand?: string): Promise<void> {
  if (!brand) {
    console.log("Бренд не заданий, пропускаю");
    return;
  }

  const input = byPlaceholder(page, "Почніть вводити");

  if ((await input.count()) === 0) {
    console.log("Поле бренду не знайдено");
    return;
  }

  await input.scrollIntoViewIfNeeded();
  await input.click();
  await page.keyboard.type(brand, { delay: 80 });
  await page.waitForTimeout(1000);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  console.log(`Бренд спробували вибрати: ${brand}`);
}

async function fillDescription(page: Page, description: string): Promise<void> {
  const textarea = page.locator("textarea").first();

  await textarea.scrollIntoViewIfNeeded();
  await textarea.fill(description);

  console.log("Опис заповнено");
}

async function fillKeywords(page: Page, keywords: string[]): Promise<void> {
  const label = page.getByText(/ключові слова/i).first();

  if ((await label.count()) === 0) {
    await page.screenshot({
      path: "shafa-keywords-label-not-found.png",
      fullPage: true,
    });

    throw new Error("Не знайдено текст 'ключові слова'");
  }

  await label.scrollIntoViewIfNeeded();

  const keywordInput = label
    .locator("xpath=ancestor::*[self::div or self::section][1]")
    .locator('input[type="text"], input:not([type]), textarea')
    .last();

  if ((await keywordInput.count()) === 0) {
    await page.screenshot({
      path: "shafa-keywords-input-not-found.png",
      fullPage: true,
    });

    throw new Error("Не знайдено input біля тексту 'ключові слова'");
  }

  for (const keyword of keywords) {
    await keywordInput.click();
    await page.keyboard.type(keyword, { delay: 80 });
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);

    console.log(`Ключове слово додано: ${keyword}`);
  }

  await page.screenshot({
    path: "shafa-after-keywords.png",
    fullPage: true,
  });
}

async function fillQuantity(page: Page, quantity?: string): Promise<void> {
  if (!quantity) return;

  const inputs = page.locator('input[type="number"], input');

  for (let i = 0; i < await inputs.count(); i++) {
    const input = inputs.nth(i);
    const box = await input.boundingBox().catch(() => null);

    if (!box) continue;

    const placeholder = await input.getAttribute("placeholder").catch(() => "");
    const value = await input.inputValue().catch(() => "");

    if (placeholder === "" && value === "1") {
      await input.fill(quantity);
      console.log(`Наявність заповнено: ${quantity}`);
      return;
    }
  }

  console.log("Поле наявності не знайдено");
}

async function selectSize(page: Page, size?: string): Promise<void> {
  if (!size) return;

  const clicked = await clickText(page, size);

  if (clicked) {
    console.log(`Розмір вибрано: ${size}`);
  } else {
    console.log(`Розмір не знайдено: ${size}`);
  }
}

async function selectColor(page: Page, color?: string): Promise<void> {
  if (!color) return;

  const clicked = await clickText(page, color);

  if (clicked) {
    console.log(`Колір вибрано: ${color}`);
  } else {
    console.log(`Колір не знайдено: ${color}`);
  }
}

async function fillPrice(page: Page, price: string): Promise<void> {
  const input = page.locator('input[name="price"]').first();

  await input.scrollIntoViewIfNeeded();
  await input.fill(price);

  console.log("Ціну заповнено");
}

async function submitIfNeeded(page: Page): Promise<void> {
  await page.screenshot({
    path: "shafa-before-submit.png",
    fullPage: true,
  });

  const autoSubmit = process.env.SHAFA_AUTO_SUBMIT === "true";

  if (!autoSubmit) {
    console.log("SHAFA_AUTO_SUBMIT=false, форму тільки заповнено");
    return;
  }

  const validationErrors = page.locator(
    'text=/потрібно|обов’язково|обовязково|заповніть|виберіть|помилка/i'
  );

  const errorsCount = await validationErrors.count();

  if (errorsCount > 0) {
    console.log(`Перед submit знайдено можливі помилки: ${errorsCount}`);

    await page.screenshot({
      path: "shafa-validation-before-submit.png",
      fullPage: true,
    });
  }

  const submitButton = page.getByRole("button", {
    name: /Додати річ|Добавить вещь/i,
  });

  await submitButton.scrollIntoViewIfNeeded();
  await submitButton.click();

  console.log("Натиснули Додати річ");

  await page.waitForTimeout(10000);

  await page.screenshot({
    path: "shafa-after-submit.png",
    fullPage: true,
  });

  console.log("Screenshot після submit: shafa-after-submit.png");
}

async function fillShafaForm(page: Page, product: TestProduct): Promise<void> {
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "networkidle" });

  await page.screenshot({ path: "shafa-add-product.png", fullPage: true });

  console.log("Успішно відкрили сторінку додавання товару");

  await uploadImages(page, product.imagePaths);
  await fillVideoUrl(page, product.videoUrl);

  await page.locator('input[name="titleUk"]').fill(product.title);
  console.log("Назву заповнено");

  await fillCategory(page, product.categoryPath);
  await fillGtin(page, product.gtin);
  await fillCondition(page, product.condition);
  await fillQuantity(page, product.quantity);
  await fillBrand(page, product.brand);
  await fillDescription(page, product.description);
  await fillKeywords(page, product.keywords);

  await selectSize(page, product.size);
  await selectColor(page, product.color);

  await fillPrice(page, product.price);

  await submitIfNeeded(page);

  await page.screenshot({
    path: "shafa-filled-basic.png",
    fullPage: true,
  });

  console.log("Поля заповнені. Screenshot: shafa-filled-basic.png");
}

async function main() {
  const email = process.env.SHAFA_EMAIL;
  const password = process.env.SHAFA_PASSWORD;

  if (!email || !password) {
    throw new Error("SHAFA_EMAIL або SHAFA_PASSWORD не задані");
  }

  const sessionPath = process.env.SHAFA_SESSION_PATH || "./shafa-session.json";
  const sessionDir = path.dirname(sessionPath);

  if (sessionDir && sessionDir !== ".") {
    await fs.mkdir(sessionDir, { recursive: true });
  }

  const headless = process.env.SHAFA_HEADLESS !== "false";
  const browser = await chromium.launch({ headless });

  let context: BrowserContext;

  if (await fileExists(sessionPath)) {
    console.log("Використовую існуючу сесію");
    context = await browser.newContext({ storageState: sessionPath });
  } else {
    console.log("Сесія не знайдена");
    context = await browser.newContext();
  }

  const page = await context.newPage();

  if (!(await isAuthorized(page))) {
    await loginToShafa(page, context, sessionPath, email, password);
  } else {
    console.log("Вже авторизований");
  }

  await fillShafaForm(page, testProduct);

  console.log("Успішно");

  if (headless) {
    await browser.close();
  } else {
    console.log("Браузер залишено відкритим для перевірки");
  }
}

main().catch((error) => {
  console.error("Shafa test failed:", error);
  process.exit(1);
});