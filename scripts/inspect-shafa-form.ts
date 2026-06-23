/**
 * Скрипт-інспектор форми Shafa.ua
 *
 * Відкриває форму /uk/new, вибирає категорію і виводить
 * ВСІ знайдені секції, їх назви та доступні опції.
 * Результат зберігається у shafa-form-map.json
 *
 * Запуск: SHAFA_HEADLESS=false npx tsx scripts/inspect-shafa-form.ts
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import * as fs from "fs/promises";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

// ─── Категорія для інспекції ──────────────────────────────────────────────
const CATEGORY_PATH = ["Жіночий одяг", "Плаття", "Сукні міді"];

// ─── авторизація ──────────────────────────────────────────────────────────

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
    (await page.locator("text=Вийти").count()) > 0 ||
    (await page.locator('a[href*="/profile"]').count()) > 0 ||
    (await page.locator('[class*="avatar"]').count()) > 0
  );
}

async function loginToShafa(
  page: Page,
  context: BrowserContext,
  sessionPath: string,
  email: string,
  password: string
): Promise<void> {
  await page.goto("https://shafa.ua/uk/login", { waitUntil: "networkidle" });
  await page
    .locator('input[placeholder="Введіть логін"], input[placeholder="Введите логин"]')
    .fill(email);
  await page
    .locator('input[placeholder="Введіть пароль"], input[placeholder="Введите пароль"]')
    .fill(password);
  await page.getByRole("button", { name: /Увійти|Войти/i }).click();
  await page.waitForTimeout(5000);
  await context.storageState({ path: sessionPath });
  console.log("Авторизація успішна");
}

// ─── інспекція ────────────────────────────────────────────────────────────

type FieldInfo = {
  sectionLabel: string;
  type: "options" | "input" | "textarea" | "file" | "unknown";
  options?: string[];
  inputType?: string;
  placeholder?: string;
};

/**
 * Збирає всі "секції" сторінки: знаходить підписи і відповідні їм елементи.
 * Повертає масив FieldInfo.
 */
async function inspectFormFields(page: Page): Promise<FieldInfo[]> {
  const results: FieldInfo[] = [];

  // Знаходимо всі можливі label-елементи (h3, label, div з текстом)
  // Shafa використовує різні теги для заголовків секцій
  const labelSelectors = [
    "label",
    "h3",
    "h4",
    ".form-label",
    "[class*='label']",
    "[class*='title']",
    "[class*='heading']",
  ];

  const seenLabels = new Set<string>();

  for (const sel of labelSelectors) {
    const els = await page.locator(sel).all();

    for (const el of els) {
      let text = "";
      try {
        text = (await el.textContent())?.trim() || "";
      } catch {
        continue;
      }

      // Фільтруємо: тільки короткі осмислені мітки (не цілі абзаци)
      if (!text || text.length > 80 || text.length < 2) continue;
      if (seenLabels.has(text)) continue;
      if (!(await el.isVisible().catch(() => false))) continue;

      seenLabels.add(text);

      const info: FieldInfo = { sectionLabel: text, type: "unknown" };

      // Шукаємо input/textarea поруч (у parent-контейнері)
      for (let depth = 1; depth <= 6; depth++) {
        try {
          const ancestor = el.locator(`xpath=ancestor::*[${depth}]`);
          if ((await ancestor.count()) === 0) break;

          // input
          const inputs = await ancestor.locator("input").all();
          for (const inp of inputs) {
            if (!(await inp.isVisible().catch(() => false))) continue;
            const type = (await inp.getAttribute("type")) || "text";
            if (type === "hidden" || type === "file") {
              if (type === "file") { info.type = "file"; break; }
              continue;
            }
            const placeholder = (await inp.getAttribute("placeholder")) || "";
            info.type = "input";
            info.inputType = type;
            info.placeholder = placeholder;
            break;
          }

          // textarea
          if (info.type === "unknown") {
            const tas = await ancestor.locator("textarea").all();
            for (const ta of tas) {
              if (!(await ta.isVisible().catch(() => false))) continue;
              info.type = "textarea";
              info.placeholder = (await ta.getAttribute("placeholder")) || "";
              break;
            }
          }

          // Кнопки/опції (для вибору розміру, кольору тощо)
          if (info.type === "unknown" || info.type === "options") {
            const btnEls = await ancestor
              .locator("button, [role='button'], [class*='option'], [class*='chip'], [class*='tag'], [class*='btn']")
              .all();

            const optionTexts: string[] = [];
            for (const btn of btnEls) {
              if (!(await btn.isVisible().catch(() => false))) continue;
              const t = (await btn.textContent())?.trim() || "";
              if (t && t.length < 40 && !optionTexts.includes(t)) {
                optionTexts.push(t);
              }
            }

            if (optionTexts.length >= 2) {
              info.type = "options";
              info.options = optionTexts.slice(0, 30); // max 30 опцій
              break;
            }
          }

          if (info.type !== "unknown") break;
        } catch {
          continue;
        }
      }

      results.push(info);
    }
  }

  return results;
}

