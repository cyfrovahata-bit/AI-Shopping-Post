const form = document.getElementById("productForm");
const photosInput = document.getElementById("photos");
const videoInput = document.getElementById("video");
const uploadBox = document.getElementById("uploadBox");
const photoGallery = document.getElementById("photoGallery");
const videoPreview = document.getElementById("videoPreview");
const previewBtn = document.getElementById("previewBtn");
const publishSelectedBtn = document.getElementById("publishSelectedBtn");
const scheduleSelectedBtn = document.getElementById("scheduleSelectedBtn");
const newProductBtn = document.getElementById("newProductBtn");
const previewPanel = document.getElementById("previewPanel");
const tabs = document.getElementById("tabs");
const platformEditor = document.getElementById("platformEditor");
const statusMessage = document.getElementById("statusMessage");
const productIdBadge = document.getElementById("productIdBadge");

function initVideoStyles() {
  const radios = document.querySelectorAll(
    'input[name="videoStyle"]'
  );

  radios.forEach((radio) => {
    radio.addEventListener("change", () => {
      document
        .querySelectorAll(".video-style-card")
        .forEach((card) => card.classList.remove("active"));

      radio.closest(".video-style-card")?.classList.add("active");
    });
  });

  const generateVideoInput = form.querySelector('input[name="generateVideo"]');

  generateVideoInput?.addEventListener("change", syncVideoSettingsVisibility);

  syncVideoSettingsVisibility();
}

function syncVideoSettingsVisibility() {
  const videoSettings = document.getElementById("videoSettings");
  const videoStyleSelect = document.getElementById("videoStyleSelect");
  const generateVideoInput = form.querySelector('input[name="generateVideo"]');
  const hasVideo = !!videoInput?.files?.length;

  if (!videoSettings) return;

  videoSettings.classList.toggle("hidden", !hasVideo);

  if (videoStyleSelect && generateVideoInput) {
    videoStyleSelect.classList.toggle("hidden", !generateVideoInput.checked);
  }
}

const platformNames = {
  telegram: "Telegram",
  instagram: "Instagram",
  facebook: "Facebook",
};

let currentProduct = null;
let currentImages = [];
let platformPosts = [];
let activePlatform = "telegram";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setLoading(isLoading, text = "") {
  [previewBtn, publishSelectedBtn, scheduleSelectedBtn].forEach((button) => {
    button.disabled = isLoading;
  });

  if (isLoading) {
    statusMessage.textContent = text;
    statusMessage.className = "status loading";
  }
}

function showMessage(message, type = "success") {
  statusMessage.textContent = message;
  statusMessage.className = `status ${type}`;
}

function selectedPlatforms() {
  return [...form.querySelectorAll('input[name="selectedPlatforms"]:checked')].map(
    (input) => input.value
  );
}

function getFormPayload() {
  const data = Object.fromEntries(new FormData(form).entries());

  return {
    title: data.title || "",
    model: data.model || "",
    price: data.price || "",
    dropPrice: data.dropPrice || "",
    sizes: data.sizes || "",
    colors: data.colors || "",
    fabric: data.fabric || "",
    description: data.description || "",
  };
}

function currentPost() {
  return platformPosts.find((post) => post.platform === activePlatform);
}

function syncCurrentTextarea() {
  const textarea = platformEditor.querySelector(".post-textarea");
  const post = currentPost();

  if (textarea && post) {
    post.text = textarea.value;
  }
}

function renderLocalGallery() {
  const files = [...(photosInput.files || [])];

  photoGallery.innerHTML = files
    .map((file, index) => {
      const url = URL.createObjectURL(file);
      return `
        <figure class="thumb">
          <img src="${url}" alt="Фото ${index + 1}">
          ${index === 0 ? "<figcaption>Головне</figcaption>" : ""}
        </figure>
      `;
    })
    .join("");
}

function renderLocalVideo() {
  const file = videoInput?.files?.[0];

  if (!file) {
    videoPreview.innerHTML = "";
    return;
  }

  const url = URL.createObjectURL(file);

  videoPreview.innerHTML = `
    <figure class="thumb video-thumb">
      <video src="${url}" controls muted></video>
      <figcaption>Відео</figcaption>
    </figure>
  `;
}

