import { demoData } from "./demo";
import {
  blankText,
  type Artwork,
  type Asset,
  type Collection,
  type GalleryData,
  type Profile,
} from "./types";
export const isDemo = process.env.NEXT_PUBLIC_DATA_MODE !== "live";
const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
const DB = "floristld-demo-v1";
let memory: GalleryData | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
function exclusiveDemo<T>(work: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    if (typeof navigator !== "undefined" && navigator.locks)
      return await navigator.locks.request(DB, work);
    return await work();
  };
  const pending = writeQueue.then(run, run);
  writeQueue = pending.catch(() => undefined);
  return pending;
}
async function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("state");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function readDemo(): Promise<GalleryData> {
  if (typeof indexedDB === "undefined")
    return structuredClone(memory || demoData);
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("state");
    const r = t.objectStore("state").get("gallery");
    r.onsuccess = () => resolve(r.result || structuredClone(demoData));
    r.onerror = () => reject(r.error);
    t.oncomplete = () => d.close();
  });
}
async function saveDemo(data: GalleryData) {
  memory = data;
  if (typeof indexedDB === "undefined") return;
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction("state", "readwrite");
    t.objectStore("state").put(data, "gallery");
    t.oncomplete = () => {
      d.close();
      resolve();
    };
    t.onerror = () => reject(t.error);
  });
}
export function publicData(data: GalleryData): GalleryData {
  const collections = data.collections.filter(
    (c) => c.status === "published" && !c.deletedAt,
  );
  const artworks = data.artworks.filter(
    (a) =>
      a.status === "published" &&
      !a.deletedAt &&
      collections.some((c) => c.id === a.collectionId) &&
      data.assets.some((s) => s.id === a.assetId && s.verified),
  );
  return {
    profile: data.profile,
    collections,
    artworks,
    assets: data.assets.filter((s) => artworks.some((a) => a.assetId === s.id)),
  };
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "",
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    credentials: path.includes("/admin/") ? "include" : "omit",
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (r.redirected || r.headers.get("content-type")?.includes("text/html"))
    throw new ApiError(
      "登录已过期，请重新登录 / Session expired. Sign in again.",
      401,
    );
  const json = await r.json();
  if (!r.ok)
    throw new ApiError(
      json.error?.message || json.error || `Request failed (${r.status})`,
      r.status,
      json.error?.code || "",
    );
  return json;
}
export async function gallery(admin = false): Promise<GalleryData> {
  if (isDemo) {
    const d = await readDemo();
    return admin ? d : publicData(d);
  }
  return request(`/api/${admin ? "admin" : "public"}/gallery`);
}
export async function collectionPage(
  slug: string,
  cursor = 0,
  artwork?: string,
): Promise<GalleryData & { nextCursor?: number | null }> {
  if (!isDemo)
    return request(
      `/api/public/gallery?slug=${encodeURIComponent(slug)}&cursor=${cursor}&limit=24${artwork ? `&artwork=${encodeURIComponent(artwork)}` : ""}`,
    );
  const d = publicData(await readDemo());
  const collections = d.collections.filter((c) => c.slug === slug);
  const all = d.artworks
    .filter((a) => collections.some((c) => c.id === a.collectionId))
    .sort((a, b) => a.position - b.position);
  const page = all.slice(cursor, cursor + 24);
  const selected = all.find((a) => a.id === artwork);
  if (selected && !page.some((a) => a.id === selected.id)) page.push(selected);
  return {
    ...d,
    collections,
    artworks: page,
    nextCursor: cursor + 24 < all.length ? cursor + 24 : null,
  };
}
export const me = () =>
  isDemo
    ? Promise.resolve({ email: "demo@localhost" })
    : request<{ email: string }>("/api/admin/me");