/**
 * Простіший dump: знаходить усі видимі блоки з заголовком + кнопками
 * використовуючи CSS класи Shafa.
 */
async function dumpAllClickableGroups(page: Page): Promise<Record<string, string[]>> {
  // Шукаємо всі елементи що схожі на "кнопку вибору опції"
  // і групуємо їх за батьківськими контейнерами
  const map: Record<string, string[]> = {};

  // Збираємо всі input[type=radio], input[type=checkbox] та їх labels
  const labels = await page.locator("label").all();
  for (const label of labels) {
    if (!(await label.isVisible().catch(() => false))) continue;
    const text = (await label.textContent())?.trim() || "";
    if (!text || text.length > 60) continue;

    // Шукаємо найближчу секцію-батька з назвою
    for (let depth = 1; depth <= 8; depth++) {
      try {
        const ancestor = label.locator(`xpath=ancestor::*[${depth}]`);
        if ((await ancestor.count()) === 0) break;

        // Шукаємо заголовок секції
        const headings = await ancestor
          .locator("h2, h3, h4, [class*='title'], [class*='label']")
          .all();

        for (const h of headings) {
          const ht = (await h.textContent())?.trim() || "";
          if (!ht || ht.length > 60 || ht.length < 2) continue;
          if (!(await h.isVisible().catch(() => false))) continue;

          if (!map[ht]) map[ht] = [];
          if (!map[ht].includes(text)) map[ht].push(text);
          break;
        }
      } catch {
        continue;
      }
    }
  }

  return map;
}

/**
 * Проходить по вкладеній категорії крок за кроком і робить скрін після кожного.
 */
async function selectCategoryAndInspect(page: Page, categoryPath: string[]): Promise<void> {
  console.log("\n=== Вибір категорії ===");

  for (let i = 0; i < categoryPath.length; i++) {
    const cat = categoryPath[i];
    console.log(`  [${i + 1}] Клікаю: "${cat}"`);

    const item = page.getByText(cat, { exact: true }).last();

    if (!((await item.count()) > 0) || !(await item.isVisible().catch(() => false))) {
      console.log(`  ✗ Не знайдено: "${cat}"`);
      await page.screenshot({
        path: `shafa-inspect-cat-fail-${i}.png`,
        fullPage: true,
      });
      return;
    }

    await item.scrollIntoViewIfNeeded();
    await item.click();
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: `shafa-inspect-cat-${i}-${cat.replace(/[^а-яА-ЯіІїЇєЄa-zA-Z0-9]/g, "_")}.png`,
      fullPage: true,
    });
  }

  // Закриваємо меню категорій
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);

  console.log("  ✓ Категорія вибрана");
}

// ─── main ────────────────────────────────────────────────────────────────

