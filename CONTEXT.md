# AI Shopping Post — Контекст проекту

> Оновлено: 2026-06-21

## Що це

Веб-застосунок для автоматичної публікації товарів жіночого одягу в соцмережах.
Клієнт завантажує фото/відео + дані товару → AI генерує текст → публікується на вибрані платформи.

---

## Стек

- **Backend**: Node.js + TypeScript + Express (`src/server.ts`)
- **База даних**: SQLite (`src/db/sqlite.ts`) — файл `database.sqlite` в корені
- **AI**: OpenAI Responses API (`openai.responses.create`) — SDK v6+, модель через `OPENAI_MODEL` env або fallback `gpt-4o`
- **Shafa.ua**: Playwright (headful Chromium) — `src/shafa/`
- **Відео**: ffmpeg + ffprobe — `src/video-overlay.ts`
- **Шрифт для відео**: `fonts/Arial-Bold.ttf` (скопійований з Windows, є в репо)
- **Frontend**: Vanilla JS + HTML — `public/index.html`, `public/app.js`, `public/products.html`

---

## Структура src/

```
src/
  server.ts              # Express: роути, upload, generate, publish, schedule
  scheduler.ts           # Планувальник: кожні 45с перевіряє scheduled posts, withRetry(3, 4000ms)
  ai-generator.ts        # OpenAI: generatePlatformPost, generateVideoTexts
  platform-types.ts      # TypeScript типи: PlatformId, ProductInput, PublishingPlatform
  telegram.ts            # Telegram Bot API: фото, відео, медіагрупа, кнопка замовлення
  instagram.ts           # Instagram Graph API: фото, карусель, Reels
  facebook.ts            # Facebook Graph API: фото, відео, альбом
  video-overlay.ts       # ffmpeg: drawtext overlay на відео для Reels
  db/sqlite.ts           # Ініціалізація БД, міграції, ensureColumn
  platforms/index.ts     # Реєстр платформ: telegram, instagram, facebook, shafa + future stubs
  shafa/
    shafa.types.ts       # ShafaProduct type, SHAFA_COLORS, SHAFA_SIZES_INT константи
    shafa.mapper.ts      # mapProductToShafa: ProductInput → ShafaProduct
    shafa.publisher.ts   # Playwright: fillTitle, fillCategory, fillDescription, publishToShafa
    shafa.session.ts     # Збереження Playwright browser context (авторизаційна сесія)
    index.ts             # Re-exports
```

---

## БД — таблиці

### products
Основна таблиця товарів. Ключові поля:
- `id, title, price, dropPrice, sizes, colors, fabric, model, description`
- `videoUrl, videoPath, videoStyle (fashion/minimal/premium/sale)`
- `processedVideoPath, processedVideoUrl, useProcessedVideo`
- `generateVideo` — чи робити відео-оверлей
- `userId TEXT DEFAULT 'default'` — поле є, але multi-user ще не реалізовано

### product_images
Фотографії товару (багато до одного product).
- `productId, imageUrl, photoPath, sortOrder`

### platform_posts
Пости для кожної платформи.
- `productId, platform, text, status (draft/scheduled/publishing/published/failed)`
- `scheduledAt, publishedAt, externalPostId, externalChatId, errorMessage`

---

## Платформи

| ID | Статус | Нотатки |
|----|--------|---------|
| telegram | ✅ Працює | Фото, відео, медіагрупа, кнопка замовлення (ORDER_URL в .env) |
| instagram | ✅ Працює | Потребує публічного HTTPS SITE_URL; Reels, карусель, фото |
| facebook | ✅ Працює | Фото, відео, альбом |
| shafa | ✅ Працює | Playwright, headful Chromium, людиноподібні затримки, session storage |
| viber, prom, rozetka, olx | 🔜 Stub | `supportsPublishing: false`, кидають помилку при спробі публікації |

---

## Shafa.ua — деталі Playwright

**Проблема яку вирішили**: ReactModalPortal блокує кліки після натискання на title/description.
**Рішення**: `dismissModals()` через `Escape` + перевірка `.ReactModalPortal *` через `.count()` (не `isVisible()`).

**Ключові моменти**:
- `.last()` для категорії (навбар теж має "Жіночий одяг" — `.first()` бере не те)
- Keywords input: `input[id^="react-select"]`
- `humanPause(baseMs)` з ±40% jitter скрізь
- `pressSequentially` з `delay: 50-60ms` для typing

