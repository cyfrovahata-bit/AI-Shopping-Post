// ── Auth helper ─────────────────────────────────────────
function authHeaders() {
  const token = localStorage.getItem('authToken');
  return token ? { 'Authorization': 'Bearer ' + token } : {};
}

// ── DOM refs ────────────────────────────────────────────
const form                = document.getElementById("productForm");
const photosInput         = document.getElementById("photos");
const videoInput          = document.getElementById("video");
const uploadBox           = document.getElementById("uploadBox");
const photoGallery        = document.getElementById("photoGallery");
const videoPreview        = document.getElementById("videoPreview");
const previewBtn          = document.getElementById("previewBtn");
const publishSelectedBtn  = document.getElementById("publishSelectedBtn");
const scheduleSelectedBtn = document.getElementById("scheduleSelectedBtn");
const newProductBtn       = document.getElementById("newProductBtn");
const previewPanel        = document.getElementById("previewPanel");
const tabs                = document.getElementById("tabs");
const platformEditor      = document.getElementById("platformEditor");
const statusMessage       = document.getElementById("statusMessage");
const productIdBadge      = document.getElementById("productIdBadge");

// ── 1. TOAST NOTIFICATIONS ───────────────────────────────
function showToast(message, type = "success", duration = 4500) {
  const container = document.getElementById("toastContainer");
  if (!container || !message) return;

  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "⋯";
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Закрити">×</button>
  `;
  toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));
  container.appendChild(toast);

  if (duration > 0) setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
  if (!toast.parentNode) return;
  toast.classList.add("toast-out");
  setTimeout(() => toast.remove(), 260);
}

function showMessage(message, type = "success") {
  if (statusMessage) {
    statusMessage.textContent = message;
    statusMessage.className = `status ${type}`;
  }
  if (message) showToast(message, type);
}

// ── 2. PROGRESS BAR ──────────────────────────────────────
function setLoading(isLoading, text = "") {
  [previewBtn, publishSelectedBtn, scheduleSelectedBtn].forEach(b => {
    b.disabled = isLoading;
  });

  const bar = document.getElementById("progressBar");
  const msg = document.getElementById("progressMsg");

  if (isLoading) {
    bar?.classList.remove("hidden");
    if (msg) msg.textContent = text;
    if (statusMessage) {
      statusMessage.textContent = text;
      statusMessage.className = "status loading";
    }
  } else {
    bar?.classList.add("hidden");
    if (msg) msg.textContent = "";
  }
}

// ── 5. PRESETS (localStorage) ────────────────────────────
const PRESETS_KEY      = "ai-post-presets-v1";
const LAST_SETTINGS_KEY = "ai-post-last-settings-v1";

function getPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]"); } catch { return []; }
}

function savePresetData(name) {
  const presets = getPresets().filter(p => p.name !== name);
  presets.unshift({
    name,
    platforms: selectedPlatforms(),
    videoStyle: form.querySelector('input[name="videoStyle"]:checked')?.value || "fashion",
  });
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.slice(0, 8)));
  refreshPresetSelect();
  showToast(`Шаблон «${name}» збережено`, "success", 3000);
}

function applyPreset(name) {
  const preset = getPresets().find(p => p.name === name);
  if (!preset) return;
  form.querySelectorAll('input[name="selectedPlatforms"]').forEach(cb => {
    cb.checked = preset.platforms.includes(cb.value);
  });
  if (preset.videoStyle) {
    const radio = form.querySelector(`input[name="videoStyle"][value="${preset.videoStyle}"]`);
    if (radio) {
      radio.checked = true;
      form.querySelectorAll(".video-style-card").forEach(c => c.classList.remove("active"));
      radio.closest(".video-style-card")?.classList.add("active");
    }
  }
  saveLastSettings();
}

function refreshPresetSelect() {
  const sel = document.getElementById("presetSelect");
  if (!sel) return;
  const presets = getPresets();
  sel.innerHTML = `<option value="">Шаблон налаштувань...</option>` +
    presets.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join("");
}

function saveLastSettings() {
  try {
    localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify({
      platforms: selectedPlatforms(),
      videoStyle: form.querySelector('input[name="videoStyle"]:checked')?.value || "fashion",
    }));
  } catch {}
}

function loadLastSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LAST_SETTINGS_KEY) || "{}");
    if (s.platforms?.length) {
      form.querySelectorAll('input[name="selectedPlatforms"]').forEach(cb => {
        cb.checked = s.platforms.includes(cb.value);
      });
    }
    if (s.videoStyle) {
      const radio = form.querySelector(`input[name="videoStyle"][value="${s.videoStyle}"]`);
      if (radio) {
        radio.checked = true;
        form.querySelectorAll(".video-style-card").forEach(c => c.classList.remove("active"));
        radio.closest(".video-style-card")?.classList.add("active");
      }
    }
  } catch {}
}

function initPresets() {
  refreshPresetSelect();
  loadLastSettings();

  document.getElementById("presetSelect")?.addEventListener("change", e => {
    if (e.target.value) applyPreset(e.target.value);
    e.target.value = "";
  });

  document.getElementById("savePresetBtn")?.addEventListener("click", () => {
    const name = prompt("Назва шаблону (наприклад: TG + Instagram):");
    if (name?.trim()) savePresetData(name.trim());
  });

  // Auto-save last settings when platforms or video style change
  form.addEventListener("change", e => {
    if (
      e.target.name === "selectedPlatforms" ||
      e.target.name === "videoStyle"
    ) saveLastSettings();
  });
}

// ── Video style ──────────────────────────────────────────
function initVideoStyles() {
  document.querySelectorAll('input[name="videoStyle"]').forEach(radio => {
    radio.addEventListener("change", () => {
      document.querySelectorAll(".video-style-card").forEach(c => c.classList.remove("active"));
      radio.closest(".video-style-card")?.classList.add("active");
    });
  });

  form.querySelector('input[name="generateVideo"]')
    ?.addEventListener("change", syncVideoSettingsVisibility);

  syncVideoSettingsVisibility();
}

function syncVideoSettingsVisibility() {
  const videoSettings   = document.getElementById("videoSettings");
  const videoStyleSelect = document.getElementById("videoStyleSelect");
  const generateVideoInput = form.querySelector('input[name="generateVideo"]');
  const hasVideo = !!videoInput?.files?.length;

  if (!videoSettings) return;
  videoSettings.classList.toggle("hidden", !hasVideo);

  if (videoStyleSelect && generateVideoInput) {
    videoStyleSelect.classList.toggle("hidden", !generateVideoInput.checked);
  }
}

// ── Platform names / constants ───────────────────────────
const platformNames = {
  telegram:  "Telegram",
  instagram: "Instagram",
  facebook:  "Facebook",
  shafa:     "Shafa.ua",
};

const SHAFA_CATEGORY_PRESETS = [
  { label: "Сукні міді",       path: ["Жіночий одяг", "Плаття", "Сукні міді"] },
  { label: "Міні-сукні",       path: ["Жіночий одяг", "Плаття", "Міні-сукні"] },
  { label: "Максі-сукні",      path: ["Жіночий одяг", "Плаття", "Максі-сукні"] },
  { label: "Блузи та сорочки", path: ["Жіночий одяг", "Блузи та сорочки", "Блузи"] },
  { label: "Топи",             path: ["Жіночий одяг", "Топи та футболки", "Топи"] },
  { label: "Футболки",         path: ["Жіночий одяг", "Топи та футболки", "Футболки"] },
  { label: "Светри",           path: ["Жіночий одяг", "Светри та кардигани", "Светри"] },
  { label: "Куртки",           path: ["Жіночий одяг", "Верхній одяг", "Куртки"] },
  { label: "Пальта",           path: ["Жіночий одяг", "Верхній одяг", "Пальта"] },
  { label: "Спідниці міді",    path: ["Жіночий одяг", "Спідниці", "Міді"] },
  { label: "Джинси",           path: ["Жіночий одяг", "Штани та шорти", "Джинси"] },
  { label: "Штани",            path: ["Жіночий одяг", "Штани та шорти", "Штани"] },
];

let shafaExtras = {
  brand: "",
  categoryPath: ["Жіночий одяг", "Плаття", "Сукні міді"],
  condition: "Новий",
  season: "",
  sleeveLength: "",
  madeInUkraine: "",
};

function renderShafaExtras() {
  const catMatch = SHAFA_CATEGORY_PRESETS.findIndex(
    p => JSON.stringify(p.path) === JSON.stringify(shafaExtras.categoryPath)
  );
  return `
    <div class="shafa-extras">
      <h4 style="margin:16px 0 10px;font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.6px;font-weight:600">
        Поля для Shafa.ua
      </h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <label style="grid-column:1/-1">
          Категорія
          <select id="shafaCategoryPreset">
            <option value="-1">— шаблон категорії —</option>
            ${SHAFA_CATEGORY_PRESETS.map((p, i) =>
              `<option value="${i}" ${catMatch === i ? "selected" : ""}>${p.label}</option>`
            ).join("")}
          </select>
        </label>
        <label>
          Розділ 1
          <input type="text" id="shafaCat1" value="${escapeHtml(shafaExtras.categoryPath[0] || "")}" placeholder="Жіночий одяг">
        </label>
        <label>
          Розділ 2
          <input type="text" id="shafaCat2" value="${escapeHtml(shafaExtras.categoryPath[1] || "")}" placeholder="Плаття">
        </label>
        <label style="grid-column:1/-1">
          Підкатегорія
          <input type="text" id="shafaCat3" value="${escapeHtml(shafaExtras.categoryPath[2] || "")}" placeholder="Сукні міді">
        </label>
        <label>
          Бренд
          <input type="text" id="shafaBrand" value="${escapeHtml(shafaExtras.brand)}" placeholder="Zara, H&M, No name...">
        </label>
        <label>
          Стан
          <select id="shafaCondition">
            ${["Новий","Ідеальний","Дуже хороший","Хороший","Задовільний"].map(v =>
              `<option value="${v}" ${shafaExtras.condition === v ? "selected" : ""}>${v}</option>`
            ).join("")}
          </select>
        </label>
        <label>
          Сезон
          <select id="shafaSeason">
            <option value="">— не вказано</option>
            ${["Весна","Демісезон","Зима","Літо","Осінь"].map(v =>
              `<option value="${v}" ${shafaExtras.season === v ? "selected" : ""}>${v}</option>`
            ).join("")}
          </select>
        </label>
        <label>
          Рукав
          <select id="shafaSleeveLength">
            <option value="">— не вказано</option>
            ${["Без рукавів","Довгий","Короткий","Три чверті"].map(v =>
              `<option value="${v}" ${shafaExtras.sleeveLength === v ? "selected" : ""}>${v}</option>`
            ).join("")}
          </select>
        </label>
        <label>
          Зроблено в Україні
          <select id="shafaMadeInUkraine">
            <option value="">— ні</option>
            ${["Виробництво","Хендмейд"].map(v =>
              `<option value="${v}" ${shafaExtras.madeInUkraine === v ? "selected" : ""}>${v}</option>`
            ).join("")}
          </select>
        </label>
      </div>
    </div>
  `;
}

function syncShafaExtras() {
  const preset  = document.getElementById("shafaCategoryPreset");
  const cat1    = document.getElementById("shafaCat1");
  const cat2    = document.getElementById("shafaCat2");
  const cat3    = document.getElementById("shafaCat3");
  const brand   = document.getElementById("shafaBrand");
  const cond    = document.getElementById("shafaCondition");
  const season  = document.getElementById("shafaSeason");
  const sleeve  = document.getElementById("shafaSleeveLength");
  const ukraine = document.getElementById("shafaMadeInUkraine");

  preset?.addEventListener("change", () => {
    const idx = Number(preset.value);
    if (idx >= 0 && SHAFA_CATEGORY_PRESETS[idx]) {
      const path = SHAFA_CATEGORY_PRESETS[idx].path;
      if (cat1) cat1.value = path[0] || "";
      if (cat2) cat2.value = path[1] || "";
      if (cat3) cat3.value = path[2] || "";
      shafaExtras.categoryPath = [...path];
    }
  });

  [cat1, cat2, cat3].forEach((el, i) => {
    el?.addEventListener("input", () => { shafaExtras.categoryPath[i] = el.value; });
  });

  brand?.addEventListener("input",   () => { shafaExtras.brand         = brand.value; });
  cond?.addEventListener("change",   () => { shafaExtras.condition     = cond.value; });
  season?.addEventListener("change", () => { shafaExtras.season        = season.value; });
  sleeve?.addEventListener("change", () => { shafaExtras.sleeveLength  = sleeve.value; });
  ukraine?.addEventListener("change",() => { shafaExtras.madeInUkraine = ukraine.value; });
}

// ── State ────────────────────────────────────────────────
let currentProduct    = null;
let currentImages     = [];
let platformPosts     = [];
let activePlatform    = "telegram";
let selectedPhotoFiles = [];
let selectedVideoFile  = null;

function setInputFiles(input, files) {
  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  input.files = dt.files;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function selectedPlatforms() {
  return [...form.querySelectorAll('input[name="selectedPlatforms"]:checked')].map(i => i.value);
}

function getFormPayload() {
  const data = Object.fromEntries(new FormData(form).entries());
  return {
    title: data.title || "",
    model: data.model || "",
    price: data.price || "",
    dropPrice: data.dropPrice || "",
    sizes: data.sizes || "",
    sizeSystem: data.sizeSystem || "Міжнародний",
    colors: data.colors || "",
    fabric: data.fabric || "",
    description: data.description || "",
  };
}

function currentPost() {
  return platformPosts.find(p => p.platform === activePlatform);
}

function syncCurrentTextarea() {
  const textarea = platformEditor.querySelector(".post-textarea");
  const post = currentPost();
  if (textarea && post) post.text = textarea.value;
}

// ── 1. DRAG-AND-DROP PHOTO REORDER ───────────────────────
let dragSrcIndex = null;

function renderLocalGallery() {
  photoGallery.innerHTML = selectedPhotoFiles.map((file, index) => {
    const url = URL.createObjectURL(file);
    return `
      <figure class="thumb" draggable="true" data-index="${index}" title="Перетягни для зміни порядку">
        <button type="button" class="remove-media remove-photo" data-index="${index}" title="Видалити">×</button>
        <img src="${url}" alt="Фото ${index + 1}">
        ${index === 0 ? "<figcaption>Головне</figcaption>" : ""}
      </figure>
    `;
  }).join("");

  if (selectedPhotoFiles.length || selectedVideoFile) {
    photoGallery.insertAdjacentHTML("beforeend",
      `<button type="button" class="clear-media-btn" id="clearAllMediaBtn">Очистити все</button>`
    );
  }

  // Attach drag events to each thumb
  photoGallery.querySelectorAll(".thumb[draggable]").forEach(thumb => {
    thumb.addEventListener("dragstart", onThumbDragStart);
    thumb.addEventListener("dragover",  onThumbDragOver);
    thumb.addEventListener("dragleave", onThumbDragLeave);
    thumb.addEventListener("drop",      onThumbDrop);
    thumb.addEventListener("dragend",   onThumbDragEnd);
  });
}

function onThumbDragStart(e) {
  dragSrcIndex = Number(this.dataset.index);
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function onThumbDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  photoGallery.querySelectorAll(".thumb").forEach(t => t.classList.remove("drag-over"));
  this.classList.add("drag-over");
}

function onThumbDragLeave() {
  this.classList.remove("drag-over");
}

function onThumbDrop(e) {
  e.stopPropagation();
  const targetIndex = Number(this.dataset.index);
  if (dragSrcIndex !== null && dragSrcIndex !== targetIndex) {
    const [moved] = selectedPhotoFiles.splice(dragSrcIndex, 1);
    selectedPhotoFiles.splice(targetIndex, 0, moved);
    setInputFiles(photosInput, selectedPhotoFiles);
    renderLocalGallery();
    showToast("Порядок фото змінено", "success", 2000);
  }
}

function onThumbDragEnd() {
  photoGallery.querySelectorAll(".thumb").forEach(t => {
    t.classList.remove("dragging", "drag-over");
  });
  dragSrcIndex = null;
}

function renderLocalVideo() {
  if (!selectedVideoFile) { videoPreview.innerHTML = ""; return; }
  const url = URL.createObjectURL(selectedVideoFile);
  videoPreview.innerHTML = `
    <figure class="thumb video-thumb">
      <button type="button" class="remove-media remove-video">×</button>
      <video src="${url}" controls muted></video>
      <figcaption>Відео</figcaption>
    </figure>
  `;
}

function renderSavedGallery() {
  const videoUrl          = currentProduct?.videoUrl || "";
  const processedVideoUrl = currentProduct?.processedVideoUrl || "";
  const useProcessedVideo = currentProduct?.useProcessedVideo !== false;
  const hasAnyVideo       = videoUrl || processedVideoUrl;

  if (!currentImages.length && !hasAnyVideo) return "";

  return `
    <div class="preview-gallery">
      ${processedVideoUrl ? `
        <div class="reel-preview-wrap">
          <figure class="reel-preview">
            <video src="${processedVideoUrl}" controls muted playsinline></video>
            <figcaption>Reels</figcaption>
          </figure>
          <label class="check video-choice-check">
            <input type="checkbox" id="useProcessedVideo" ${useProcessedVideo ? "checked" : ""}>
            <span>Використовувати оформлене відео</span>
          </label>
        </div>
      ` : videoUrl ? `
        <figure class="thumb video-thumb">
          <video src="${videoUrl}" controls muted playsinline></video>
          <figcaption>Оригінал</figcaption>
        </figure>
      ` : ""}

      ${currentImages.map((image, index) => `
        <figure class="thumb">
          <img src="${image.imageUrl}" alt="Фото ${index + 1}">
          ${index === 0 ? "<figcaption>Головне</figcaption>" : ""}
        </figure>
      `).join("")}
    </div>
  `;
}

function renderTabs() {
  tabs.innerHTML = platformPosts.map(post => `
    <button
      type="button"
      class="tab ${post.platform === activePlatform ? "active" : ""}"
      data-platform="${post.platform}"
    >
      ${platformNames[post.platform] || post.platform}
      <span>${post.status}</span>
    </button>
  `).join("");
}

function renderPlatformEditor() {
  const post = currentPost();
  if (!post) { platformEditor.innerHTML = ""; return; }

  productIdBadge.textContent = currentProduct ? `#${currentProduct.id}` : "";
  platformEditor.innerHTML = `
    ${renderSavedGallery()}
    <div class="platform-status">
      <span class="status-pill ${post.status}">${post.status}</span>
      ${post.errorMessage ? `<strong style="color:var(--red);font-size:13px">${escapeHtml(post.errorMessage)}</strong>` : ""}
    </div>

    <label>
      Текст для ${platformNames[post.platform] || post.platform}
      <textarea class="post-textarea" rows="14">${escapeHtml(post.text)}</textarea>
    </label>

    <div class="preview-text ${post.platform === "telegram" ? "telegram-preview" : ""}">
      ${post.platform === "telegram"
        ? post.text.replace(/\n/g, "<br>")
        : escapeHtml(post.text).replace(/\n/g, "<br>")}
    </div>

    ${post.platform === "shafa" ? renderShafaExtras() : ""}

    <div class="schedule-row">
      <label>
        Дата і час
        <input type="datetime-local" class="schedule-at" value="${post.scheduledAt ? post.scheduledAt.slice(0, 16) : ""}">
      </label>
    </div>

    <div class="actions">
      <button type="button" class="btn secondary regenerate-platform">Перегенерувати</button>
      <button type="button" class="btn success publish-platform">Опублікувати зараз</button>
      <button type="button" class="btn primary schedule-platform">Запланувати</button>
    </div>
  `;

  if (post.platform === "shafa") syncShafaExtras();
}

