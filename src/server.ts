import express, { Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { generatePost } from "./ai-generator";
import { sendTelegramPost, editTelegramPost } from "./telegram";
import { initDb } from "./db/sqlite";

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "../public")));
app.use("/uploads", express.static(uploadsDir));

type ProductInput = {
  title: string;
  price: string;
  dropPrice: string;
  sizes: string;
  colors: string;
  fabric: string;
  model: string;
};

async function startServer() {
  const db = await initDb();

  app.post("/preview-post",
    upload.single("photo"),
    async (req: Request, res: Response) => {
      try {
        const file = req.file;

        if (!file) {
          return res.status(400).json({
            success: false,
            message: "Фото не завантажено",
          });
        }

        const product: ProductInput = {
          title: req.body.title || "",
          price: req.body.price || "",
          dropPrice: req.body.dropPrice || "",
          sizes: req.body.sizes || "",
          colors: req.body.colors || "",
          fabric: req.body.fabric || "",
          model: req.body.model || "",
        };

        const generatedText = await generatePost(product);

        const imageUrl = `/uploads/${file.filename}`;
        const photoPath = file.path;

        const result = await db.run(
          `
          INSERT INTO products (
            createdAt,
            title,
            price,
            dropPrice,
            sizes,
            colors,
            fabric,
            model,
            imageUrl,
            photoPath,
            generatedPost,
            telegramPublished,
            telegramChatId,
            telegramMessageId
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            new Date().toISOString(),
            product.title,
            product.price,
            product.dropPrice,
            product.sizes,
            product.colors,
            product.fabric,
            product.model,
            imageUrl,
            photoPath,
            generatedText,
            0,
            null,
            null,
          ]
        );

        return res.json({
          success: true,
          productId: result.lastID,
          generatedText,
          imageUrl,
          photoPath,
          product,
        });
      } catch (error) {
        console.error("Preview error:", error);

        return res.status(500).json({
          success: false,
          message: "Помилка генерації попереднього перегляду",
        });
      }
    }
  );

  app.post("/publish-preview", async (req: Request, res: Response) => {
    try {
      const { text, photoPath, productId } = req.body as {
        text?: string;
        photoPath?: string;
        productId?: number;
      };

      if (!text || !photoPath) {
        return res.status(400).json({
          success: false,
          message: "Немає тексту або фото для публікації",
        });
      }

      if (!fs.existsSync(photoPath)) {
        return res.status(400).json({
          success: false,
          message: "Фото не знайдено на сервері",
        });
      }

const telegramResult = await sendTelegramPost(text, photoPath);

if (productId) {
    await db.run(
    `
    UPDATE products
    SET 
        generatedPost = ?,
        telegramPublished = 1,
        telegramChatId = ?,
        telegramMessageId = ?
    WHERE id = ?
    `,
    [
        text,
        telegramResult.chatId,
        String(telegramResult.messageId),
        productId,
    ]
    );
}

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error("Publish preview error:", error);

      return res.status(500).json({
        success: false,
        message: "Помилка публікації в Telegram",
      });
    }
  });

  app.get("/products-api", async (_req: Request, res: Response) => {
  const products = await db.all(`
    SELECT *
    FROM products
    ORDER BY id DESC
  `);

  return res.json({
    success: true,
    products,
  });
});

app.get("/products", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../public/products.html"));
});

app.put("/products-api/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const {
      title,
      price,
      dropPrice,
      sizes,
      colors,
      fabric,
      model,
      generatedPost,
    } = req.body;

    const product = await db.get(
      `SELECT * FROM products WHERE id = ?`,
      [id]
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Товар не знайдено",
      });
    }

    await db.run(
      `
      UPDATE products
      SET
        title = ?,
        price = ?,
        dropPrice = ?,
        sizes = ?,
        colors = ?,
        fabric = ?,
        model = ?,
        generatedPost = ?
      WHERE id = ?
      `,
      [
        title,
        price,
        dropPrice,
        sizes,
        colors,
        fabric,
        model,
        generatedPost,
        id,
      ]
    );

    if (!product.telegramChatId || !product.telegramMessageId) {
      return res.status(400).json({
        success: false,
        message:
          "Збережено в базу, але Telegram не оновлено: у товару немає telegramMessageId. Спочатку опублікуй товар через кнопку публікації.",
      });
    }

    await editTelegramPost(
      generatedPost,
      product.telegramChatId,
      product.telegramMessageId
    );

    return res.json({
      success: true,
      message: "Збережено в базу і існуючий Telegram-пост оновлено ✅",
    });
  } catch (error) {
    console.error("Update product error:", error);

    return res.status(500).json({
      success: false,
      message: "Помилка оновлення товару або Telegram-поста",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});
}



startServer();