function renderSavedGallery() {
  const videoUrl = currentProduct?.videoUrl || "";
  const processedVideoUrl = currentProduct?.processedVideoUrl || "";
  const useProcessedVideo = currentProduct?.useProcessedVideo !== false;
  const hasAnyVideo = videoUrl || processedVideoUrl;

  if (!currentImages.length && !hasAnyVideo) {
    return "";
  }

  return `
    <div class="preview-gallery">
      ${
        processedVideoUrl
          ? `
            <div class="reel-preview-wrap">
              <figure class="reel-preview">
                <video src="${processedVideoUrl}" controls muted playsinline></video>
                <figcaption>Reels</figcaption>
              </figure>

              <label class="check video-choice-check">
                <input
                  type="checkbox"
                  id="useProcessedVideo"
                  ${useProcessedVideo ? "checked" : ""}
                >
                <span>Використовувати оформлене відео</span>
              </label>
            </div>
          `
          : videoUrl
            ? `
              <figure class="thumb video-thumb">
                <video src="${videoUrl}" controls muted playsinline></video>
                <figcaption>Оригінал</figcaption>
              </figure>
            `
            : ""
      }

      ${currentImages
        .map(
          (image, index) => `
            <figure class="thumb">
              <img src="${image.imageUrl}" alt="Фото товару ${index + 1}">
              ${index === 0 ? "<figcaption>Головне</figcaption>" : ""}
            </figure>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTabs() {
  tabs.innerHTML = platformPosts
    .map(
      (post) => `
        <button
          type="button"
          class="tab ${post.platform === activePlatform ? "active" : ""}"
          data-platform="${post.platform}"
        >
          ${platformNames[post.platform] || post.platform}
          <span>${post.status}</span>
        </button>
      `
    )
    .join("");
}

function renderPlatformEditor() {
  const post = currentPost();

  if (!post) {
    platformEditor.innerHTML = "";
    return;
  }

  productIdBadge.textContent = currentProduct ? `#${currentProduct.id}` : "";
  platformEditor.innerHTML = `
    ${renderSavedGallery()}
    <div class="platform-status">
      <span class="status-pill ${post.status}">${post.status}</span>
      ${post.errorMessage ? `<strong>${escapeHtml(post.errorMessage)}</strong>` : ""}
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
}

function renderPreview() {
  previewPanel.classList.remove("hidden");
  renderTabs();
  renderPlatformEditor();
}

async function savePost(post, status, scheduledAt = null) {
  const response = await fetch(`/api/platform-posts/${post.id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: post.text,
      status,
      scheduledAt,
    }),
  });
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не вдалося зберегти пост");
  }

  Object.assign(post, data.platformPost);
}

async function createPreview() {
  const hasPhotos = photosInput.files && photosInput.files.length;
  const hasVideo = videoInput?.files && videoInput.files.length;

  if (!hasPhotos && !hasVideo) {
    throw new Error("Завантаж хоча б одне фото або відео товару");
  }

  const platforms = selectedPlatforms();

  if (!platforms.length) {
    throw new Error("Вибери хоча б одну платформу");
  }

  const formData = new FormData(form);
  formData.delete("selectedPlatforms");
  formData.append("selectedPlatforms", JSON.stringify(platforms));

  setLoading(true, "Генеруємо прев’ю...");

  const response = await fetch("/api/posts/preview", {
    method: "POST",
    body: formData,
  });
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не вдалося згенерувати прев’ю");
  }

  currentProduct = data.product;
  currentImages = data.images || [];
  platformPosts = data.platformPosts || [];
  activePlatform = platformPosts[0]?.platform || "telegram";
  renderPreview();
  showMessage("Прев’ю готове");
}

async function regeneratePlatform(platform = activePlatform) {
  syncCurrentTextarea();
  setLoading(true, "Перегенеровуємо текст...");

  const response = await fetch(`/api/posts/${currentProduct.id}/regenerate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...getFormPayload(),
      platform,
    }),
  });
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не вдалося перегенерувати текст");
  }

  currentProduct = data.product;
  currentImages = data.images || currentImages;
  platformPosts = data.platformPosts || platformPosts;
  activePlatform = platform;
  renderPreview();
  showMessage("Текст оновлено");
}

async function publishPost(post) {
  syncCurrentTextarea();
  await savePost(post, post.status === "scheduled" ? "draft" : post.status);
  setLoading(true, `Публікуємо ${platformNames[post.platform] || post.platform}...`);

  const response = await fetch(`/api/platform-posts/${post.id}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: post.text }),
  });
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не вдалося опублікувати пост");
  }

  Object.assign(post, data.platformPost);
  renderPreview();
  showMessage(`${platformNames[post.platform] || post.platform}: опубліковано`);
}

