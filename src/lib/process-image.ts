export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
  // 对象 URL 由上传面板持有，移除预览或卸载时须 revokeObjectURL。
  preview: string;
  name: string;
}
// 输入上限按 MiB，输出上限按十进制 MB；输出限制须与 Worker 的核验规则同步。
export const MAX_INPUT_BYTES = 50 * 1024 * 1024,
  MAX_PIXELS = 40_000_000,
  MAX_OUTPUT_BYTES = 5_000_000;
export async function processImage(file: File): Promise<ProcessedImage> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("请选择 JPEG、PNG 或 WebP / Choose JPEG, PNG or WebP.");
  if (file.size > MAX_INPUT_BYTES)
    throw new Error("图片超过 50 MiB / Image exceeds 50 MiB.");
  // 先尝试读取文件头，尽早拦截超大像素图；头部不完整时仍以解码后的尺寸兜底。
  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const size = readDimensions(head, file.type);
  if (size && size.width * size.height > MAX_PIXELS)
    throw new Error("图片超过 4000 万像素 / Image exceeds 40 megapixels.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      "设备无法读取此图，请选择已导出的展示图 / Cannot decode image. Try an exported display image.",
    );
  }
  try {
    if (bitmap.width * bitmap.height > MAX_PIXELS)
      throw new Error("图片超过 4000 万像素 / Image exceeds 40 megapixels.");
    // 保持原比例且不放大小图；只生成展示副本，不改写用户原文件。
    const ratio = Math.min(1, 3840 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio)),
      height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器内存不足 / Not enough browser memory.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    // 固定质量生成 WebP（不支持时浏览器回退 PNG），超限就提示用户自行导出。
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error("图片处理失败 / Image processing failed.")),
        "image/webp",
        0.9,
      ),
    );
    canvas.width = 1;
    canvas.height = 1;
    if (blob.size > MAX_OUTPUT_BYTES)
      throw new Error(
        "展示图仍超过 5 MB，请选择自行导出的图片 / Display image exceeds 5 MB. Please export a smaller image.",
      );
    return {
      blob,
      width,
      height,
      preview: URL.createObjectURL(blob),
      name:
        file.name.replace(/\.[^.]+$/, "") +
        (blob.type === "image/webp" ? ".webp" : ".png"),
    };
  } finally {
    bitmap.close();
  }
}
export function readDimensions(
  b: Uint8Array,
  mime: string,
): { width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (mime === "image/png" && b.length >= 24 && b[0] === 137 && b[1] === 80)
    return { width: v.getUint32(16), height: v.getUint32(20) };
  if (mime === "image/jpeg") {
    let p = 2;
    while (p + 8 < b.length) {
      if (b[p] !== 255) {
        p++;
        continue;
      }
      const marker = b[p + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const len = v.getUint16(p + 2);
      if (len < 2) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      )
        return { width: v.getUint16(p + 7), height: v.getUint16(p + 5) };
      p += len + 2;
    }
  }
  if (mime === "image/webp" && b.length >= 30) {
    const code = String.fromCharCode(...b.slice(12, 16));
    if (code === "VP8X")
      return {
        width: 1 + b[24] + (b[25] << 8) + (b[26] << 16),
        height: 1 + b[27] + (b[28] << 8) + (b[29] << 16),
      };
    if (code === "VP8 ")
      return {
        width: v.getUint16(26, true) & 0x3fff,
        height: v.getUint16(28, true) & 0x3fff,
      };
    if (code === "VP8L" && b[20] === 0x2f)
      return {
        width: 1 + b[21] + ((b[22] & 0x3f) << 8),
        height: 1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 0x0f) << 10),
      };
  }
  return null;
}
