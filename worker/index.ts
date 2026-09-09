import { z } from "zod";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import type {
  Asset,
  Artwork,
  Collection,
  GalleryData,
  Profile,
} from "../src/lib/types";
import {
  ApiError,
  authenticate,
  checkOrigin,
  fail,
  projectPublic,
  publishable,
  readBody,
  type Env,
} from "./core";
import {
  hmac,
  providerConfig,
  providerRequest,
  publicCopy,
  publicPath,
  findPublicCopy,
  signedUrl,
  verifyFile,
  type FileDetails,
  type Session,
} from "./provider";

const text = z
  .object({ zh: z.string().max(10000), en: z.string().max(10000) })
  .strict();
const version = z.number().int().positive();
const id = z.string().uuid();
const slug = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const collectionFields = z
  .object({
    slug,
    title: text,
    description: text,
    coverId: id.nullable().optional(),
  })
  .strict();
const artworkFields = z
  .object({
    collectionId: id,
    assetId: id,
    title: text,
    description: text,
    alt: text,
    year: z.string().max(30),
  })
  .strict();
const profileFields = z
  .object({
    name: text,
    tagline: text,
    bio: text,
    email: z.union([z.email(), z.literal("")]),
    instagram: z.string().max(500),
    contact: z.string().max(1000),
  })
  .strict();
