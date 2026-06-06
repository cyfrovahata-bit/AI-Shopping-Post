import fs from "fs";
import FormData from "form-data";
import fetch from "node-fetch";

const defaultOrderUrl = "https://t.me/mariannavasulevska";

type TelegramApiResponse = {
  ok: boolean;
  description?: string;
  result?: {
    message_id?: number;
  };
};

function getReplyMarkup() {
  const orderUrl = process.env.ORDER_URL || defaultOrderUrl;

  if (!orderUrl) {
    return undefined;
  }

  return {
    inline_keyboard: [
      [
        {
          text: "🛒 Замовити",
          url: orderUrl,
        },
      ],
    ],
  };
}

function assertTelegramResponse(data: TelegramApiResponse) {
  if (!data.ok || !data.result?.message_id) {
    throw new Error(data.description || "Telegram не повернув message_id");
  }
}

export async function sendTelegramPost(text: string, photoPath?: string) {
  const botToken = process.env.BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const replyMarkup = getReplyMarkup();

  if (!botToken || !chatId) {
    throw new Error("Немає BOT_TOKEN або TELEGRAM_CHAT_ID в .env");
  }

  if (photoPath) {
    const form = new FormData();

    form.append("chat_id", chatId);
    form.append("photo", fs.createReadStream(photoPath));
    form.append("caption", text);
    form.append("parse_mode", "HTML");

    if (replyMarkup) {
      form.append("reply_markup", JSON.stringify(replyMarkup));
    }

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendPhoto`,
      {
        method: "POST",
        body: form as any,
      }
    );
    const data = (await response.json()) as TelegramApiResponse;

    assertTelegramResponse(data);

    return {
      chatId,
      messageId: data.result!.message_id!,
    };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      }),
    }
  );
  const data = (await response.json()) as TelegramApiResponse;

  assertTelegramResponse(data);

  return {
    chatId,
    messageId: data.result!.message_id!,
  };
}

export async function editTelegramPost(
  text: string,
  telegramChatId: string,
  telegramMessageId: string,
  mode: "caption" | "text" = "caption"
) {
  const botToken = process.env.BOT_TOKEN;
  const replyMarkup = getReplyMarkup();

  if (!botToken) {
    throw new Error("Немає BOT_TOKEN в .env");
  }

  const method = mode === "caption" ? "editMessageCaption" : "editMessageText";
  const payload =
    mode === "caption"
      ? {
          chat_id: telegramChatId,
          message_id: Number(telegramMessageId),
          caption: text,
          parse_mode: "HTML",
          reply_markup: replyMarkup,
        }
      : {
          chat_id: telegramChatId,
          message_id: Number(telegramMessageId),
          text,
          parse_mode: "HTML",
          reply_markup: replyMarkup,
        };

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
  const data = (await response.json()) as TelegramApiResponse;

  if (!data.ok) {
    throw new Error(data.description || `Telegram ${method} error`);
  }

  return data.result;
}
