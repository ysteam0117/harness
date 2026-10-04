import { crc32, deflateSync } from "node:zlib";

/** 仮のアイコン（C-55）。PNG・ICO は base64 で持つ */
export interface IconFile {
  path: string;
  content: string;
  encoding?: "base64";
}

/** 背景・文字・仮であることを示す枠の色（RGB） */
const BACKGROUND = [0x47, 0x55, 0x69] as const;
const FOREGROUND = [0xff, 0xff, 0xff] as const;
const BORDER = [0xf5, 0x9e, 0x0b] as const;

/** 5×7 の点の文字（英大文字・数字）。1行を5桁の2進数で書く */
const GLYPHS: Record<string, readonly number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
};

/** アイコンに入れる文字（アプリ名の頭文字。英小文字・数字・ハイフンだけの名前なので、先頭は英数字） */
export function initialOf(appName: string): string {
  const c = appName.charAt(0).toUpperCase();
  return GLYPHS[c] ? c : "?";
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** 正方形の PNG（RGB）。背景に頭文字を置き、仮であることが分かるように枠を付ける */
export function placeholderPng(size: number, initial: string): Buffer {
  const glyph = GLYPHS[initial];
  // 文字は 5×7 の点。アイコンの幅の約半分にする
  const scale = Math.max(1, Math.floor((size * 0.5) / 7));
  const left = Math.floor((size - 5 * scale) / 2);
  const top = Math.floor((size - 7 * scale) / 2);
  const border = Math.max(1, Math.floor(size / 16));
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // 行ごとのフィルタ：なし
    for (let x = 0; x < size; x++) {
      let color: readonly number[] = BACKGROUND;
      if (x < border || y < border || x >= size - border || y >= size - border) {
        color = BORDER;
      } else if (glyph) {
        const gx = Math.floor((x - left) / scale);
        const gy = Math.floor((y - top) / scale);
        const bits = gx >= 0 && gx < 5 && gy >= 0 && gy < 7 ? glyph[gy] : undefined;
        if (bits !== undefined && x >= left && y >= top && (bits >> (4 - gx)) & 1) {
          color = FOREGROUND;
        }
      }
      const at = row + 1 + x * 3;
      raw[at] = color[0] ?? 0;
      raw[at + 1] = color[1] ?? 0;
      raw[at + 2] = color[2] ?? 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // ビットの深さ
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** PNG を1つ入れた ICO（Windows Vista 以降・主なブラウザが読める形） */
export function icoFromPng(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 種類：アイコン
  header.writeUInt16LE(1, 4); // 画像の数
  header[6] = size >= 256 ? 0 : size;
  header[7] = size >= 256 ? 0 : size;
  header.writeUInt16LE(1, 10); // 色の面
  header.writeUInt16LE(32, 12); // 1画素のビット数
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
}

function faviconSvg(initial: string): string {
  const hex = (c: readonly number[]) =>
    `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return `${[
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    "  <!-- 仮のアイコン（C-55）。本番へ公開する前に、同じファイル名で正式な画像に差し替える -->",
    `  <rect width="64" height="64" fill="${hex(BACKGROUND)}" />`,
    `  <rect x="2" y="2" width="60" height="60" fill="none" stroke="${hex(BORDER)}" stroke-width="4" />`,
    `  <text x="32" y="44" text-anchor="middle" font-family="sans-serif" font-size="36" font-weight="bold" fill="${hex(FOREGROUND)}">${initial}</text>`,
    "</svg>",
  ].join("\n")}\n`;
}

function manifest(appName: string): string {
  const doc = {
    name: appName,
    short_name: appName,
    start_url: "/",
    display: "standalone",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** 仮のアイコン一式（public/ の下）。同じアプリ名なら同じ中身になる */
export function buildIcons(appName: string): IconFile[] {
  const initial = initialOf(appName);
  const png = (size: number, p: string): IconFile => ({
    path: p,
    content: placeholderPng(size, initial).toString("base64"),
    encoding: "base64",
  });
  return [
    {
      path: "public/favicon.ico",
      content: icoFromPng(placeholderPng(32, initial), 32).toString("base64"),
      encoding: "base64",
    },
    { path: "public/favicon.svg", content: faviconSvg(initial) },
    png(180, "public/apple-touch-icon.png"),
    png(192, "public/icons/icon-192.png"),
    png(512, "public/icons/icon-512.png"),
    { path: "public/manifest.webmanifest", content: manifest(appName) },
  ];
}