function renderPreview() {
  previewPanel.classList.remove("hidden");
  renderTabs();
  renderPlatformEditor();
}

// ── API calls ────────────────────────────────────────────
async function savePost(post, status, scheduledAt = null) {
  const response = await fetch(`/api/platform-posts/${post.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ text: post.text, status, scheduledAt }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || "Не вдалося зберегти пост");
  Object.assign(post, data.platformPost);
}

async function createPreview() {
  const hasPhotos = photosInput.files?.length;
  const hasVideo  = videoInput?.files?.length;

  if (!hasPhotos && !hasVideo) throw new Error("Завантаж хоча б одне фото або відео товару");

  const platforms = selectedPlatforms();
  if (!platforms.length) throw new Error("Вибери хоча б одну платформу");

  const formData = new FormData(form);
  formData.delete("selectedPlatforms");
  formData.append("selectedPlatforms", JSON.stringify(platforms));

  setLoading(true, "Генеруємо прев'ю...");

  const response = await fetch("/api/posts/preview", { method: "POST", body: formData, headers: authHeaders() });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || "Не вдалося згенерувати прев'ю");

  currentProduct = data.product;
  currentImages  = data.images || [];
  platformPosts  = data.platformPosts || [];
  activePlatform = platformPosts[0]?.platform || "telegram";
  renderPreview();

  if (data.videoProcessing) {
    showMessage("Прев'ю готове · ⏳ Відео обробляється у фоні...");
    pollVideoProcessing(data.productId);
  } else {
    showMessage("Прев'ю готове");
  }
}

function pollVideoProcessing(productId) {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    try {
      const r = await fetch(`/api/products/${productId}`, { headers: authHeaders() });
      if (!r.ok) return;
      const d = await r.json();
      const product = d.product || d;
      if (product.processedVideoUrl) {
        clearInterval(interval);
        currentProduct = { ...currentProduct, ...product };
        renderPreview();
        showMessage("✅ Відео готове!");
      } else if (attempts >= 30) { // 5 min max
        clearInterval(interval);
      }
    } catch { clearInterval(interval); }
  }, 10_000); // poll every 10s
}

async function regeneratePlatform(platform = activePlatform) {
  syncCurrentTextarea();
  setLoading(true, "Перегенеровуємо текст...");

  const response = await fetch(`/api/posts/${currentProduct.id}/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ ...getFormPayload(), platform }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || "Не вдалося перегенерувати текст");

  currentProduct = data.product;
  currentImages  = data.images || currentImages;
  platformPosts  = data.platformPosts || platformPosts;
  activePlatform = platform;
  renderPreview();
  showMessage("Текст оновлено");
}

