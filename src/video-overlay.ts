import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import type { VideoTextOverlay } from "./ai-generator";

const execFileAsync = promisify(execFile);

export type VideoOverlayInput = {
  inputPath: string;
  uploadsDir: string;
  videoTexts?: VideoTextOverlay[];
};

function safeText(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\n/g, " ")
    .trim();
}

function getY(position: VideoTextOverlay["position"]) {
  if (position === "top") return "h*0.16";
  if (position === "center") return "(h-text_h)/2";
  return "h*0.78";
}

function getFontSize(position: VideoTextOverlay["position"]) {
  if (position === "center") return 62;
  if (position === "bottom") return 48;
  return 56;
}

function normalizeVideoTexts(videoTexts?: VideoTextOverlay[]): VideoTextOverlay[] {
  if (!videoTexts?.length) {
    return [
      {
        text: "🔥 Новинка",
        start: 0,
        end: 2.5,
        position: "top",
      },
      {
        text: "📩 Пиши в Direct",
        start: 5,
        end: 8,
        position: "bottom",
      },
    ];
  }

  return videoTexts
    .filter((item) => item.text && item.start >= 0 && item.end > item.start)
    .slice(0, 5)
    .map((item) => ({
      text: item.text.slice(0, 40),
      start: Number(item.start),
      end: Number(item.end),
      position: ["top", "center", "bottom"].includes(item.position)
        ? item.position
        : "center",
    }));
}

export async function createReelsStyleVideo(input: VideoOverlayInput) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static not found");
  }

  await fs.mkdir(input.uploadsDir, { recursive: true });

  const outputName = `processed-${Date.now()}.mp4`;
  const outputPath = path.join(input.uploadsDir, outputName);

  const texts = normalizeVideoTexts(input.videoTexts);

  const filters = texts.map((item) => {
    const text = safeText(item.text);
    const y = getY(item.position);
    const fontSize = getFontSize(item.position);

    return `drawtext=text='${text}':fontcolor=white:fontsize=${fontSize}:borderw=4:bordercolor=black:x=(w-text_w)/2:y=${y}:enable='between(t,${item.start},${item.end})'`;
  });

  await execFileAsync(ffmpegPath, [
    "-y",
    "-i",
    input.inputPath,
    "-vf",
    filters.join(","),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);

  return {
    outputPath,
    outputName,
  };
}

export function filePathToPublicUrl(filePath: string) {
  const baseUrl = process.env.PUBLIC_BASE_URL;

  if (!baseUrl) {
    throw new Error("PUBLIC_BASE_URL missing");
  }

  const fileName = path.basename(filePath);

  return `${baseUrl.replace(/\/$/, "")}/uploads/${fileName}`;
}