const stamp = () => Math.floor(Date.now() / 1000);
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) fail(400, "VALIDATION", "输入不完整或格式错误");
  return r.data!;
};
async function executeBatch(env: Env, statements: D1PreparedStatement[]) {
  if (!env.MUTATION_TOKEN) return env.DB.batch(statements);
  const guard = env.DB.prepare(
    "INSERT INTO mutation_guard(id,valid) VALUES(1,CASE WHEN EXISTS(SELECT 1 FROM mutation_lock WHERE id=1 AND token=? AND expires>?) THEN 1 ELSE 0 END) ON CONFLICT(id) DO UPDATE SET valid=excluded.valid",
  ).bind(env.MUTATION_TOKEN, stamp());
  const result = await env.DB.batch([guard, ...statements]);
  return result.slice(1);
}
const stmt = (
  env: Env,
  sql: string,
  ...args: unknown[]
): D1PreparedStatement => {
  const prepared = env.DB.prepare(sql).bind(...args);
  if (!env.MUTATION_TOKEN) return prepared;
  return new Proxy(prepared, {
    get(target, property) {
      if (property === "run")
        return async () => {
          const results = await executeBatch(env, [target]);
          return results[0];
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};
async function all<T>(env: Env, sql: string, ...args: unknown[]) {
  return (await stmt(env, sql, ...args).all<T>()).results;
}
type AssetRow = {
  id: string;
  data: string;
  file_id: string;
  public_file_id: string | null;
  public_url: string | null;
  public_bytes: number;
  public_path: string | null;
  pending_public_file_id: string | null;
};
type RecordRow = { id: string; data: string; version: number };
const decode = <T>(row: { data: string }) => JSON.parse(row.data) as T;
async function record(
  env: Env,
  table: "collections" | "artworks",
  key: string,
): Promise<Collection | Artwork> {
  const row = await stmt(
    env,
    `SELECT * FROM ${table} WHERE id=?`,
    key,
  ).first<RecordRow>();
  if (!row) fail(404, "NOT_FOUND", "内容不存在");
  return { ...decode<Collection | Artwork>(row!), version: row!.version };
}
async function assetRow(env: Env, key: string) {
  const row = await stmt(
    env,
    "SELECT * FROM assets WHERE id=?",
    key,
  ).first<AssetRow>();
  if (!row) fail(404, "ASSET_NOT_FOUND", "图片不存在");
  return row!;
}
async function save(
  env: Env,
  table: "collections" | "artworks",
  item: Collection | Artwork,
  expected: number,
) {
  const updated = { ...item, version: expected + 1 };
  const result = await stmt(
    env,
    `UPDATE ${table} SET data=?, version=version+1 WHERE id=? AND version=?`,
    JSON.stringify(updated),
    item.id,
    expected,
  ).run();
  if (result.meta.changes !== 1)
    fail(409, "VERSION_CONFLICT", "内容已被更新，请刷新后重试");
  return updated;
}
function checkVersion(item: Collection | Artwork, expected: number) {
  if (item.version !== expected)
    fail(409, "VERSION_CONFLICT", "内容已被更新，请刷新后重试");
}
async function loadGallery(
  env: Env,
  mode: "public" | "admin" | "export",
): Promise<
  GalleryData & { usage?: { storedBytes: number; reservedBytes: number } }
> {
  const [collections, artworks, rows, profile] = await Promise.all([
    all<RecordRow>(
      env,
      "SELECT * FROM collections ORDER BY CAST(json_extract(data,'$.position') AS INTEGER),id",
    ),
    all<RecordRow>(
      env,
      "SELECT * FROM artworks ORDER BY CAST(json_extract(data,'$.position') AS INTEGER),id",
    ),
    all<AssetRow>(env, "SELECT * FROM assets"),
    stmt(env, "SELECT data FROM profile WHERE id=1").first<{ data: string }>(),
  ]);
  const assets = await Promise.all(
    rows.map(async (row) => {
      const asset = decode<Asset>(row);
      if (mode === "public")
        return {
          ...asset,
          url: row.public_url || "",
          isPrivate: !row.public_url,
          fileId: "",
        };
      if (mode === "admin")
        return { ...asset, url: await signedUrl(asset.url, env) };
      return asset;
    }),
  );
  const data: GalleryData & {
    usage?: { storedBytes: number; reservedBytes: number };
  } = {
    collections: collections.map((r) => ({
      ...decode<Collection>(r),
      version: r.version,
    })),
    artworks: artworks.map((r) => ({
      ...decode<Artwork>(r),
      version: r.version,
    })),
    assets,
    profile: decode<Profile>(profile!),
  };
  if (mode !== "public") {
    const pending = await stmt(
      env,
      "SELECT COALESCE(SUM(bytes*2),0) AS bytes FROM upload_sessions WHERE state!='complete' AND expires> ?",
      stamp(),
    ).first<{ bytes: number }>();
    data.usage = {
      storedBytes: rows.reduce(
        (sum, row) => sum + decode<Asset>(row).bytes + row.public_bytes,
        0,
      ),
      reservedBytes: rows.reduce(
        (sum, row) =>
          sum + Math.max(0, decode<Asset>(row).bytes - row.public_bytes),
        pending?.bytes || 0,
      ),
    };
  }
  return data;
}
async function withMutationLock<T>(
  env: Env,
  action: (lockedEnv: Env) => Promise<T>,
): Promise<T> {
  const token = crypto.randomUUID();
  const result = await stmt(
    env,
    "INSERT INTO mutation_lock(id,token,expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE mutation_lock.expires<?",
    token,
    stamp() + 300,
    stamp(),
  ).run();
  if (result.meta.changes !== 1)
    fail(409, "MUTATION_BUSY", "另一个操作正在执行，请稍后重试");
  try {
    return await action({ ...env, MUTATION_TOKEN: token });
  } finally {
    await stmt(
      env,
      "DELETE FROM mutation_lock WHERE id=1 AND token=?",
      token,
    ).run();
  }
}
async function ensurePublic(env: Env, key: string) {
  const row = await assetRow(env, key);
  const asset = decode<Asset>(row);
  if (!asset.verified) fail(409, "UNVERIFIED_ASSET", "图片尚未验证");
  if (row.public_url && row.public_file_id) return;
  // Persist intent before the provider side effect; even a lost lease leaves a reconcilable path.
  await stmt(
    env,
    "UPDATE assets SET public_path=? WHERE id=?",
    publicPath(asset),
    key,
  ).run();
  const copy = await publicCopy(
    asset,
    env,
    async (file) => {
      await stmt(
        env,
        "UPDATE assets SET pending_public_file_id=?,public_bytes=? WHERE id=?",
        file.fileId,
        Number.isInteger(file.size) && file.size >= 0 ? file.size : asset.bytes,
        key,
      ).run();
    },
    row.pending_public_file_id,
  ).catch(async (error) => {
    // Only a definitive rejection of the first attempt proves there is no copy.
    // An earlier unknown attempt may still be in flight; never erase its intent.
    if (
      !row.public_path &&
      !row.pending_public_file_id &&
      error instanceof ApiError &&
      error.code === "PROVIDER_UPLOAD_REJECTED"
    ) {
      await stmt(
        env,
        "UPDATE assets SET public_path=NULL WHERE id=?",
        key,
      ).run();
    }
    throw error;
  });
  await stmt(
    env,
    "UPDATE assets SET public_file_id=?,public_url=?,public_bytes=?,pending_public_file_id=NULL WHERE id=?",
    copy.fileId,
    copy.url,
    copy.size,
    key,
  ).run();
}
async function cleanupAsset(env: Env, key: string) {
  const referenced = await stmt(
    env,
    "SELECT id FROM artworks WHERE asset_id=? LIMIT 1",
    key,
  ).first();
  if (referenced) return;
  const row = await assetRow(env, key);
  // Keep the asset row on a partial provider failure, allowing safe operational retry.
  await stmt(
    env,
    "UPDATE assets SET data=json_set(data,'$.verified',json('false')) WHERE id=?",
    key,
  ).run();
  let publicId = row.public_file_id || row.pending_public_file_id;
  if (!publicId && row.public_path) {
    const found = await findPublicCopy(row.public_path, env);
    if (!found)
      fail(
        502,
        "PUBLIC_COPY_UNRESOLVED",
        "公开副本结果尚不明确，已保留清理记录，请稍后重试",
      );
    publicId = found.fileId;
    await stmt(
      env,
      "UPDATE assets SET pending_public_file_id=? WHERE id=?",
      publicId,
      key,
    ).run();
  }
  if (publicId)
    await providerRequest(env, encodeURIComponent(publicId), "DELETE");
  await providerRequest(env, encodeURIComponent(row.file_id), "DELETE");
  await executeBatch(env, [
    env.DB.prepare(
      "UPDATE upload_sessions SET asset_id=NULL WHERE asset_id=?",
    ).bind(key),
    env.DB.prepare(
      "DELETE FROM assets WHERE id=? AND NOT EXISTS(SELECT 1 FROM artworks WHERE asset_id=?)",
    ).bind(key, key),
  ]);
}
async function mutate(
  env: Env,
  path: string,
  method: string,
  body: unknown,
  email: string,
): Promise<unknown> {
  if (path === "/api/admin/collections/order" && method === "POST") {
    const { collectionIds, versions } = parse(
      z
        .object({
          collectionIds: z.array(id).max(1000),
          versions: z.record(id, version),
        })
        .strict(),
      body,
    );
    const rows = await all<RecordRow>(
      env,
      "SELECT * FROM collections WHERE json_extract(data,'$.deletedAt') IS NULL",
    );
    if (
      collectionIds.length !== rows.length ||
      new Set(collectionIds).size !== rows.length ||
      rows.some((r) => !collectionIds.includes(r.id))
    )
      fail(409, "ORDER_MEMBERSHIP", "作品集列表已变化，请刷新后重新排序");
    if (
      Object.keys(versions).length !== rows.length ||
      rows.some((r) => versions[r.id] !== r.version)
    )
      fail(409, "VERSION_CONFLICT", "作品集已被更新，请刷新后重试排序");
    if (collectionIds.length)
      await executeBatch(
        env,
        collectionIds.map((key, position) =>
          env.DB.prepare(
            "UPDATE collections SET data=json_set(data,'$.position',?,'$.version',version+1),version=version+1 WHERE id=?",
          ).bind(position, key),
        ),
      );
    return {
      collections: collectionIds.map((key, position) => {
        const row = rows.find((r) => r.id === key)!;
        return {
          ...decode<Collection>(row),
          position,
          version: row.version + 1,
        };
      }),
    };
  }
  const cleanup = path.match(/^\/api\/admin\/assets\/([^/]+)$/);
  if (cleanup && method === "DELETE") {
    if (
      await stmt(
        env,
        "SELECT id FROM artworks WHERE asset_id=? LIMIT 1",
        cleanup[1],
      ).first()
    )
      fail(409, "ASSET_REFERENCED", "此图片仍被作品引用");
    await cleanupAsset(env, cleanup[1]);
    return { deleted: true };
  }
  if (path === "/api/admin/profile" && method === "PATCH") {
    const profile = parse(profileFields, body);
    await stmt(
      env,
      "UPDATE profile SET data=? WHERE id=1",
      JSON.stringify(profile),
    ).run();
    return profile;
  }
  if (path === "/api/admin/uploads" && method === "POST") {
    const upload = parse(
      z
        .object({
          fileName: z.string().min(1).max(200),
          bytes: z.number().int().positive().max(5000000),
          mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif"]),
        })
        .strict(),
      body,
    );
    const { key } = providerConfig(env);
    const sessionId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const expire = stamp() + 300;
    const exts: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/avif": "avif",
    };
    const fileName = `${sessionId}.${exts[upload.mime]}`;
    const folder = `/gallery/private/${sessionId}`;
    // Reserve twice the original bytes, including its eventual public copy. One INSERT is capacity-atomic.
    const result = await stmt(
      env,
      "INSERT INTO upload_sessions(id,owner,file_name,folder,bytes,mime,expires,state) SELECT ?,?,?,?,?,?,?,'pending' WHERE (SELECT COALESCE(SUM(CAST(json_extract(data,'$.bytes') AS INTEGER)*2),0) FROM assets)+(SELECT COALESCE(SUM(bytes*2),0) FROM upload_sessions WHERE state!='complete' AND expires>?) + ? <= 2500000000",
      sessionId,
      email,
      fileName,
      folder,
      upload.bytes,
      upload.mime,
      stamp() + 900,
      stamp(),
      upload.bytes * 2,
    ).run();
    if (result.meta.changes !== 1)
      fail(409, "STORAGE_LIMIT", "图片存储空间不足，请先清理不需要的图片");
    return {
      sessionId,
      token,
      signature: await hmac(key, token + expire),
      expire,
      publicKey: env.IMAGEKIT_PUBLIC_KEY!,
      fileName,
      folder,
    };
  }
  const completion = path.match(/^\/api\/admin\/uploads\/([^/]+)\/complete$/);
  if (completion && method === "POST") {
    const { fileId } = parse(
      z.object({ fileId: z.string().min(1).max(200) }).strict(),
      body,
    );
    const session = await stmt(
      env,
      "SELECT * FROM upload_sessions WHERE id=? AND owner=?",
      completion[1],
      email,
    ).first<Session>();
    if (!session) fail(404, "SESSION_NOT_FOUND", "上传会话不存在");
    if (session!.state === "complete") {
      if (session!.file_id !== fileId || !session!.asset_id)
        fail(409, "SESSION_USED", "此上传会话已使用");
      const row = await assetRow(env, session!.asset_id!);
      return {
        ...decode<Asset>(row),
        url: await signedUrl(decode<Asset>(row).url, env),
      };
    }
    // Expiry ends upload authorization, not reconciliation of a file already
    // uploaded to this owner's exact assigned path. Never renew the ticket.
    await stmt(
      env,
      "UPDATE upload_sessions SET state='verifying' WHERE id=? AND state!='complete'",
      session!.id,
    ).run();
    try {
      const details = (await providerRequest(
        env,
        `${encodeURIComponent(fileId)}/details`,
      )) as FileDetails;
      if (details.fileId !== fileId)
        fail(400, "FILE_ID_MISMATCH", "图片标识不一致");
      const asset = verifyFile(details, session!, env);
      let media: Response;
      try {
        media = await fetch(await signedUrl(asset.url, env), {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        return fail(502, "MEDIA_VERIFICATION", "暂时无法验证图片格式");
      }
      // The provider's file-details API verifies the original file type,
      // while its delivery response may advertise a negotiated/generic type.
      // Only require that the signed private asset is reachable here.
      if (!media.ok) fail(400, "UPLOAD_MIME", "图片实际格式与上传声明不一致");
      await executeBatch(env, [
        env.DB.prepare(
          "INSERT INTO assets(id,file_id,data) VALUES(?,?,?)",
        ).bind(asset.id, asset.fileId, JSON.stringify(asset)),
        env.DB.prepare(
          "UPDATE upload_sessions SET state='complete',asset_id=?,file_id=? WHERE id=? AND owner=? AND state='verifying'",
        ).bind(asset.id, asset.fileId, session!.id, email),
      ]);
      return { ...asset, url: await signedUrl(asset.url, env) };
    } catch (error) {
      await stmt(
        env,
        "UPDATE upload_sessions SET state='pending' WHERE id=? AND state='verifying'",
        session!.id,
      ).run();
      throw error;
    }
  }
  if (path === "/api/admin/collections" && method === "POST") {
    const fields = parse(collectionFields.omit({ coverId: true }), body);
    const item: Collection = {
      ...fields,
      id: crypto.randomUUID(),
      status: "draft",
      position: stamp(),
      coverId: null,
      deletedAt: null,
      version: 1,
    };
    await stmt(
      env,
      "INSERT INTO collections(id,slug,data,version) VALUES(?,?,?,1)",
      item.id,
      item.slug,
      JSON.stringify(item),
    ).run();
    return item;
  }
  if (path === "/api/admin/artworks" && method === "POST") {
    const { creationId, ...fields } = parse(
      artworkFields.extend({ creationId: id.optional() }),
      body,
    );
    if (creationId) {
      const existing = await stmt(
        env,
        "SELECT * FROM artworks WHERE id=?",
        creationId,
      ).first<RecordRow>();
      if (existing) {
        const previous = decode<Artwork>(existing);
        if (
          previous.collectionId !== fields.collectionId ||
          previous.assetId !== fields.assetId
        )
          fail(409, "CREATION_ID_USED", "此创建标识已用于其他作品，请刷新列表");
        return { ...previous, version: existing.version };
      }
    }
    const collection = await record(env, "collections", fields.collectionId);
    if (collection.deletedAt) fail(409, "COLLECTION_DELETED", "请先恢复作品集");
    const asset = decode<Asset>(await assetRow(env, fields.assetId));
    if (!asset.verified) fail(409, "UNVERIFIED_ASSET", "图片尚未完成验证");
    const item: Artwork = {
      ...fields,
      id: creationId ?? crypto.randomUUID(),
      status: "draft",
      position: stamp(),
      deletedAt: null,
      version: 1,
    };
    await executeBatch(env, [
      env.DB.prepare(
        "INSERT INTO artworks(id,collection_id,asset_id,data,version) VALUES(?,?,?,?,1)",
      ).bind(item.id, item.collectionId, item.assetId, JSON.stringify(item)),
      env.DB.prepare(
        "UPDATE collections SET version=version+1 WHERE id=?",
      ).bind(fields.collectionId),
    ]);
    return item;
  }
  const match = path.match(
    /^\/api\/admin\/(collections|artworks)\/([^/]+)(?:\/(publish|unpublish|restore|permanent|order))?$/,
  );
  if (!match) fail(404, "NOT_FOUND", "接口不存在");
  const table = match![1] as "collections" | "artworks";
  const key = match![2];
  const action = match![3];
  const item = await record(env, table, key);
  const v = parse(z.object({ version }).passthrough(), body).version;
  checkVersion(item, v);
  if (action === "order" && table === "collections" && method === "POST") {
    const { artworkIds } = parse(
      z.object({ artworkIds: z.array(id).max(1000), version }).strict(),
      body,
    );
    const rows = await all<RecordRow>(
      env,
      "SELECT * FROM artworks WHERE collection_id=? AND json_extract(data,'$.deletedAt') IS NULL",
      key,
    );
    if (
      artworkIds.length !== rows.length ||
      new Set(artworkIds).size !== rows.length ||
      rows.some((r) => !artworkIds.includes(r.id))
    )
      fail(409, "ORDER_MEMBERSHIP", "作品列表已变化，请刷新后重新排序");
    if (item.deletedAt) fail(409, "DELETED", "请先恢复作品集");
    const updates: D1PreparedStatement[] = [
      env.DB.prepare(
        "UPDATE collections SET version=version+1 WHERE id=? AND version=?",
      ).bind(key, v),
    ];
    for (const [position, artworkId] of artworkIds.entries())
      updates.push(
        env.DB.prepare(
          "UPDATE artworks SET data=json_set(data,'$.position',?,'$.version',version+1),version=version+1 WHERE id=?",
        ).bind(position, artworkId),
      );
    await executeBatch(env, updates);
    return { ...item, version: v + 1 };
  }
  if (action === "permanent" && method === "DELETE") {
    if (!item.deletedAt) fail(409, "DELETE_FIRST", "请先将内容移至回收站");
    if (table === "collections") {
      if (
        await stmt(
          env,
          "SELECT id FROM artworks WHERE collection_id=? LIMIT 1",
          key,
        ).first()
      )
        fail(409, "COLLECTION_NOT_EMPTY", "请先永久删除此作品集内的作品");
      await stmt(
        env,
        "DELETE FROM collections WHERE id=? AND version=?",
        key,
        v,
      ).run();
    } else {
      const art = item as Artwork;
      await executeBatch(env, [
        env.DB.prepare(
          "UPDATE collections SET data=json_set(data,'$.coverId',NULL),version=version+1 WHERE json_extract(data,'$.coverId')=?",
        ).bind(key),
        env.DB.prepare("DELETE FROM artworks WHERE id=? AND version=?").bind(
          key,
          v,
        ),
        env.DB.prepare(
          "UPDATE collections SET version=version+1 WHERE id=?",
        ).bind(art.collectionId),
      ]);
      try {
        await cleanupAsset(env, art.assetId);
      } catch {
        return {
          deleted: true,
          cleanupPending: true,
          message:
            "记录已删除，图片服务清理失败，导出的资产记录保留以便重试清理",
        };
      }
    }
    return { deleted: true };
  }
  if (!action && method === "DELETE") {
    const result = await save(
      env,
      table,
      { ...item, deletedAt: new Date().toISOString(), status: "draft" },
      v,
    );
    if (table === "artworks")
      await stmt(
        env,
        "UPDATE collections SET version=version+1 WHERE id=?",
        (item as Artwork).collectionId,
      ).run();
    return result;
  }
  if (
    action &&
    ["publish", "unpublish", "restore"].includes(action) &&
    method === "POST"
  ) {
    let updated = { ...item };
    if (action === "restore") {
      if (!item.deletedAt) fail(409, "NOT_DELETED", "内容不在回收站中");
      if (
        table === "artworks" &&
        (await record(env, "collections", (item as Artwork).collectionId))
          .deletedAt
      )
        fail(409, "COLLECTION_DELETED", "请先恢复作品集");
      updated = { ...item, deletedAt: null, status: "draft" };
    } else if (action === "unpublish") updated.status = "draft";
    else {
      if (item.deletedAt) fail(409, "DELETED", "请先恢复内容");
      if (table === "artworks") {
        const art = item as Artwork;
        const asset = decode<Asset>(await assetRow(env, art.assetId));
        publishable(art, asset);
        if ((await record(env, "collections", art.collectionId)).deletedAt)
          fail(409, "COLLECTION_DELETED", "请先恢复作品集");
        await ensurePublic(env, art.assetId);
      } else {
        const collection = item as Collection;
        if (!collection.title.zh.trim() || !collection.title.en.trim())
          fail(409, "PUBLISH_PREREQUISITES", "请填写作品集的中英文标题");
        const arts = (
          await all<RecordRow>(
            env,
            "SELECT * FROM artworks WHERE collection_id=?",
            key,
          )
        )
          .map((r) => decode<Artwork>(r))
          .filter((a) => a.status === "published" && !a.deletedAt);
        const cover =
          arts.find((a) => a.id === collection.coverId) ||
          (!collection.coverId ? arts[0] : undefined);
        if (!cover)
          fail(
            409,
            "PUBLISH_PREREQUISITES",
            "作品集需要至少一件已发布作品，且封面必须已发布",
          );
        publishable(cover, decode<Asset>(await assetRow(env, cover.assetId)));
        await ensurePublic(env, cover.assetId);
        updated = { ...collection, coverId: cover.id };
      }
      updated.status = "published";
    }
    const result = await save(env, table, updated, v);
    if (table === "artworks" && action === "restore")
      await stmt(
        env,
        "UPDATE collections SET version=version+1 WHERE id=?",
        (item as Artwork).collectionId,
      ).run();
    return result;
  }
  if (!action && method === "PATCH") {
    if (item.deletedAt) fail(409, "DELETED", "请先恢复内容");
    if (table === "collections") {
      const { version: _, ...fields } = parse(
        collectionFields.partial().extend({ version }).strict(),
        body,
      );
      void _;
      if (fields.coverId) {
        const cover = (await record(
          env,
          "artworks",
          fields.coverId,
        )) as Artwork;
        if (
          cover.collectionId !== key ||
          cover.deletedAt ||
          (item.status === "published" && cover.status !== "published")
        )
          fail(400, "INVALID_COVER", "封面必须是该作品集中的有效作品");
      }
      const updated = { ...item, ...fields } as Collection;
      if (
        updated.status === "published" &&
        (!updated.title.zh.trim() || !updated.title.en.trim())
      )
        fail(409, "PUBLISH_PREREQUISITES", "已发布作品集需要中英文标题");
      await stmt(
        env,
        "UPDATE collections SET slug=?,data=?,version=version+1 WHERE id=? AND version=?",
        updated.slug,
        JSON.stringify({ ...updated, version: v + 1 }),
        key,
        v,
      ).run();
      return { ...updated, version: v + 1 };
    }
    // Asset and parent are immutable once created: create a new artwork to replace its file.
    const { version: _, ...fields } = parse(
      artworkFields
        .omit({ collectionId: true, assetId: true })
        .partial()
        .extend({ version })
        .strict(),
      body,
    );
    void _;
    const updated = { ...item, ...fields } as Artwork;
    if (updated.status === "published")
      publishable(updated, decode<Asset>(await assetRow(env, updated.assetId)));
    return save(env, table, updated, v);
  }
  return fail(404, "NOT_FOUND", "接口不存在");
}
const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const publicApi = path === "/api/public/gallery";
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (publicApi) {
      headers.set("Vary", "Origin");
      const origin = request.headers.get("Origin");
      const allowed = [
        env.PUBLIC_ORIGIN,
        ...(env.PUBLIC_ADDITIONAL_ORIGINS || "")
          .split(",")
          .map((value) => value.trim()),
      ].filter(Boolean);
      if (origin && allowed.includes(origin))
        headers.set("Access-Control-Allow-Origin", origin);
    }
    try {
      if (
        env.PUBLIC_ONLY === "true" &&
        (!publicApi || !["GET", "OPTIONS"].includes(request.method))
      )
        fail(404, "NOT_FOUND", "接口不存在");
      if (publicApi) {
        if (request.method === "OPTIONS") {
          headers.set("Access-Control-Allow-Methods", "GET");
          return new Response(null, { status: 204, headers });
        }
        if (request.method !== "GET") fail(404, "NOT_FOUND", "接口不存在");
        const limit = parse(
          z.coerce.number().int().min(1).max(100),
          url.searchParams.get("limit") || 24,
        );
        const cursor = parse(
          z.coerce.number().int().min(0).max(100000),
          url.searchParams.get("cursor") || 0,
        );
        return Response.json(
          projectPublic(
            await loadGallery(env, "public"),
            url.searchParams.get("slug") || undefined,
            limit,
            cursor,
            url.searchParams.get("artwork") || undefined,
          ),
          { headers },
        );
      }
      const email = await authenticate(request, env);
      if (path.startsWith("/api/admin")) {
        let result: unknown;
        if (request.method === "GET" && path === "/api/admin/me")
          result = { email };
        else if (request.method === "GET" && path === "/api/admin/gallery")
          result = await loadGallery(env, "admin");
        else if (request.method === "GET" && path === "/api/admin/export") {
          result = {
            ...(await loadGallery(env, "export")),
            exportedAt: new Date().toISOString(),
            providerAssets: await all<AssetRow>(env, "SELECT * FROM assets"),
          };
          headers.set(
            "Content-Disposition",
            'attachment; filename="gallery-metadata.json"',
          );
        } else if (["POST", "PATCH", "DELETE"].includes(request.method)) {
          checkOrigin(request);
          const body = await readBody(request);
          result = await withMutationLock(env, (lockedEnv) =>
            mutate(lockedEnv, path, request.method, body, email),
          );
        } else fail(404, "NOT_FOUND", "接口不存在");
        return Response.json(result, { headers });
      }
      if (env.ASSETS) {
        const response = await env.ASSETS.fetch(
          request as unknown as Parameters<typeof env.ASSETS.fetch>[0],
        );
        return new Response(response.body as unknown as BodyInit, {
          status: response.status,
          headers: {
            ...Object.fromEntries(response.headers),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return new Response("Admin build unavailable", { status: 404, headers });
    } catch (error) {
      if (error instanceof ApiError)
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status, headers },
        );
      if (
        error instanceof Error &&
        /CHECK constraint failed: valid=1/.test(error.message)
      )
        return Response.json(
          {
            error: {
              code: "LOCK_EXPIRED",
              message: "操作锁已过期，请刷新后重试",
            },
          },
          { status: 409, headers },
        );
      if (error instanceof Error && /UNIQUE constraint/.test(error.message))
        return Response.json(
          {
            error: {
              code: "DUPLICATE",
              message: "此标识已被使用，请修改后重试",
            },
          },
          { status: 409, headers },
        );
      console.error(
        "Gallery API failure",
        error instanceof Error ? error.message : "unknown",
      );
      return Response.json(
        { error: { code: "INTERNAL", message: "服务暂时不可用，请稍后重试" } },
        { status: 502, headers },
      );
    }
  },
};
export default worker;