export async function mutate<T>(
  path: string,
  method = "POST",
  body: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (!isDemo) {
    const until = Date.now() + 30_000;
    for (;;) {
      signal?.throwIfAborted();
      try {
        return await request(path, method, body, signal);
      } catch (e) {
        signal?.throwIfAborted();
        if (
          !(e instanceof ApiError) ||
          e.code !== "MUTATION_BUSY" ||
          Date.now() > until
        )
          throw e;
        await new Promise<void>((resolve, reject) => {
          const aborted = () => {
            clearTimeout(timer);
            reject(
              signal?.reason ?? new DOMException("Cancelled", "AbortError"),
            );
          };
          const timer = setTimeout(
            () => {
              signal?.removeEventListener("abort", aborted);
              resolve();
            },
            500 + Math.random() * 1000,
          );
          signal?.addEventListener("abort", aborted, { once: true });
          if (signal?.aborted) aborted();
        });
      }
    }
  }
  return exclusiveDemo(() => {
    signal?.throwIfAborted();
    return mutateDemo<T>(path, method, body);
  });
}
async function mutateDemo<T>(
  path: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const d = await readDemo();
  const p = path.split("/").filter(Boolean);
  const kind = p[2];
  const id = p[3];
  const action = p[4];
  let result: unknown;
  if (kind === "assets" && id && method === "DELETE") {
    if (d.artworks.some((a) => a.assetId === id))
      throw new ApiError("图片仍被作品引用 / Image is still in use.", 409);
    d.assets = d.assets.filter((a) => a.id !== id);
    await saveDemo(d);
    return { deleted: true } as T;
  }
  if (kind === "collections" && id === "order") {
    const ids = body.collectionIds as string[];
    const active = d.collections.filter((c) => !c.deletedAt);
    if (
      !Array.isArray(ids) ||
      ids.length !== active.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !active.some((c) => c.id === id))
    )
      throw new ApiError("Invalid collection order");
    const versions = body.versions as Record<string, number> | undefined;
    if (!versions || active.some((c) => versions[c.id] !== c.version))
      throw new ApiError(
        "内容已更新，请刷新 / Content changed, refresh first.",
        409,
      );
    ids.forEach((id, position) => {
      const c = d.collections.find((c) => c.id === id)!;
      c.position = position;
      c.version++;
    });
    await saveDemo(d);
    return { ok: true } as T;
  }
  if (kind === "profile") {
    d.profile = { ...d.profile, ...body } as Profile;
    result = d.profile;
  } else if (kind === "collections" || kind === "artworks") {
    const list = kind === "collections" ? d.collections : d.artworks;
    if (!id) {
      if (kind === "collections") {
        if (d.collections.some((c) => c.slug === body.slug))
          throw new ApiError("Slug 已存在 / Slug already exists");
        const c: Collection = {
          id: crypto.randomUUID(),
          slug: String(body.slug),
          title: blankText(),
          description: blankText(),
          status: "draft",
          position: list.length,
          coverId: null,
          deletedAt: null,
          version: 1,
          ...body,
        };
        d.collections.push(c);
        result = c;
      } else {
        if (body.creationId) {
          const previous = d.artworks.find((a) => a.id === body.creationId);
          if (previous) {
            if (
              previous.assetId !== body.assetId ||
              previous.collectionId !== body.collectionId
            )
              throw new ApiError(
                "Creation ID already used",
                409,
                "CREATION_ID_USED",
              );
            return previous as T;
          }
        }
        const a: Artwork = {
          id:
            typeof body.creationId === "string"
              ? body.creationId
              : crypto.randomUUID(),
          collectionId: String(body.collectionId),
          assetId: String(body.assetId),
          title: blankText(),
          description: blankText(),
          alt: blankText(),
          year: "2026",
          position: list.length,
          status: "draft",
          deletedAt: null,
          version: 1,
          ...body,
        };
        d.artworks.push(a);
        result = a;
      }
    } else {
      const item = list.find((c) => c.id === id);
      if (!item) throw new ApiError("Not found", 404);
      if (body.version !== undefined && body.version !== item.version)
        throw new ApiError(
          "内容已更新，请刷新 / Content changed, refresh first.",
          409,
        );
      if (action === "order") {
        const ids = body.artworkIds as string[];
        const all = d.artworks.filter(
          (a) => a.collectionId === id && !a.deletedAt,
        );
        if (
          ids.length !== all.length ||
          new Set(ids).size !== all.length ||
          ids.some((x) => !all.some((a) => a.id === x))
        )
          throw new ApiError("Invalid order");
        ids.forEach((x, i) => {
          const a = d.artworks.find((a) => a.id === x)!;
          a.position = i;
          a.version++;
        });
      } else if (action === "publish") {
        if (!item.title.zh.trim() || !item.title.en.trim())
          throw new ApiError("请填写中英文标题 / Both titles are required.");
        if (item.deletedAt) throw new ApiError("请先恢复 / Restore first.");
        if (kind === "artworks") {
          const a = item as Artwork;
          const s = d.assets.find((s) => s.id === a.assetId);
          if (!s?.verified || !a.alt.zh.trim() || !a.alt.en.trim())
            throw new ApiError(
              "图片和中英文 alt 必须完整 / Image and both alt texts required.",
            );
          s.isPrivate = false;
        } else {
          const c = item as Collection;
          if (
            !d.artworks.some(
              (a) =>
                a.id === c.coverId &&
                a.collectionId === id &&
                a.status === "published" &&
                !a.deletedAt,
            )
          )
            throw new ApiError(
              "请选择已发布的封面作品 / Select a published cover.",
            );
        }
        item.status = "published";
      } else if (action === "unpublish") item.status = "draft";
      else if (action === "restore") {
        item.status = "draft";
        item.deletedAt = null;
      } else if (action === "permanent") {
        if (!item.deletedAt) throw new ApiError("Move to trash first");
        if (
          kind === "collections" &&
          d.artworks.some((a) => a.collectionId === id)
        )
          throw new ApiError(
            "请先删除合集内的作品 / Delete child artworks first",
          );
        if (kind === "collections")
          d.collections = d.collections.filter((c) => c.id !== id);
        else {
          d.artworks = d.artworks.filter((a) => a.id !== id);
          d.collections.forEach((c) => {
            if (c.coverId === id) c.coverId = null;
          });
        }
      } else if (method === "DELETE") {
        item.deletedAt = new Date().toISOString();
        item.status = "draft";
      } else Object.assign(item, body);
      item.version++;
      result = item;
    }
  }
  await saveDemo(d);
  return result as T;
}
export async function demoAsset(
  blob: Blob,
  width: number,
  height: number,
): Promise<Asset> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  return exclusiveDemo(async () => {
    const d = await readDemo();
    const a: Asset = {
      id: crypto.randomUUID(),
      fileId: "demo",
      url,
      width,
      height,
      bytes: blob.size,
      verified: true,
      isPrivate: true,
    };
    d.assets.push(a);
    await saveDemo(d);
    return a;
  });
}
export async function exportData() {
  return isDemo ? readDemo() : request<GalleryData>("/api/admin/export");
}
