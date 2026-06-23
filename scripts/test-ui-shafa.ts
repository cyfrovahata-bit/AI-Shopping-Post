import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const BASE_URL = "http://localhost:3000";

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  console.log("Відкриваємо сайт...");
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  // === Фото (нові, не ті що вже публікувались) ===
  console.log("Завантажуємо фото...");
  const photos = [
    path.resolve(__dirname, "../test-images/dress_1.jpg"),
    path.resolve(__dirname, "../test-images/dress_2.jpg"),
    path.resolve(__dirname, "../test-images/dress_3.jpg"),
  ];
  const photoInput = page.locator('input[type="file"][name="photos"]');
  await photoInput.setInputFiles(photos);
  await page.waitForTimeout(1500);
  console.log(`Завантажено ${photos.length} фото`);

  // === Назва ===
  await page.fill('input[name="title"]', "Чорна коктейльна сукня міні з мереживом і відкритими плечима");

  // === Ціна ===
  await page.fill('input[name="price"]', "1350");

  // === Розміри ===
  await page.fill('input[name="sizes"]', "XS, S, M, L");

  // === Кольори ===
  await page.fill('input[name="colors"]', "чорний");

  // === Тканина ===
  await page.fill('input[name="fabric"]', "мереживо, підкладка");

  // === Додатковий опис ===
  await page.fill(
    'textarea[name="description"]',
    "Витончена мереживна сукня міні для вечірніх виходів. Відкриті плечі та мереживний верх додають жіночності. Підкладка забезпечує комфорт. Ідеально для вечірок, святкових заходів і побачень."
  );

  // === Платформи — тільки Shafa ===
  // Checkboxes are visually hidden — click the parent label
  console.log("Вибираємо тільки Shafa...");
  async function setPlatform(value: string, enable: boolean) {
    const input = page.locator(`input[name="selectedPlatforms"][value="${value}"]`);
    const checked = await input.isChecked();
    if (checked !== enable) {
      // Click the label that wraps this input
      await input.evaluate((el) => (el.closest("label") as HTMLElement)?.click());
      await page.waitForTimeout(200);
    }
  }
  await setPlatform("telegram", false);
  await setPlatform("instagram", false);
  await setPlatform("facebook", false);
  await setPlatform("shafa", true);
  await page.waitForTimeout(500);

  // === Натискаємо Прев'ю ===
  console.log("Натискаємо Прев'ю...");
  await page.click('#previewBtn');

  // Чекаємо поки AI згенерує (може тривати до 30 сек)
  console.log("Чекаємо генерацію AI...");
  await page.waitForSelector('#previewPanel:not(.hidden)', { timeout: 60000 });
  console.log("Прев'ю готове!");
  await page.waitForTimeout(2000);

  // Скріншот прев'ю
  await page.screenshot({ path: "shafa-ui-preview.png", fullPage: false });
  console.log("Скріншот прев'ю збережено: shafa-ui-preview.png");

  // === Знаходимо кнопку Опублікувати для Shafa ===
  console.log("Шукаємо кнопку публікації Shafa...");
  const publishBtn = page.locator('button.publish-btn[data-platform="shafa"], button:has-text("Опублікувати")').first();

  if (await publishBtn.isVisible()) {
    console.log("Натискаємо Опублікувати на Shafa...");
    await publishBtn.click();

    // Poll every 5s for up to 4 minutes
    console.log("Публікуємо на Shafa (~2 хв), чекаємо...");
    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(5000);
      const isLoading = await page.evaluate(() => {
        const bar = document.getElementById("progressBar");
        return bar && !bar.classList.contains("hidden");
      });
      const elapsed = Math.round((Date.now() - (deadline - 4 * 60 * 1000)) / 1000);
      console.log(`  ${elapsed}с — прогрес-бар: ${isLoading ? "активний" : "зник"}`);
      if (!isLoading) break;
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: "shafa-ui-published.png", fullPage: false });
    console.log("Скріншот після публікації збережено: shafa-ui-published.png");

    // Check status message
    const statusText = await page.locator('#statusMessage, .toast').first().textContent().catch(() => "");
    console.log("Повідомлення на сторінці:", statusText);
  } else {
    console.log("Кнопка публікації не знайдена, перевіряємо HTML...");
    const html = await page.locator('#platformEditor').innerHTML();
    console.log("platformEditor HTML:", html.slice(0, 800));
  }

  console.log("\nГотово! Перевір скріншоти.");
  await browser.close();
}

run().catch((e) => {
  console.error("Помилка:", e.message);
  process.exit(1);
});
