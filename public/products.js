const productsList = document.getElementById("productsList");
const productsSearch = document.getElementById("productsSearch");
const platformFilter = document.getElementById("platformFilter");
const statusFilter = document.getElementById("statusFilter");

const platformNames = {
  telegram: "Telegram",
  instagram: "Instagram",
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getFilters() {
  const params = new URLSearchParams();

  if (productsSearch.value.trim()) {
    params.set("query", productsSearch.value.trim());
  }

  if (platformFilter.value) {
    params.set("platform", platformFilter.value);
  }

  if (statusFilter.value) {
    params.set("status", statusFilter.value);
  }

  return params;
}

async function loadProducts() {
  productsList.textContent = "Завантаження...";
  const response = await fetch(`/api/products?${getFilters().toString()}`);
  const data = await response.json();

  if (!data.success) {
    productsList.innerHTML = "<p>Не вдалося завантажити товари</p>";
    return;
  }

  renderProducts(data.products);
}

function renderPlatformPosts(posts) {
  return posts
    .map(
      (post) => `
        <details class="platform-post" data-post-id="${post.id}" open>
          <summary>
            <span>${platformNames[post.platform] || post.platform}</span>
            <span class="status-pill ${post.status}">${post.status}</span>
          </summary>

          ${post.errorMessage ? `<p class="error-text">${escapeHtml(post.errorMessage)}</p>` : ""}

          <label>
            Текст
            <textarea class="edit-post-text" rows="8">${escapeHtml(post.text)}</textarea>
          </label>

          <label>
            Запланувати на
            <input class="edit-scheduled-at" type="datetime-local" value="${post.scheduledAt ? post.scheduledAt.slice(0, 16) : ""}">
          </label>

          <div class="actions">
            <button class="btn secondary save-post">Зберегти</button>
            <button class="btn success publish-post">Опублікувати</button>
            <button class="btn primary schedule-post">Запланувати</button>
          </div>
        </details>
      `
    )
    .join("");
}

function renderProducts(products) {
  if (!products.length) {
    productsList.innerHTML = "<p>Товарів не знайдено</p>";
    return;
  }

  productsList.innerHTML = products
    .map((product) => {
      const firstImage = product.images?.[0]?.imageUrl || product.imageUrl || "";

      return `
        <article class="card product-card" data-id="${product.id}">
          <div>
            ${firstImage ? `<img src="${firstImage}" class="product-img" alt="${escapeHtml(product.title)}">` : ""}
            <div class="image-strip">
              ${(product.images || [])
                .slice(1, 5)
                .map((image) => `<img src="${image.imageUrl}" alt="">`)
                .join("")}
            </div>
          </div>

          <div class="product-body">
            <div class="product-top">
              <div>
                <h2>${escapeHtml(product.title || "Без назви")}</h2>
                <p>Артикул: ${escapeHtml(product.model || "не вказано")}</p>
              </div>
              <span class="small-badge">#${product.id}</span>
            </div>

            <div class="grid">
              <label>
                Назва
                <input class="edit-title" value="${escapeHtml(product.title)}">
              </label>
              <label>
                Модель / артикул
                <input class="edit-model" value="${escapeHtml(product.model)}">
              </label>
              <label>
                Ціна
                <input class="edit-price" value="${escapeHtml(product.price)}">
              </label>
              <label>
                Дроп ціна
                <input class="edit-dropPrice" value="${escapeHtml(product.dropPrice)}">
              </label>
              <label>
                Розміри
                <input class="edit-sizes" value="${escapeHtml(product.sizes)}">
              </label>
              <label>
                Кольори
                <input class="edit-colors" value="${escapeHtml(product.colors)}">
              </label>
            </div>

            <label>
              Тканина / матеріал
              <input class="edit-fabric" value="${escapeHtml(product.fabric)}">
            </label>

            <label>
              Додатковий опис
              <textarea class="edit-description" rows="3">${escapeHtml(product.description)}</textarea>
            </label>

            <div class="actions">
              <button class="btn secondary save-product">Зберегти товар</button>
            </div>

            <div class="platform-stack">
              ${renderPlatformPosts(product.platformPosts || [])}
            </div>

            <p class="product-message"></p>
          </div>
        </article>
      `;
    })
    .join("");
}

function productPayload(card) {
  return {
    title: card.querySelector(".edit-title").value,
    model: card.querySelector(".edit-model").value,
    price: card.querySelector(".edit-price").value,
    dropPrice: card.querySelector(".edit-dropPrice").value,
    sizes: card.querySelector(".edit-sizes").value,
    colors: card.querySelector(".edit-colors").value,
    fabric: card.querySelector(".edit-fabric").value,
    description: card.querySelector(".edit-description").value,
  };
}

async function updatePlatformPost(details, status) {
  const text = details.querySelector(".edit-post-text").value;
  const scheduledInput = details.querySelector(".edit-scheduled-at");
  const scheduledAt = scheduledInput.value
    ? new Date(scheduledInput.value).toISOString()
    : null;
  const response = await fetch(`/api/platform-posts/${details.dataset.postId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, status, scheduledAt }),
  });
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Не вдалося оновити пост");
  }
}

let searchTimer = null;

[platformFilter, statusFilter].forEach((control) =>
  control.addEventListener("change", loadProducts)
);

productsSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadProducts, 250);
});

productsList.addEventListener("click", async (event) => {
  const card = event.target.closest(".product-card");

  if (!card) return;

  const message = card.querySelector(".product-message");
  const button = event.target.closest("button");

  if (!button) return;

  button.disabled = true;
  message.textContent = "Зберігаємо...";
  message.className = "product-message";

  try {
    if (button.classList.contains("save-product")) {
      const response = await fetch(`/api/products/${card.dataset.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(productPayload(card)),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Не вдалося зберегти товар");
      }

      message.textContent = "Товар збережено";
    }

    const details = event.target.closest(".platform-post");

    if (button.classList.contains("save-post")) {
      await updatePlatformPost(details, "draft");
      message.textContent = "Пост збережено";
    }

    if (button.classList.contains("schedule-post")) {
      await updatePlatformPost(details, "scheduled");
      message.textContent = "Пост заплановано";
    }

    if (button.classList.contains("publish-post")) {
      const text = details.querySelector(".edit-post-text").value;
      const response = await fetch(`/api/platform-posts/${details.dataset.postId}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Не вдалося опублікувати пост");
      }

      message.textContent = "Пост опубліковано";
    }

    setTimeout(loadProducts, 700);
  } catch (error) {
    message.textContent = error.message;
    message.className = "product-message error-text";
  } finally {
    button.disabled = false;
  }
});

loadProducts();
