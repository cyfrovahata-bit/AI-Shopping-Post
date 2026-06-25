import fs from "fs";
import FormData from "form-data";
import fetch from "node-fetch";

const defaultOrderUrl = "";

type TelegramCredentials = {
  chatId?: string;
};

type TelegramApiResponse = {
  ok: boolean;
  description?: string;
  result?: any;
};

function getReplyMarkup() {
  const orderUrl = process.env.ORDER_URL || defaultOrderUrl;
  if (!orderUrl) return null;

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

function assertTelegramResponse(data: TelegramApiResponse, errorText: string) {
  if (!data.ok) {
    throw new Error(data.description || errorText);
  }
}

async function sendOrderButtonMessage(botToken: string, chatId: string) {
  const replyMarkup = getReplyMarkup();
  if (!replyMarkup) return null;

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: "🛒 Замовити товар:",
        reply_markup: replyMarkup,
      }),
    }
  );

  const data = (await response.json()) as TelegramApiResponse;
  assertTelegramResponse(data, "Telegram sendMessage error");

  return data.result?.message_id;
}

export async function sendTelegramMediaGroup(
  text: string,
  photoPaths: string[],
  creds?: TelegramCredentials
) {
  const botToken = process.env.BOT_TOKEN;
  const chatId = creds?.chatId || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error("Немає BOT_TOKEN або TELEGRAM_CHAT_ID в .env");
  }

  const photos = photoPaths.filter(Boolean).slice(0, 10);

  if (photos.length < 2) {
    throw new Error("Для media group потрібно мінімум 2 фото");
  }

  const form = new FormData();

  form.append("chat_id", chatId);

  const media = photos.map((_, index) => ({
    type: "photo",
    media: `attach://photo${index}`,
    ...(index === 0
      ? {
          caption: text,
          parse_mode: "HTML",
        }
      : {}),
  }));

  form.append("media", JSON.stringify(media));

  photos.forEach((photoPath, index) => {
    form.append(`photo${index}`, fs.createReadStream(photoPath));
  });

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMediaGroup`,
    {
      method: "POST",
      body: form as any,
    }
  );

  const data = (await response.json()) as TelegramApiResponse;
  assertTelegramResponse(data, "Telegram sendMediaGroup error");

  const firstMessageId = data.result?.[0]?.message_id;

  await sendOrderButtonMessage(botToken, chatId);

  return {
    chatId,
    messageId: firstMessageId,
  };
}

export async function sendTelegramMixedMediaGroup(
  text: string,
  videoPath: string,
  photoPaths: string[],
  creds?: TelegramCredentials
) {
  const botToken = process.env.BOT_TOKEN;
  const chatId = creds?.chatId || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error("Немає BOT_TOKEN або TELEGRAM_CHAT_ID в .env");
  }

  const photos = photoPaths.filter(Boolean).slice(0, 9);

  const form = new FormData();

  form.append("chat_id", chatId);

  const media = [
    {
      type: "video",
      media: "attach://video0",
      caption: text,
      parse_mode: "HTML",
    },
    ...photos.map((_, index) => ({
      type: "photo",
      media: `attach://photo${index}`,
    })),
  ];

  form.append("media", JSON.stringify(media));

  form.append("video0", fs.createReadStream(videoPath));

  photos.forEach((photoPath, index) => {
    form.append(`photo${index}`, fs.createReadStream(photoPath));
  });

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMediaGroup`,
    {
      method: "POST",
      body: form as any,
    }
  );

  const data = (await response.json()) as TelegramApiResponse;
  assertTelegramResponse(data, "Telegram mixed sendMediaGroup error");

  const firstMessageId = data.result?.[0]?.message_id;

  await sendOrderButtonMessage(botToken, chatId);

  return {
    chatId,
    messageId: firstMessageId,
  };
}

export async function sendTelegramPost(
  text: string,
  photoPath?: string,
  videoPath?: string,
  photoPaths?: string[],
  creds?: TelegramCredentials
) {
  const botToken = process.env.BOT_TOKEN;
  const chatId = creds?.chatId || process.env.TELEGRAM_CHAT_ID;
  const replyMarkup = getReplyMarkup();

  if (!botToken || !chatId) {
    throw new Error("Немає BOT_TOKEN або TELEGRAM_CHAT_ID в .env");
  }

  const allPhotos = photoPaths?.length
    ? photoPaths.filter(Boolean)
    : photoPath
      ? [photoPath]
      : [];

  if (videoPath && allPhotos.length > 0) {
    return sendTelegramMixedMediaGroup(text, videoPath, allPhotos, creds);
  }

  if (videoPath) {
    const form = new FormData();

    form.append("chat_id", chatId);
    form.append("video", fs.createReadStream(videoPath));
    form.append("caption", text);
    form.append("parse_mode", "HTML");
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendVideo`,
      {
        method: "POST",
        body: form as any,
      }
    );

    const data = (await response.json()) as TelegramApiResponse;
    assertTelegramResponse(data, "Telegram sendVideo error");

    return {
      chatId,
      messageId: data.result?.message_id,
    };
  }

  if (allPhotos.length > 1) {
    return sendTelegramMediaGroup(text, allPhotos, creds);
  }

  if (allPhotos.length === 1) {
    const form = new FormData();

    form.append("chat_id", chatId);
    form.append("photo", fs.createReadStream(allPhotos[0]));
    form.append("caption", text);
    form.append("parse_mode", "HTML");
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendPhoto`,
      {
        method: "POST",
        body: form as any,
      }
    );

    const data = (await response.json()) as TelegramApiResponse;
    assertTelegramResponse(data, "Telegram sendPhoto error");

    return {
      chatId,
      messageId: data.result?.message_id,
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
  assertTelegramResponse(data, "Telegram sendMessage error");

  return {
    chatId,
    messageId: data.result?.message_id,
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