**Extras (додаткові поля від юзера)**:
В preview-панелі є UI для: brand, condition, season, sleeveLength, madeInUkraine, categoryPath (3 рівні + presets).
Передаються через `POST /api/platform-posts/:id/publish` → `extras` в body → `publishPlatformPost(db, id, extras)` → `shafaPlatform.publish({ extras })`.

---

## Відео-оверлей (Reels)

**Файл**: `src/video-overlay.ts`

**Стилі**: `minimal`, `fashion` (дефолт), `premium`, `sale`

**Важливо**:
- `-pix_fmt yuv420p` додано — Instagram інакше відхиляє
- Emoji (`🔥 👉 ✦`) прибрано з drawtext — ffmpeg їх не рендерить без emoji-шрифту
- Шрифт: `fonts/Arial-Bold.ttf` — `HAS_FONT` перевіряє наявність, graceful fallback
- Позиції: top=`h*0.10`, center=`(h-text_h)/2`, bottom=`h*0.76` (safe zone для Instagram UI)

---

## .env змінні

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o          # або новіша модель

BOT_TOKEN=                   # Telegram bot token
TELEGRAM_CHAT_ID=            # ID каналу/групи
ORDER_URL=                   # URL кнопки "Замовити" (якщо порожньо — кнопка не додається)

INSTAGRAM_USER_ID=
INSTAGRAM_ACCESS_TOKEN=

FACEBOOK_PAGE_ID=
FACEBOOK_ACCESS_TOKEN=

SITE_URL=                    # Публічний HTTPS URL (потрібен для Instagram/Facebook)
PUBLIC_BASE_URL=             # Базовий URL для відео-файлів

DB_PATH=./database.sqlite    # Шлях до БД (опційно)
PORT=3000
```

---

## API ендпоінти (server.ts)

| Метод | Шлях | Що робить |
|-------|------|-----------|
| POST | `/api/upload` | Завантаження фото/відео, створення product |
| POST | `/api/generate` | AI-генерація текстів для вибраних платформ |
| GET | `/api/products` | Список товарів |
| GET | `/api/products/:id` | Один товар з posts |
| DELETE | `/api/products/:id` | Видалення товару |
| POST | `/api/platform-posts/:id/publish` | Публікація (+ `extras` в body для Shafa) |
| POST | `/api/platform-posts/:id/schedule` | Запланувати публікацію |
| PATCH | `/api/platform-posts/:id` | Оновити текст поста |
| POST | `/api/process-video` | Запустити ffmpeg overlay на відео |

---

## Що НЕ зроблено (найближчий пріоритет)

### 1. Авторизація — КРИТИЧНО для продажу
Зараз будь-хто з URL може публікувати. Потрібно:
- Таблиця `users` в БД (email, password_hash, createdAt)
- `express-session` + bcrypt
- Middleware `requireAuth` на всі `/api/` роути
- Сторінки `/login`, `/register`
- **Оцінка**: ~1 година роботи

### 2. Credentials per-user
Зараз всі токени в `.env` — один клієнт на весь інстанс.
Потрібно:
- Таблиця `user_credentials` (userId, platform, key, value encrypted)
- UI-сторінка для підключення платформ
- `getPlatformCredentials(userId)` замість `process.env`
- **Оцінка**: ~2-3 години

### 3. Onboarding для клієнта
Клієнт сам має змогу зареєструватись і підключити свій Telegram/Instagram.
- **Оцінка**: ~2 години (після п.1 і п.2)

### 4. Дрібниці (некритично)
- Retry для scheduled posts (вже є `withRetry` в scheduler — застосовано)
- Instagram API версія `v25.0` — вже константа `GRAPH_API`
- Індекс на `platform_posts(platform)` — відсутній
- `PRAGMA foreign_keys = ON` не увімкнено в SQLite

---

## Команди запуску

```bash
npm run dev          # Запуск з ts-node/watch
npm run build        # Збірка TypeScript
npm start            # Запуск зібраного

# Shafa тест/публікація
npx tsx scripts/test-shafa.ts
```

---

## Важливі рішення / підводні камені

1. **OpenAI SDK v6+** використовує `openai.responses.create()` і `input_image`/`input_text` types — це НЕ баг, це новий Responses API
2. **Shafa ReactModalPortal** — перевіряти через `.count()`, не `isVisible()`
3. **Shafa категорія** — завжди `.last()`, бо навбар теж містить ті самі тексти
4. **ffmpeg emoji** — не рендеряться без emoji-шрифту; замінено на текст
5. **Instagram** потребує `yuv420p` і публічного HTTPS URL для медіа
6. **Telegram ORDER_URL** — якщо не задано в `.env`, кнопка просто не додається (раніше був захардкоджений чужий URL як fallback — виправлено)