async function schedulePost(post) {
  syncCurrentTextarea();
  const input = platformEditor.querySelector(".schedule-at");

  if (!input.value) {
    throw new Error("Вкажи дату і час публікації");
  }

  await savePost(post, "scheduled", new Date(input.value).toISOString());
  renderPreview();
  showMessage(`${platformNames[post.platform] || post.platform}: заплановано`);
}

photosInput.addEventListener("change", renderLocalGallery);
videoInput?.addEventListener("change", () => {
  renderLocalVideo();
  syncVideoSettingsVisibility();
});

uploadBox.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadBox.classList.add("dragover");
});

uploadBox.addEventListener("dragleave", () => {
  uploadBox.classList.remove("dragover");
});

uploadBox.addEventListener("drop", (event) => {
  event.preventDefault();
  uploadBox.classList.remove("dragover");

  if (event.dataTransfer.files?.length) {
    photosInput.files = event.dataTransfer.files;
    renderLocalGallery();
  }
});

tabs.addEventListener("click", (event) => {
  const button = event.target.closest(".tab");

  if (!button) return;

  syncCurrentTextarea();
  activePlatform = button.dataset.platform;
  renderPreview();
});

platformEditor.addEventListener("input", (event) => {
  if (!event.target.classList.contains("post-textarea")) {
    return;
  }

  syncCurrentTextarea();
  const previewText = platformEditor.querySelector(".preview-text");
  const post = currentPost();

  if (previewText && post) {
    previewText.innerHTML =
      post.platform === "telegram"
        ? post.text.replace(/\n/g, "<br>")
        : escapeHtml(post.text).replace(/\n/g, "<br>");
  }
});

platformEditor.addEventListener("click", async (event) => {
  const post = currentPost();

  if (!post) return;

  try {
    if (event.target.closest(".regenerate-platform")) {
      await regeneratePlatform(post.platform);
    }

    if (event.target.closest(".publish-platform")) {
      await publishPost(post);
    }

    if (event.target.closest(".schedule-platform")) {
      await schedulePost(post);
    }
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    setLoading(false, statusMessage.textContent);
  }
});

platformEditor.addEventListener("change", async (event) => {
  const checkbox = event.target.closest("#useProcessedVideo");

  if (!checkbox || !currentProduct) {
    return;
  }

  currentProduct.useProcessedVideo = checkbox.checked;

  await fetch(`/api/products/${currentProduct.id}/video-choice`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      useProcessedVideo: checkbox.checked,
    }),
  });
});

previewBtn.addEventListener("click", async () => {
  try {
    await createPreview();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    setLoading(false, statusMessage.textContent);
  }
});

publishSelectedBtn.addEventListener("click", async () => {
  try {
    if (!currentProduct) {
      await createPreview();
    }

    const platforms = selectedPlatforms();
    for (const platform of platforms) {
      const post = platformPosts.find((item) => item.platform === platform);
      if (post) {
        await publishPost(post);
      }
    }
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    setLoading(false, statusMessage.textContent);
  }
});

scheduleSelectedBtn.addEventListener("click", async () => {
  try {
    const post = currentPost();

    if (!post) {
      throw new Error("Спочатку створи попередній перегляд");
    }

    await schedulePost(post);
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    setLoading(false, statusMessage.textContent);
  }
});

newProductBtn.addEventListener("click", () => {
  form.reset();
  photoGallery.innerHTML = "";
  videoPreview.innerHTML = "";
  syncVideoSettingsVisibility();
  currentProduct = null;
  currentImages = [];
  platformPosts = [];
  activePlatform = "telegram";
  tabs.innerHTML = "";
  platformEditor.innerHTML = "";
  productIdBadge.textContent = "";
  previewPanel.classList.add("hidden");
  showMessage("", "");
});

initVideoStyles();
