import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import type { VideoTextOverlay } from "./ai-generator";

const execFileAsync = promisify(execFile);

export type VideoOverlayInput = {
  inputPath: string;
  uploadsDir: string;
  videoTexts?: VideoTextOverlay[];
};

async function getVideoSize(inputPath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    inputPath,
  ]);

  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];

  return {
    width: Number(stream?.width || 720),
    height: Number(stream?.height || 1280),
  };
}

function wrapText(text: string, maxLineLength: number) {
  const words = text.split(" ").filter(Boolean);
  let line = "";
  const lines: string[] = [];

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (candidate.length > maxLineLength && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines.slice(0, 2).join("\\n");
}

function safeText(text: string, videoWidth: number) {
  const cleaned = text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\n/g, " ")
    .trim();

  const maxLineLength = Math.max(8, Math.floor(videoWidth / 28));

  return wrapText(cleaned, maxLineLength);
}

function getY(position: VideoTextOverlay["position"]) {
  if (position === "top") return "h*0.18";
  if (position === "center") return "(h-text_h)/2";
  return "h*0.70";
}

function getFontSize(
  position: VideoTextOverlay["position"],
  videoWidth: number
) {
  const scale = Math.max(0.65, Math.min(1.25, videoWidth / 720));

  if (position === "center") return Math.round(54 * scale);
  if (position === "bottom") return Math.round(44 * scale);

  return Math.round(48 * scale);
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
      text: String(item.text).slice(0, 50),
      start: Number(item.start),
      end: Number(item.end),
      position: ["top", "center", "bottom"].includes(item.position)
        ? item.position
        : "center",
    }));
}

export async function createReelsStyleVideo(input: VideoOverlayInput) {
  await fs.mkdir(input.uploadsDir, { recursive: true });

  const outputName = `processed-${Date.now()}.mp4`;
  const outputPath = path.join(input.uploadsDir, outputName);

  const videoSize = await getVideoSize(input.inputPath);
  const texts = normalizeVideoTexts(input.videoTexts);

  const filters = texts.map((item) => {
    const text = safeText(item.text, videoSize.width);
    const y = getY(item.position);
    const fontSize = getFontSize(item.position, videoSize.width);

    return `drawtext=text='${text}':fontcolor=white:fontsize=${fontSize}:borderw=4:bordercolor=black:x=(w-text_w)/2:y=${y}:line_spacing=10:enable='between(t,${item.start},${item.end})'`;
  });

  await execFileAsync("ffmpeg", [
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