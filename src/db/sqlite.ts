import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function initDb() {
  const db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      createdAt TEXT NOT NULL,

      title TEXT,
      price TEXT,
      dropPrice TEXT,
      sizes TEXT,
      colors TEXT,
      fabric TEXT,
      model TEXT,

      imageUrl TEXT,
      photoPath TEXT,

      generatedPost TEXT,

      telegramPublished INTEGER DEFAULT 0,
      telegramChatId TEXT,
      telegramMessageId TEXT
    )
  `);

  return db;
}