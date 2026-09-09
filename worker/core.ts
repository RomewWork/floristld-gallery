import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { D1Database, Fetcher } from "@cloudflare/workers-types";
import type { Asset, Artwork, Collection, GalleryData } from "../src/lib/types";

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ENVIRONMENT?: string;
  DEV_AUTH?: string;
  PUBLIC_ONLY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
  PUBLIC_ORIGIN?: string;
  PUBLIC_ADDITIONAL_ORIGINS?: string;
  IMAGEKIT_PRIVATE_KEY?: string;
  IMAGEKIT_PUBLIC_KEY?: string;
  IMAGEKIT_URL_ENDPOINT?: string;
  MUTATION_TOKEN?: string;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
const jwks = new Map<string, JWTVerifyGetKey>();
export async function authenticate(
  request: Request,
  env: Env,
  testKey?: JWTVerifyGetKey,
) {
  const host = new URL(request.url).hostname;
  if (
    env.ENVIRONMENT === "development" &&
    env.DEV_AUTH === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(host)
  )
    return "local@localhost";
  if (
    !env.ACCESS_TEAM_DOMAIN ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN) ||
    !env.ACCESS_AUD ||
    !env.ADMIN_EMAILS
  )
    fail(401, "AUTH_CONFIG", "管理身份验证尚未配置");
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) fail(401, "AUTH_REQUIRED", "请先登录管理账户");
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let key = testKey || jwks.get(issuer);
  if (!key) {
    key = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwks.set(issuer, key);
  }
  try {
    const { payload } = await jwtVerify(token!, key!, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "email"],
    });
    const email =
      typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (
      !env
        .ADMIN_EMAILS!.split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .includes(email)
    )
      fail(403, "NOT_ADMIN", "此账户没有管理权限");
    return email;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return fail(401, "INVALID_TOKEN", "登录已过期或身份验证失败");
  }
}
export function checkOrigin(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    fail(403, "ORIGIN_REJECTED", "请求来源无效，请从管理页面重试");
}
export function publishable(artwork: Artwork, asset: Asset | undefined) {
  if (
    artwork.deletedAt ||
    !asset?.verified ||
    !artwork.title.zh.trim() ||
    !artwork.title.en.trim() ||
    !artwork.alt.zh.trim() ||
    !artwork.alt.en.trim()
  )
    fail(
      409,
      "PUBLISH_PREREQUISITES",
      "发布前请确认图片已验证，并填写中英文标题和替代文本",
    );
}
export function projectPublic(
  data: GalleryData,
  slug?: string,
  limit = 24,
  offset = 0,
  selectedId?: string,
): GalleryData & { nextCursor: number | null } {
  const available = new Set(
    data.assets.filter((a) => a.verified && !a.isPrivate).map((a) => a.id),
  );
  const byPosition = (
    a: { position: number; id: string },
    b: { position: number; id: string },
  ) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const collections = data.collections
    .filter(
      (c) =>
        c.status === "published" && !c.deletedAt && (!slug || c.slug === slug),
    )
    .sort(byPosition);
  const ids = new Set(collections.map((c) => c.id));
  const all = data.artworks
    .filter(
      (a) =>
        a.status === "published" &&
        !a.deletedAt &&
        ids.has(a.collectionId) &&
        available.has(a.assetId),
    )
    .sort(byPosition);
  const artworks = all
    .slice(offset, offset + limit)
    .map((a) => ({ ...a, version: 0 }));
  const selected = all.find((a) => a.id === selectedId);
  if (selected && !artworks.some((a) => a.id === selected.id))
    artworks.push({ ...selected, version: 0 });
  const assets = new Set(artworks.map((a) => a.assetId));
  const safeCollections: Collection[] = collections.map((c) => {
    const cover =
      all.find((a) => a.id === c.coverId && a.collectionId === c.id) ||
      all.find((a) => a.collectionId === c.id);
    if (cover) {
      assets.add(cover.assetId);
      if (!artworks.some((a) => a.id === cover.id))
        artworks.push({ ...cover, version: 0 });
    }
    return {
      ...c,
      coverId: cover?.id || null,
      version: 0,
      artworkCount: all.filter((a) => a.collectionId === c.id).length,
    };
  });
  return {
    collections: safeCollections,
    artworks,
    assets: data.assets
      .filter((a) => assets.has(a.id))
      .map((a) => ({ ...a, fileId: "" })),
    profile: data.profile,
    nextCursor: offset + limit < all.length ? offset + limit : null,
  };
}
export async function readBody(request: Request): Promise<unknown> {
  if (
    !(request.headers.get("content-type") || "").startsWith("application/json")
  )
    fail(400, "JSON_REQUIRED", "请发送 JSON 数据");
  if (Number(request.headers.get("content-length")) > 32768)
    fail(400, "BODY_TOO_LARGE", "请求数据过大");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 32768) {
      await reader.cancel();
      fail(400, "BODY_TOO_LARGE", "请求数据过大");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fail(400, "INVALID_JSON", "JSON 格式错误");
  }
}
