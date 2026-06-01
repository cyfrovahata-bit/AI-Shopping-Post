const form = document.getElementById("productForm");
const photoInput = document.getElementById("photo");
const photoPreview = document.getElementById("photoPreview");
const uploadBox = document.getElementById("uploadBox");

const previewBtn = document.getElementById("previewBtn");
const publishNowBtn = document.getElementById("publishNowBtn");
const regenerateBtn = document.getElementById("regenerateBtn");
const publishPreviewBtn = document.getElementById("publishPreviewBtn");

const previewPanel = document.getElementById("previewPanel");
const telegramImage = document.getElementById("telegramImage");
const telegramText = document.getElementById("telegramText");
const postEditor = document.getElementById("postEditor");
const statusMessage = document.getElementById("statusMessage");

const newProductBtn = document.getElementById("newProductBtn");

let currentPhotoPath = "";
let currentImageUrl = "";
let currentProductId = null;

function setLoading(isLoading, text = "") {
  previewBtn.disabled = isLoading;
  publishNowBtn.disabled = isLoading;
  regenerateBtn.disabled = isLoading;
  publishPreviewBtn.disabled = isLoading;

  statusMessage.textContent = text;
  statusMessage.className = isLoading ? "status loading" : "status";
}

function showError(message) {
  statusMessage.textContent = message;
  statusMessage.className = "status error";
}

function showSuccess(message) {
  statusMessage.textContent = message;
  statusMessage.className = "status success";
}

function renderTelegramText(text) {
  telegramText.innerHTML = text.replace(/\n/g, "<br>");
}

function syncEditorToPreview() {
  renderTelegramText(postEditor.value);
}

function getFormData() {
  const formData = new FormData(form);

  if (!photoInput.files || !photoInput.files[0]) {
    throw new Error("Спочатку завантаж фото товару");
  }

  return formData;
}

async function generatePreview() {
  const formData = getFormData();

  setLoading(true, "Генеруємо попередній перегляд...");

  const response = await fetch("/preview-post", {
    method: "POST",
    body: formData,
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не вдалося згенерувати пост");
  }

  currentPhotoPath = data.photoPath;
  currentImageUrl = data.imageUrl;
  currentProductId = data.productId;

  telegramImage.src = currentImageUrl;
  postEditor.value = data.generatedText;
  renderTelegramText(data.generatedText);

  previewPanel.classList.remove("hidden");

  showSuccess("Попередній перегляд готовий ✅");
}

async function publishCurrentText() {
  const text = postEditor.value.trim();

  if (!text) {
    throw new Error("Текст поста порожній");
  }

  if (!currentPhotoPath) {
    throw new Error("Немає фото для публікації. Спочатку зроби попередній перегляд.");
  }

  setLoading(true, "Публікуємо в Telegram...");

  const response = await fetch("/publish-preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      photoPath: currentPhotoPath,
      productId: currentProductId,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не вдалося опублікувати пост");
  }

  showSuccess("Пост опубліковано в Telegram ✅");
}

photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];

  if (!file) return;

  const url = URL.createObjectURL(file);
  photoPreview.src = url;
  photoPreview.classList.remove("hidden");
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

  const file = event.dataTransfer.files?.[0];

  if (!file) return;

  photoInput.files = event.dataTransfer.files;

  const url = URL.createObjectURL(file);
  photoPreview.src = url;
  photoPreview.classList.remove("hidden");
});

previewBtn.addEventListener("click", async () => {
  try {
    await generatePreview();
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, statusMessage.textContent);
  }
});

regenerateBtn.addEventListener("click", async () => {
  try {
    await generatePreview();
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, statusMessage.textContent);
  }
});

publishPreviewBtn.addEventListener("click", async () => {
  try {
    await publishCurrentText();
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, statusMessage.textContent);
  }
});

publishNowBtn.addEventListener("click", async () => {
  try {
    await generatePreview();
    await publishCurrentText();
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, statusMessage.textContent);
  }
});

newProductBtn.addEventListener("click", () => {
  form.reset();

  currentPhotoPath = "";
  currentImageUrl = "";
  currentProductId = null;

  photoPreview.src = "";
  photoPreview.classList.add("hidden");

  telegramImage.src = "";
  telegramText.innerHTML = "";
  postEditor.value = "";

  previewPanel.classList.add("hidden");

  statusMessage.textContent = "";
  statusMessage.className = "status";

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
});

postEditor.addEventListener("input", syncEditorToPreview);