async function publishPost(post) {
  syncCurrentTextarea();
  await savePost(post, post.status === "scheduled" ? "draft" : post.status);

  const platformLabel = platformNames[post.platform] || post.platform;
  const isShafa = post.platform === "shafa";
  setLoading(true, isShafa
    ? `Shafa.ua — заповнює форму (~2 хв), не закривайте вкладку...`
    : `Публікуємо ${platformLabel}...`
  );

  // Shafa takes up to 3 min — use AbortController with 4-minute timeout
  const controller = new AbortController();
  const timeoutId = isShafa ? setTimeout(() => controller.abort(), 4 * 60 * 1000) : null;

  let response;
  try {
    response = await fetch(`/api/platform-posts/${post.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        text: post.text,
        ...(isShafa ? { extras: shafaExtras } : {}),
      }),
      signal: controller.signal,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || "Не вдалося опублікувати пост");

  Object.assign(post, data.platformPost);
  renderPreview();
  showMessage(`${platformLabel}: опубліковано ✓`);
}

async function schedulePost(post) {
  syncCurrentTextarea();
  const input = platformEditor.querySelector(".schedule-at");
  if (!input.value) throw new Error("Вкажи дату і час публікації");

  await savePost(post, "scheduled", new Date(input.value).toISOString());
  renderPreview();
  showMessage(`${platformNames[post.platform] || post.platform}: заплановано`);
}

// ── Event listeners ───────────────────────────────────────
photosInput.addEventListener("change", () => {
  selectedPhotoFiles = [...selectedPhotoFiles, ...(photosInput.files || [])].slice(0, 6);
  setInputFiles(photosInput, selectedPhotoFiles);
  renderLocalGallery();
});

videoInput?.addEventListener("change", () => {
  selectedVideoFile = videoInput.files?.[0] || null;
  if (selectedVideoFile) setInputFiles(videoInput, [selectedVideoFile]);
  renderLocalVideo();
  syncVideoSettingsVisibility();
});

photoGallery.addEventListener("click", e => {
  const removeBtn  = e.target.closest(".remove-photo");
  const clearAllBtn = e.target.closest("#clearAllMediaBtn");

  if (removeBtn) {
    selectedPhotoFiles.splice(Number(removeBtn.dataset.index), 1);
    setInputFiles(photosInput, selectedPhotoFiles);
    renderLocalGallery();
  }

  if (clearAllBtn) {
    selectedPhotoFiles = [];
    selectedVideoFile  = null;
    setInputFiles(photosInput, []);
    setInputFiles(videoInput, []);
    renderLocalGallery();
    renderLocalVideo();
    syncVideoSettingsVisibility();
  }
});

videoPreview.addEventListener("click", e => {
  if (!e.target.closest(".remove-video")) return;
  selectedVideoFile = null;
  setInputFiles(videoInput, []);
  renderLocalVideo();
  syncVideoSettingsVisibility();
});

// Drag-drop upload from desktop
uploadBox.addEventListener("dragover", e => { e.preventDefault(); uploadBox.classList.add("dragover"); });
uploadBox.addEventListener("dragleave", ()  => uploadBox.classList.remove("dragover"));
uploadBox.addEventListener("drop", e => {
  e.preventDefault();
  uploadBox.classList.remove("dragover");
  if (e.dataTransfer.files?.length) {
    photosInput.files = e.dataTransfer.files;
    renderLocalGallery();
  }
});

tabs.addEventListener("click", e => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  syncCurrentTextarea();
  activePlatform = btn.dataset.platform;
  renderPreview();
});

platformEditor.addEventListener("input", e => {
  if (!e.target.classList.contains("post-textarea")) return;
  syncCurrentTextarea();
  const previewText = platformEditor.querySelector(".preview-text");
  const post = currentPost();
  if (previewText && post) {
    previewText.innerHTML = post.platform === "telegram"
      ? post.text.replace(/\n/g, "<br>")
      : escapeHtml(post.text).replace(/\n/g, "<br>");
  }
});

platformEditor.addEventListener("click", async e => {
  const post = currentPost();
  if (!post) return;
  try {
    if (e.target.closest(".regenerate-platform"))  await regeneratePlatform(post.platform);
    if (e.target.closest(".publish-platform"))     await publishPost(post);
    if (e.target.closest(".schedule-platform"))    await schedulePost(post);
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    setLoading(false, statusMessage?.textContent || "");
  }
});

platformEditor.addEventListener("change", async e => {
  const checkbox = e.target.closest("#useProcessedVideo");
  if (!checkbox || !currentProduct) return;
  currentProduct.useProcessedVideo = checkbox.checked;
  await fetch(`/api/products/${currentProduct.id}/video-choice`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ useProcessedVideo: checkbox.checked }),
  });
});

previewBtn.addEventListener("click", async () => {
  try { await createPreview(); }
  catch (err) { showMessage(err.message, "error"); }
  finally { setLoading(false); }
});

publishSelectedBtn.addEventListener("click", async () => {
  try {
    if (!currentProduct) await createPreview();
    for (const platform of selectedPlatforms()) {
      const post = platformPosts.find(p => p.platform === platform);
      if (post) await publishPost(post);
    }
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    setLoading(false);
  }
});

scheduleSelectedBtn.addEventListener("click", async () => {
  try {
    const post = currentPost();
    if (!post) throw new Error("Спочатку створи попередній перегляд");
    await schedulePost(post);
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    setLoading(false);
  }
});

newProductBtn.addEventListener("click", () => {
  form.reset();
  selectedPhotoFiles = [];
  selectedVideoFile  = null;
  photoGallery.innerHTML   = "";
  videoPreview.innerHTML   = "";
  syncVideoSettingsVisibility();
  currentProduct = null;
  currentImages  = [];
  platformPosts  = [];
  activePlatform = "telegram";
  tabs.innerHTML          = "";
  platformEditor.innerHTML = "";
  productIdBadge.textContent = "";
  previewPanel.classList.add("hidden");
  loadLastSettings();
  showToast("Форму очищено", "success", 2000);
});

// ── Init ─────────────────────────────────────────────────
initVideoStyles();
initPresets();
