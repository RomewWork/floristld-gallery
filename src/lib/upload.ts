import { demoAsset, isDemo, mutate } from "./api";
import type { Asset, UploadTicket } from "./types";
import type { ProcessedImage } from "./process-image";
// Keep the verified-upload checkpoint for this queue item, not a second upload on retry.
const checkpoints = new WeakMap<
  ProcessedImage,
  { ticket: UploadTicket; fileId: string }
>();
export async function uploadImage(
  image: ProcessedImage,
  signal: AbortSignal,
  onProgress: (n: number) => void,
): Promise<Asset> {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  if (isDemo) {
    onProgress(50);
    const a = await demoAsset(image.blob, image.width, image.height);
    onProgress(100);
    return a;
  }
  const checkpoint = checkpoints.get(image);
  const ticket =
    checkpoint?.ticket ??
    (await mutate<UploadTicket>(
      "/api/admin/uploads",
      "POST",
      {
        fileName: image.name,
        bytes: image.blob.size,
        mime: image.blob.type,
      },
      signal,
    ));
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const result =
    checkpoint ??
    (await new Promise<{ fileId: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      signal.addEventListener("abort", abort, { once: true });
      xhr.open("POST", "https://upload.imagekit.io/api/v1/files/upload");
      xhr.upload.onprogress = (e) =>
        e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 95));
      xhr.timeout = 120000;
      const cleanup = () => signal.removeEventListener("abort", abort);
      xhr.onerror = () => {
        cleanup();
        reject(new Error("网络中断 / Network interrupted."));
      };
      xhr.ontimeout = () => {
        cleanup();
        reject(new Error("上传超时，请重试 / Upload timed out. Retry."));
      };
      xhr.onabort = () => {
        cleanup();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      xhr.onload = () => {
        signal.removeEventListener("abort", abort);
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status < 200 || xhr.status >= 300)
            throw new Error(data.message || "Upload failed");
          resolve(data);
        } catch (e) {
          reject(e);
        }
      };
      const f = new FormData();
      f.set("file", image.blob, image.name);
      f.set("fileName", ticket.fileName);
      f.set("folder", ticket.folder);
      f.set("publicKey", ticket.publicKey);
      f.set("token", ticket.token);
      f.set("signature", ticket.signature);
      f.set("expire", String(ticket.expire));
      f.set("isPrivateFile", "true");
      f.set("useUniqueFileName", "false");
      f.set("overwriteFile", "false");
      xhr.send(f);
    }));
  checkpoints.set(image, { ticket, fileId: result.fileId });
  const asset = await mutate<Asset>(
    `/api/admin/uploads/${ticket.sessionId}/complete`,
    "POST",
    { fileId: result.fileId },
    signal,
  );
  onProgress(100);
  return asset;
}
