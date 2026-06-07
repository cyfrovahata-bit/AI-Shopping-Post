import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import type { VideoTextOverlay } from "./ai-generator";

const execFileAsync = promisify(execFile);

export type VideoStyle = "minimal" | "fashion" | "premium" | "sale";

export type VideoOverlayInput = {
  inputPath: string;
  uploadsDir: string;
  videoTexts?: VideoTextOverlay[];
  videoStyle?: VideoStyle;
};

type VideoStyleConfig = {
  fontColor: string;
  boxColor: string;
  borderColor: string;
  borderWidth: number;
  boxBorderWidth: number;
  topPrefix?: string;
  centerPrefix?: string;
  bottomPrefix?: string;
};

const VIDEO_STYLES: Record<VideoStyle, VideoStyleConfig> = {
  minimal: {
    fontColor: "white",
    boxColor: "black@0.35",
    borderColor: "white@0.25",
    borderWidth: 1,
    boxBorderWidth: 14,
  },
  fashion: {
    fontColor: "black",
    boxColor: "white@0.88",
    borderColor: "white@0.95",
    borderWidth: 2,
    boxBorderWidth: 18,
    topPrefix: "✦ ",
    centerPrefix: "",
    bottomPrefix: "↗ ",
  },
  premium: {
    fontColor: "white",
    boxColor: "black@0.62",
    borderColor: "gold@0.9",
    borderWidth: 2,
    boxBorderWidth: 20,
    topPrefix: "PREMIUM · ",
    centerPrefix: "",
    bottomPrefix: "✦ ",
  },
  sale: {
    fontColor: "white",
    boxColor: "red@0.78",
    borderColor: "white@0.95",
    borderWidth: 3,
    boxBorderWidth: 20,
    topPrefix: "SALE · ",
    centerPrefix: "🔥 ",
    bottomPrefix: "👉 ",
  },
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
  if (text.length <= maxLineLength) {
    return text;
  }

  return text.slice(0, maxLineLength);
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
  if (position === "top") return "h*0.16";
  if (position === "center") return "(h-text_h)/2";
  return "h*0.70";
}

function getFontSize(
  position: VideoTextOverlay["position"],
  videoWidth: number,
  style: VideoStyle
) {
  const scale = Math.max(0.65, Math.min(1.25, videoWidth / 720));

  const styleBoost = style === "sale" ? 1.12 : style === "premium" ? 1.04 : 1;

  if (position === "center") return Math.round(48 * scale * styleBoost);
  if (position === "bottom") return Math.round(38 * scale * styleBoost);
  return Math.round(42 * scale * styleBoost);
}

function normalizeVideoTexts(videoTexts?: VideoTextOverlay[]): VideoTextOverlay[] {
  if (!videoTexts?.length) {
    return [
      {
        text: "Новинка",
        start: 0,
        end: 2.5,
        position: "top",
      },
      {
        text: "Пиши в Direct",
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
      text: String(item.text).slice(0, 22),
      start: Number(item.start),
      end: Number(item.end),
      position: ["top", "center", "bottom"].includes(item.position)
        ? item.position
        : "center",
    }));
}

function getTextPrefix(
  position: VideoTextOverlay["position"],
  styleConfig: VideoStyleConfig
) {
  if (position === "top") return styleConfig.topPrefix || "";
  if (position === "center") return styleConfig.centerPrefix || "";
  return styleConfig.bottomPrefix || "";
}

function buildDrawTextFilter(
  item: VideoTextOverlay,
  videoWidth: number,
  style: VideoStyle
) {
  const styleConfig = VIDEO_STYLES[style];
  const prefix = getTextPrefix(item.position, styleConfig);
  const text = safeText(`${prefix}${item.text}`, videoWidth);
  const y = getY(item.position);
  const fontSize = getFontSize(item.position, videoWidth, style);

  return [
    `drawtext=text='${text}'`,
    `fontcolor=${styleConfig.fontColor}`,
    `fontsize=${fontSize}`,
    `box=1`,
    `boxcolor=${styleConfig.boxColor}`,
    `boxborderw=${styleConfig.boxBorderWidth}`,
    `borderw=${styleConfig.borderWidth}`,
    `bordercolor=${styleConfig.borderColor}`,
    `x=(w-text_w)/2`,
    `y=${y}`,
    `line_spacing=10`,
    `enable='between(t,${item.start},${item.end})'`,
  ].join(":");
}

export async function createReelsStyleVideo(input: VideoOverlayInput) {
  await fs.mkdir(input.uploadsDir, { recursive: true });

  const outputName = `processed-${Date.now()}.mp4`;
  const outputPath = path.join(input.uploadsDir, outputName);

  const videoSize = await getVideoSize(input.inputPath);
  const texts = normalizeVideoTexts(input.videoTexts);

  const videoStyle: VideoStyle = input.videoStyle || "fashion";

  const filters = texts.map((item) =>
    buildDrawTextFilter(item, videoSize.width, videoStyle)
  );

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
    videoStyle,
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