async function main() {
  const email = process.env.SHAFA_EMAIL;
  const password = process.env.SHAFA_PASSWORD;
  if (!email || !password) throw new Error("SHAFA_EMAIL або SHAFA_PASSWORD не задані");

  const sessionPath = process.env.SHAFA_SESSION_PATH || "./shafa-session.json";
  const headless = process.env.SHAFA_HEADLESS !== "false";

  const browser = await chromium.launch({ headless });
  let context: BrowserContext;

  if (await fileExists(sessionPath)) {
    context = await browser.newContext({ storageState: sessionPath });
  } else {
    context = await browser.newContext();
  }

  const page = await context.newPage();

  if (!(await isAuthorized(page))) {
    await loginToShafa(page, context, sessionPath, email, password);
  } else {
    console.log("Вже авторизований");
  }

  // Відкриваємо форму
  await page.goto("https://shafa.ua/uk/new", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  console.log("\n=== КРОК 1: Форма без категорії ===");
  await page.screenshot({ path: "shafa-inspect-step1-empty.png", fullPage: true });

  // Дамп форми до вибору категорії
  const beforeCategoryFields = await inspectFormFields(page);
  console.log(`Знайдено секцій до вибору категорії: ${beforeCategoryFields.length}`);

  // Вибираємо категорію
  await selectCategoryAndInspect(page, CATEGORY_PATH);

  console.log("\n=== КРОК 2: Форма після вибору категорії ===");
  await page.screenshot({ path: "shafa-inspect-step2-with-category.png", fullPage: true });
  await page.waitForTimeout(1000);

  // Дамп форми після вибору категорії
  const afterCategoryFields = await inspectFormFields(page);
  console.log(`Знайдено секцій після вибору категорії: ${afterCategoryFields.length}`);

  // Також робимо простіший групований дамп
  const groupedOptions = await dumpAllClickableGroups(page);

  // Витягаємо DOM структуру ключових секцій через evaluate
  const domSnapshot = await page.evaluate(() => {
    const result: Record<string, string[]> = {};

    // Знаходимо всі секції з кнопками
    const allDivs = document.querySelectorAll("div, section, fieldset");

    allDivs.forEach((div) => {
      const buttons = div.querySelectorAll("button, label, [role='button']");
      if (buttons.length < 2) return;

      // Шукаємо заголовок
      const heading = div.querySelector("h1,h2,h3,h4,h5,legend,p,[class*='title'],[class*='label'],[class*='heading']");
      if (!heading) return;

      const title = heading.textContent?.trim() || "";
      if (!title || title.length > 80 || title.length < 2) return;

      const opts: string[] = [];
      buttons.forEach((b) => {
        const t = b.textContent?.trim() || "";
        if (t && t.length < 50 && !opts.includes(t)) opts.push(t);
      });

      if (opts.length >= 2 && !result[title]) {
        result[title] = opts.slice(0, 40);
      }
    });

    return result;
  });

  // Формуємо фінальний звіт
  const report = {
    url: page.url(),
    categoryPath: CATEGORY_PATH,
    timestamp: new Date().toISOString(),
    formSections: afterCategoryFields,
    groupedClickableOptions: groupedOptions,
    domSnapshot,
  };

  const reportPath = "shafa-form-map.json";
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

  console.log("\n=== ЗВІТ ===");
  console.log(`Збережено: ${reportPath}`);

  // Виводимо в консоль ключові знахідки
  console.log("\n─── DOM секції з опціями ───");
  for (const [title, opts] of Object.entries(domSnapshot)) {
    if (opts.length > 0) {
      console.log(`\n  📋 "${title}":`);
      opts.slice(0, 10).forEach((o) => console.log(`       • ${o}`));
      if (opts.length > 10) console.log(`       ... ще ${opts.length - 10}`);
    }
  }

  console.log("\n─── Поля форми (детально) ───");
  for (const f of afterCategoryFields) {
    if (f.type === "options" && f.options && f.options.length > 1) {
      console.log(`\n  🔘 "${f.sectionLabel}" [options]:`);
      f.options.slice(0, 8).forEach((o) => console.log(`       • ${o}`));
    } else if (f.type === "input") {
      console.log(`\n  ✏️  "${f.sectionLabel}" [input type=${f.inputType}] placeholder="${f.placeholder}"`);
    } else if (f.type === "textarea") {
      console.log(`\n  📝 "${f.sectionLabel}" [textarea] placeholder="${f.placeholder}"`);
    }
  }

  await browser.close();
  console.log("\n✓ Інспекція завершена");
}

main().catch((err) => {
  console.error("❌ Inspect failed:", err);
  process.exit(1);
});
