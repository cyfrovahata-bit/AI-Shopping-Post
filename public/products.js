const productsList = document.getElementById("productsList");
const productsSearch = document.getElementById("productsSearch");

let allProducts = [];

async function loadProducts() {
  const response = await fetch("/products-api");
  const data = await response.json();

  if (!data.success) {
    productsList.innerHTML = "<p>Не вдалося завантажити товари</p>";
    return;
  }

  allProducts = data.products;
  renderProducts(allProducts);
}

function renderProducts(products) {
  if (!products.length) {
    productsList.innerHTML = "<p>Товарів не знайдено</p>";
    return;
  }

  productsList.innerHTML = products
    .map((product) => {
      return `
        <div class="card product-card" data-id="${product.id}">
          <img src="${product.imageUrl}" class="product-img" />

          <div class="product-body">
            <div class="product-top">
              <h2>${product.title || "Без назви"}</h2>
              <span class="publish-status">
                ${
                  product.telegramPublished
                    ? "Опубліковано ✅"
                    : "Не опубліковано"
                }
              </span>
            </div>

            <div class="grid">
              <label>
                Назва
                <input class="edit-title" value="${product.title || ""}" />
              </label>

              <label>
                Модель / артикул
                <input class="edit-model" value="${product.model || ""}" />
              </label>

              <label>
                Ціна
                <input class="edit-price" value="${product.price || ""}" />
              </label>

              <label>
                Дроп ціна
                <input class="edit-dropPrice" value="${product.dropPrice || ""}" />
              </label>

              <label>
                Розміри
                <input class="edit-sizes" value="${product.sizes || ""}" />
              </label>

              <label>
                Кольори
                <input class="edit-colors" value="${product.colors || ""}" />
              </label>
            </div>

            <label>
              Тканина
              <input class="edit-fabric" value="${product.fabric || ""}" />
            </label>

            <label>
              Текст поста
              <textarea class="edit-generatedPost" rows="9">${product.generatedPost || ""}</textarea>
            </label>

            <button class="btn success save-btn">
              💾 Зберегти і оновити Telegram
            </button>

            <p class="product-message"></p>
          </div>
        </div>
      `;
    })
    .join("");
}

productsSearch.addEventListener("input", () => {
  const query = productsSearch.value.trim().toLowerCase();

  const filteredProducts = allProducts.filter((product) => {
    const title = String(product.title || "").toLowerCase();
    const model = String(product.model || "").toLowerCase();

    return title.includes(query) || model.includes(query);
  });

  renderProducts(filteredProducts);
});

productsList.addEventListener("click", async (event) => {
  const button = event.target.closest(".save-btn");

  if (!button) return;

  const card = button.closest(".product-card");
  const id = card.dataset.id;
  const message = card.querySelector(".product-message");

  const payload = {
    title: card.querySelector(".edit-title").value,
    model: card.querySelector(".edit-model").value,
    price: card.querySelector(".edit-price").value,
    dropPrice: card.querySelector(".edit-dropPrice").value,
    sizes: card.querySelector(".edit-sizes").value,
    colors: card.querySelector(".edit-colors").value,
    fabric: card.querySelector(".edit-fabric").value,
    generatedPost: card.querySelector(".edit-generatedPost").value,
  };

  button.disabled = true;
  message.textContent = "Оновлюємо...";

  try {
    const response = await fetch(`/products-api/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || "Помилка оновлення");
    }

    message.textContent = data.message || "Збережено і Telegram оновлено ✅";

    setTimeout(() => {
      loadProducts();
    }, 700);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

loadProducts();