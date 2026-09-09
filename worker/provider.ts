import type { Asset } from "../src/lib/types";
import { fail, type Env } from "./core";
export interface Session {
  id: string;
  owner: string;
  file_name: string;
  folder: string;
  bytes: number;
  mime: string;
  expires: number;
  state: string;
  asset_id: string | null;
  file_id: string | null;
}
export interface FileDetails {
  fileId: string;
  filePath: string;
  name: string;
  url: string;
  size: number;
  width: number;
  height: number;
  fileType: string;
  isPrivateFile: boolean;
  mime?: string;
}
export function providerConfig(env: Env) {
  if (
    !env.IMAGEKIT_PRIVATE_KEY ||
    !env.IMAGEKIT_PUBLIC_KEY ||
    !env.IMAGEKIT_URL_ENDPOINT
  )
    fail(502, "PROVIDER_CONFIG", "图片服务尚未配置");
  const endpoint = new URL(env.IMAGEKIT_URL_ENDPOINT!);
  if (endpoint.protocol !== "https:")
    fail(502, "PROVIDER_CONFIG", "图片服务地址必须使用 HTTPS");
  return {
    key: env.IMAGEKIT_PRIVATE_KEY!,
    endpoint: env.IMAGEKIT_URL_ENDPOINT!.replace(/\/$/, ""),
  };
}
export async function hmac(key: string, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        new TextEncoder().encode(value),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function signedUrl(url: string, env: Env) {
  const { key, endpoint } = providerConfig(env);
  if (!url.startsWith(`${endpoint}/`))
    fail(502, "PROVIDER_URL", "图片地址与配置不一致");
  const expiry = Math.floor(Date.now() / 1000) + 300;
  const signature = await hmac(key, url.slice(endpoint.length + 1) + expiry);
  return `${url}${url.includes("?") ? "&" : "?"}ik-t=${expiry}&ik-s=${signature}`;
}
export async function providerRequest(
  env: Env,
  path: string,
  method = "GET",
  body?: FormData,
) {
  const { key } = providerConfig(env);
  let response: Response;
  try {
    response = await fetch(
      body
        ? "https://upload.imagekit.io/api/v1/files/upload"
        : `https://api.imagekit.io/v1/files${path.startsWith("?") ? path : `/${path}`}`,
      {
        method,
        headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
        body,
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    return fail(502, "PROVIDER_UNAVAILABLE", "图片服务暂时不可用，请稍后重试");
  }
  if (method === "DELETE" && response.status === 404) return null;
  if (!response.ok)
    fail(
      response.status === 429 ? 429 : 502,
      body && [400, 401, 403, 404, 413, 415, 422, 429].includes(response.status)
        ? "PROVIDER_UPLOAD_REJECTED"
        : "PROVIDER_REJECTED",
      "图片服务未能完成操作，请稍后重试",
    );
  return response.status === 204 ? null : await response.json();
}
export function verifyFile(
  details: FileDetails,
  session: Session,
  env: Env,
  privateFile = true,
): Asset {
  const { endpoint } = providerConfig(env);
  const extensions: Record<string, string[]> = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
    "image/avif": ["avif"],
  };
  const ext = details.name?.split(".").pop()?.toLowerCase() || "";
  if (
    details.filePath !== `${session.folder}/${session.file_name}` ||
    details.name !== session.file_name ||
    details.size !== session.bytes ||
    details.size > 5000000 ||
    details.size <= 0 ||
    details.fileType !== "image" ||
    !extensions[session.mime]?.includes(ext) ||
    details.isPrivateFile !== privateFile ||
    !Number.isInteger(details.width) ||
    !Number.isInteger(details.height) ||
    Math.min(details.width, details.height) < 1 ||
    Math.max(details.width, details.height) > 3840 ||
    !details.url?.startsWith(`${endpoint}/`) ||
    !details.fileId
  )
    fail(
      400,
      "UPLOAD_VERIFICATION",
      "图片验证失败：请检查文件归属、格式、大小、尺寸和私密设置",
    );
  if (details.mime && details.mime !== session.mime)
    fail(400, "UPLOAD_MIME", "图片格式与上传声明不一致");
  return {
    id: session.id,
    fileId: details.fileId,
    url: details.url,
    width: details.width,
    height: details.height,
    bytes: details.size,
    verified: true,
    isPrivate: privateFile,
  };
}
// ImageKit cannot toggle isPrivateFile after upload. Publish a separate copy and verify it.
export function publicPath(asset: Asset) {
  return `/gallery/public/${asset.id}.${new URL(asset.url).pathname.split(".").pop()}`;
}
export async function findPublicCopy(
  path: string,
  env: Env,
): Promise<FileDetails | null> {
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (
    !/^\/gallery\/public\/[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp|avif)$/.test(path)
  )
    fail(502, "PUBLIC_PATH_INVALID", "公开副本路径无效，未执行清理");
  const query = new URLSearchParams({
    path: `${folder}/`,
    searchQuery: `name="${name}"`,
    type: "file",
    limit: "1000",
  });
  const results = (await providerRequest(env, `?${query}`)) as FileDetails[];
  if (!Array.isArray(results) || results.length >= 1000)
    fail(502, "PUBLIC_COPY_UNRESOLVED", "无法确认公开副本，请稍后重试清理");
  const exact = results.filter(
    (file) =>
      file.filePath === path &&
      file.name === name &&
      typeof file.fileId === "string" &&
      file.fileId,
  );
  if (exact.length > 1)
    fail(502, "PUBLIC_COPY_AMBIGUOUS", "公开副本路径存在多个文件，未执行清理");
  return exact[0] || null;
}
export async function publicCopy(
  asset: Asset,
  env: Env,
  onUploaded: (file: FileDetails) => Promise<void>,
  pendingId?: string | null,
): Promise<FileDetails> {
  const path = publicPath(asset);
  const folder = "/gallery/public";
  const fileName = path.slice(folder.length + 1);
  let fileId = pendingId;
  if (!fileId) {
    const form = new FormData();
    form.set("file", await signedUrl(asset.url, env));
    form.set("fileName", fileName);
    form.set("folder", folder);
    form.set("useUniqueFileName", "false");
    form.set("overwriteFile", "true");
    form.set("isPrivateFile", "false");
    const uploaded = (await providerRequest(
      env,
      "",
      "POST",
      form,
    )) as FileDetails;
    if (
      !uploaded.fileId ||
      uploaded.filePath !== path ||
      uploaded.name !== fileName
    )
      fail(
        502,
        "PUBLIC_COPY_VERIFICATION",
        "公开副本返回路径不匹配，作品未发布",
      );
    await onUploaded(uploaded);
    fileId = uploaded.fileId;
  }
  const details = (await providerRequest(
    env,
    `${encodeURIComponent(fileId)}/details?responseFields=isPrivateFile`,
  )) as FileDetails;
  if (
    details.fileId !== fileId ||
    details.isPrivateFile !== false ||
    details.filePath !== path ||
    details.size !== asset.bytes ||
    details.width !== asset.width ||
    details.height !== asset.height ||
    details.fileType !== "image" ||
    !details.url.startsWith(`${providerConfig(env).endpoint}/`)
  )
    fail(502, "PUBLIC_COPY_VERIFICATION", "公开图片副本验证失败，作品未发布");
  return details;
}
