import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { D1Database } from "@cloudflare/workers-types";
import worker from "../worker/index";
import {
  authenticate,
  checkOrigin,
  projectPublic,
  publishable,
  readBody,
  type Env,
} from "../worker/core";
import {
  verifyFile,
  hmac,
  signedUrl,
  type FileDetails,
  type Session,
} from "../worker/provider";
import type { GalleryData, Artwork, Asset, Collection } from "../src/lib/types";

const title = { zh: "花", en: "Flower" };
const asset: Asset = {
  id: "asset-1",
  fileId: "private-id",
  url: "https://ik.imagekit.io/test/test.jpg",
  width: 100,
  height: 100,
  bytes: 1000,
  verified: true,
  isPrivate: false,
};
const collection: Collection = {
  id: "collection-1",
  slug: "flowers",
  title,
  description: title,
  status: "published",
  position: 0,
  coverId: "art-1",
  deletedAt: null,
  version: 3,
};
const artwork: Artwork = {
  id: "art-1",
  collectionId: collection.id,
  assetId: asset.id,
  title,
  description: title,
  alt: title,
  year: "2026",
  status: "published",
  position: 0,
  deletedAt: null,
  version: 2,
};
const data: GalleryData = {
  collections: [collection],
  artworks: [artwork],
  assets: [asset],
  profile: {
    name: title,
    tagline: title,
    bio: title,
    email: "",
    instagram: "",
    contact: "",
  },
};

function database(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_gallery.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL("../migrations/0002_pending_publication.sql", import.meta.url),
      "utf8",
    ),
  );
  class Statement {
    constructor(
      readonly sql: string,
      readonly args: unknown[] = [],
    ) {}
    bind(...args: unknown[]) {
      return new Statement(this.sql, args);
    }
    async first() {
      return (
        db
          .prepare(this.sql)
          .get(...(this.args as (string | number | null)[])) || null
      );
    }
    async all() {
      return {
        results: db
          .prepare(this.sql)
          .all(...(this.args as (string | number | null)[])),
        success: true,
      };
    }
    async run() {
      const result = db
        .prepare(this.sql)
        .run(...(this.args as (string | number | null)[]));
      return { meta: { changes: Number(result.changes) }, success: true };
    }
  }
  return {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      db.exec("BEGIN");
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}
const providerEnv = {
  IMAGEKIT_PRIVATE_KEY: "test-secret",
  IMAGEKIT_PUBLIC_KEY: "test-public",
  IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/test",
};
function env(): Env {
  return {
    DB: database(),
    ENVIRONMENT: "development",
    DEV_AUTH: "true",
    ...providerEnv,
  };
}
async function request(
  environment: Env,
  path: string,
  method = "GET",
  body?: unknown,
  origin = "http://localhost",
) {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    environment,
  );
}
describe("Access identity boundary", () => {
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  beforeAll(async () => {
    ({ privateKey, publicKey } = await generateKeyPair("RS256"));
  });
  const config = {
    ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    ACCESS_AUD: "gallery",
    ADMIN_EMAILS: "owner@example.com",
  } as Env;
  async function token(overrides: Record<string, unknown> = {}) {
    return new SignJWT({
      email: "owner@example.com",
      iss: "https://team.cloudflareaccess.com",
      aud: "gallery",
      exp: Math.floor(Date.now() / 1000) + 300,
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256" })
      .sign(privateKey);
  }
  async function auth(overrides: Record<string, unknown> = {}) {
    return authenticate(
      new Request("https://admin.example.com/api/admin/me", {
        headers: { "Cf-Access-Jwt-Assertion": await token(overrides) },
      }),
      config,
      async () => publicKey,
    );
  }
  it("accepts a locally signed valid Access JWT", async () =>
    expect(await auth()).toBe("owner@example.com"));
  it.each([
    { aud: "other" },
    { iss: "https://evil.example" },
    { exp: 1 },
    { exp: undefined },
  ])("rejects bad claims %j", async (claims) =>
    expect(auth(claims)).rejects.toMatchObject({ status: 401 }),
  );
  it("rejects signed non-admin email", async () =>
    expect(auth({ email: "visitor@example.com" })).rejects.toMatchObject({
      status: 403,
    }));
  it("rejects a valid claim set signed by another key", async () => {
    const other = await generateKeyPair("RS256");
    await expect(
      authenticate(
        new Request("https://admin.example.com", {
          headers: { "Cf-Access-Jwt-Assertion": await token() },
        }),
        config,
        async () => other.publicKey,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("rejects missing configuration", async () =>
    expect(
      authenticate(new Request("https://admin.example.com"), {} as Env),
    ).rejects.toMatchObject({ status: 401 }));
  it("never enables dev bypass on production or remote host", async () => {
    for (const [host, environment] of [
      ["localhost", "production"],
      ["admin.example.com", "development"],
    ])
      await expect(
        authenticate(new Request(`https://${host}`), {
          ENVIRONMENT: environment,
          DEV_AUTH: "true",
        } as Env),
      ).rejects.toMatchObject({ status: 401 });
  });
  it("requires exact origin for mutations", () =>
    expect(() =>
      checkOrigin(
        new Request("https://admin.example.com", {
          headers: { Origin: "https://evil.example" },
        }),
      ),
    ).toThrow());
});
describe("public projection and publish prerequisites", () => {
  it("excludes deleted, draft, private and unverified artwork and provider identifiers", () => {
    const result = projectPublic({
      ...data,
      artworks: [
        artwork,
        { ...artwork, id: "draft", status: "draft" },
        { ...artwork, id: "deleted", deletedAt: "now" },
        { ...artwork, id: "private", assetId: "p" },
      ],
      assets: [asset, { ...asset, id: "p", isPrivate: true }],
    });
    expect(result.artworks.map((a) => a.id)).toEqual(["art-1"]);
    expect(result.assets[0].fileId).toBe("");
    expect(result.collections[0].version).toBe(0);
    expect(
      projectPublic({
        ...data,
        collections: [{ ...collection, status: "draft" }],
      }).artworks,
    ).toEqual([]);
    expect(
      projectPublic({ ...data, assets: [{ ...asset, verified: false }] })
        .assets,
    ).toEqual([]);
  });
  it("injects cover and selected artwork without moving the pagination cursor", () => {
    const result = projectPublic(
      {
        ...data,
        artworks: [
          artwork,
          { ...artwork, id: "art-2" },
          { ...artwork, id: "art-3" },
        ],
      },
      undefined,
      1,
      1,
      "art-3",
    );
    expect(result.artworks.map((a) => a.id)).toEqual([
      "art-2",
      "art-3",
      "art-1",
    ]);
    expect(result.nextCursor).toBe(2);
    expect(result.collections[0]).toMatchObject({ artworkCount: 3 });
  });
  it("sorts by position with stable ID tie-break before taking a page", () => {
    const result = projectPublic(
      {
        ...data,
        collections: [{ ...collection, coverId: null }],
        artworks: [
          { ...artwork, id: "z", position: 2 },
          { ...artwork, id: "b", position: 1 },
          { ...artwork, id: "a", position: 1 },
        ],
      },
      undefined,
      1,
      0,
    );
    expect(result.artworks.map((a) => a.id)).toEqual(["a"]);
    expect(result.nextCursor).toBe(1);
  });
  it("requires verified image and bilingual title/alt", () => {
    expect(() => publishable(artwork, asset)).not.toThrow();
    expect(() => publishable(artwork, { ...asset, verified: false })).toThrow();
    expect(() =>
      publishable({ ...artwork, alt: { zh: "", en: "Flower" } }, asset),
    ).toThrow();
  });
});
describe("upload verification", () => {
  const session: Session = {
    id: "upload-1",
    owner: "owner@example.com",
    folder: "/gallery/private/upload-1",
    file_name: "upload-1.jpg",
    bytes: 1000,
    mime: "image/jpeg",
    expires: 100,
    state: "pending",
    asset_id: null,
    file_id: null,
  };
  const details: FileDetails = {
    fileId: "ik-id",
    name: session.file_name,
    filePath: `${session.folder}/${session.file_name}`,
    url: "https://ik.imagekit.io/test/gallery/private/upload-1/upload-1.jpg",
    size: 1000,
    width: 100,
    height: 100,
    fileType: "image",
    isPrivateFile: true,
  };
  it("accepts only provider-verified assigned private image", () =>
    expect(verifyFile(details, session, providerEnv as Env)).toMatchObject({
      verified: true,
      isPrivate: true,
      fileId: "ik-id",
    }));
  it.each([
    { filePath: "/somebody-elses/file.jpg" },
    { size: 1001 },
    { width: 3841 },
    { height: 0 },
    { fileType: "non-image" },
    { isPrivateFile: false },
    { url: "https://evil.example/file.jpg" },
    { mime: "image/png" },
  ])("rejects unsafe details %j", (changes) =>
    expect(() =>
      verifyFile({ ...details, ...changes }, session, providerEnv as Env),
    ).toThrow(),
  );
  it("uses standard HMAC SHA1 and short-lived signed URLs", async () => {
    expect(
      await hmac("key", "The quick brown fox jumps over the lazy dog"),
    ).toBe("de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9");
    const result = new URL(await signedUrl(details.url, providerEnv as Env));
    expect(result.searchParams.get("ik-s")).toMatch(/^[a-f0-9]{40}$/);
    expect(Number(result.searchParams.get("ik-t"))).toBeGreaterThan(
      Date.now() / 1000,
    );
  });
});
describe("Worker and real SQLite mutation behavior", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("creates, enforces version, soft deletes and restores a collection", async () => {
    const e = env();
    const created = await request(e, "/api/admin/collections", "POST", {
      slug: "test",
      title,
      description: title,
    });
    expect(created.status).toBe(200);
    const c = (await created.json()) as Collection;
    expect(
      (
        await request(e, `/api/admin/collections/${c.id}`, "PATCH", {
          version: 99,
          title,
        })
      ).status,
    ).toBe(409);
    const deleted = (await (
      await request(e, `/api/admin/collections/${c.id}`, "DELETE", {
        version: 1,
      })
    ).json()) as Collection;
    expect(deleted.deletedAt).toBeTruthy();
    expect(deleted.version).toBe(2);
    const restored = (await (
      await request(e, `/api/admin/collections/${c.id}/restore`, "POST", {
        version: 2,
      })
    ).json()) as Collection;
    expect(restored.status).toBe("draft");
    expect(restored.deletedAt).toBeNull();
  });
  it("cannot publish an empty collection or bypass origin checks", async () => {
    const e = env();
    const c = (await (
      await request(e, "/api/admin/collections", "POST", {
        slug: "test",
        title,
        description: title,
      })
    ).json()) as Collection;
    expect(
      (
        await request(e, `/api/admin/collections/${c.id}/publish`, "POST", {
          version: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          e,
          "/api/admin/collections",
          "POST",
          { slug: "test2", title, description: title },
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
  });
  it("enforces exact ordering membership and updates versions atomically", async () => {
    const e = env();
    const c = (await (
      await request(e, "/api/admin/collections", "POST", {
        slug: "test",
        title,
        description: title,
      })
    ).json()) as Collection;
    const aid = crypto.randomUUID();
    await e.DB.prepare("INSERT INTO assets(id,file_id,data) VALUES(?,?,?)")
      .bind(aid, "provider", JSON.stringify({ ...asset, id: aid }))
      .run();
    const a = (await (
      await request(e, "/api/admin/artworks", "POST", {
        collectionId: c.id,
        assetId: aid,
        title,
        description: title,
        alt: title,
        year: "2026",
      })
    ).json()) as Artwork;
    expect(
      (
        await request(e, `/api/admin/collections/${c.id}/order`, "POST", {
          version: 2,
          artworkIds: [],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(e, `/api/admin/collections/${c.id}/order`, "POST", {
          version: 2,
          artworkIds: [a.id],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(e, `/api/admin/collections/${c.id}/order`, "POST", {
          version: 2,
          artworkIds: [a.id],
        })
      ).status,
    ).toBe(409);
    const g = (await (
      await request(e, "/api/admin/export")
    ).json()) as GalleryData;
    expect(g.artworks[0].position).toBe(0);
    expect(g.artworks[0].version).toBe(2);
  });
  it("reorders collections with exact membership and rejects stale administrator versions", async () => {
    const e = env();
    const first = (await (
      await request(e, "/api/admin/collections", "POST", {
        slug: "first",
        title,
        description: title,
      })
    ).json()) as Collection;
    const second = (await (
      await request(e, "/api/admin/collections", "POST", {
        slug: "second",
        title,
        description: title,
      })
    ).json()) as Collection;
    const versions = { [first.id]: 1, [second.id]: 1 };
    expect(
      (
        await request(e, "/api/admin/collections/order", "POST", {
          collectionIds: [first.id],
          versions,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(e, "/api/admin/collections/order", "POST", {
          collectionIds: [first.id, first.id],
          versions,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(e, "/api/admin/collections/order", "POST", {
          collectionIds: [second.id, first.id],
          versions,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(e, "/api/admin/collections/order", "POST", {
          collectionIds: [first.id, second.id],
          versions,
        })
      ).status,
    ).toBe(409);
    const gallery = (await (
      await request(e, "/api/admin/export")
    ).json()) as GalleryData;
    expect(gallery.collections.map((c) => c.id)).toEqual([second.id, first.id]);
    expect(gallery.collections.map((c) => c.version)).toEqual([2, 2]);
  });
  it("atomically blocks mutations when another operation owns the lock", async () => {
    const e = env();
    await e.DB.prepare("INSERT INTO mutation_lock VALUES(1,?,?)")
      .bind("other", Math.floor(Date.now() / 1000) + 100)
      .run();
    const response = await request(e, "/api/admin/collections", "POST", {
      slug: "test",
      title,
      description: title,
    });
    expect(response.status).toBe(409);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("MUTATION_BUSY");
  });
  it("reserves both copies and rejects capacity overflow", async () => {
    const e = env();
    await e.DB.prepare("INSERT INTO assets(id,file_id,data) VALUES(?,?,?)")
      .bind("full", "full", JSON.stringify({ ...asset, bytes: 1249000000 }))
      .run();
    const response = await request(e, "/api/admin/uploads", "POST", {
      fileName: "photo.jpg",
      bytes: 2000000,
      mime: "image/jpeg",
    });
    expect(response.status).toBe(409);
  });
  it("returns an idempotent completed session only to its owner and same file", async () => {
    const e = env();
    await e.DB.prepare("INSERT INTO assets(id,file_id,data) VALUES(?,?,?)")
      .bind(asset.id, asset.fileId, JSON.stringify(asset))
      .run();
    await e.DB.prepare(
      "INSERT INTO upload_sessions(id,owner,file_name,folder,bytes,mime,expires,state,asset_id,file_id) VALUES(?,?,?,?,?,?,?,'complete',?,?)",
    )
      .bind(
        "session",
        "local@localhost",
        "a.jpg",
        "/gallery",
        1000,
        "image/jpeg",
        1,
        asset.id,
        asset.fileId,
      )
      .run();
    expect(
      (
        await request(e, "/api/admin/uploads/session/complete", "POST", {
          fileId: asset.fileId,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(e, "/api/admin/uploads/session/complete", "POST", {
          fileId: "different",
        })
      ).status,
    ).toBe(409);
    await e.DB.prepare("UPDATE upload_sessions SET owner=? WHERE id=?")
      .bind("other@example.com", "session")
      .run();
    expect(
      (
        await request(e, "/api/admin/uploads/session/complete", "POST", {
          fileId: asset.fileId,
        })
      ).status,
    ).toBe(404);
  });
  it("verifies provider details before completing, releases failed claim, and persists successful retry", async () => {
    const e = env();
    const ticket = (await (
      await request(e, "/api/admin/uploads", "POST", {
        fileName: "a.jpg",
        bytes: 1000,
        mime: "image/jpeg",
      })
    ).json()) as { sessionId: string; fileName: string; folder: string };
    const details = {
      fileId: "uploaded-id",
      name: ticket.fileName,
      filePath: `${ticket.folder}/${ticket.fileName}`,
      url: `https://ik.imagekit.io/test${ticket.folder}/${ticket.fileName}`,
      size: 1000,
      width: 100,
      height: 100,
      fileType: "image",
      isPrivateFile: true,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ...details, isPrivateFile: false }),
        ),
    );
    expect(
      (
        await request(
          e,
          `/api/admin/uploads/${ticket.sessionId}/complete`,
          "POST",
          { fileId: details.fileId },
        )
      ).status,
    ).toBe(400);
    expect(
      await e.DB.prepare("SELECT state FROM upload_sessions WHERE id=?")
        .bind(ticket.sessionId)
        .first(),
    ).toMatchObject({ state: "pending" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(details))
        .mockResolvedValueOnce(
          new Response(null, {
            // ImageKit's delivery layer may use a generic response type even
            // after its file-details API has verified the uploaded image.
            headers: { "Content-Type": "application/octet-stream" },
          }),
        ),
    );
    expect(
      (
        await request(
          e,
          `/api/admin/uploads/${ticket.sessionId}/complete`,
          "POST",
          { fileId: details.fileId },
        )
      ).status,
    ).toBe(200);
    expect(
      await e.DB.prepare("SELECT state FROM upload_sessions WHERE id=?")
        .bind(ticket.sessionId)
        .first(),
    ).toMatchObject({ state: "complete" });
    expect(vi.mocked(fetch).mock.calls[1]?.[1]).toMatchObject({
      method: "HEAD",
      redirect: "follow",
    });
    expect(
      (
        await request(
          e,
          `/api/admin/uploads/${ticket.sessionId}/complete`,
          "POST",
          { fileId: details.fileId },
        )
      ).status,
    ).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("reconciles an expired owner-bound upload without renewing authorization", async () => {
    const e = env();
    const ticket = (await (
      await request(e, "/api/admin/uploads", "POST", {
        fileName: "a.jpg",
        bytes: 1000,
        mime: "image/jpeg",
      })
    ).json()) as { sessionId: string; fileName: string; folder: string };
    await e.DB.prepare("UPDATE upload_sessions SET expires=1 WHERE id=?")
      .bind(ticket.sessionId)
      .run();
    const details = {
      fileId: "recovered",
      name: ticket.fileName,
      filePath: `${ticket.folder}/${ticket.fileName}`,
      url: `https://ik.imagekit.io/test${ticket.folder}/${ticket.fileName}`,
      size: 1000,
      width: 100,
      height: 100,
      fileType: "image",
      isPrivateFile: true,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(Response.json({ ...details, size: 999 })),
    );
    expect(
      (
        await request(
          e,
          `/api/admin/uploads/${ticket.sessionId}/complete`,
          "POST",
          { fileId: details.fileId },
        )
      ).status,
    ).toBe(400);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(details))
        .mockResolvedValueOnce(
          new Response(null, { headers: { "content-type": "image/jpeg" } }),
        ),
    );
    expect(
      (
        await request(
          e,
          `/api/admin/uploads/${ticket.sessionId}/complete`,
          "POST",
          { fileId: details.fileId },
        )
      ).status,
    ).toBe(200);
    expect(
      await e.DB.prepare("SELECT expires,state FROM upload_sessions WHERE id=?")
        .bind(ticket.sessionId)
        .first(),
    ).toEqual({ expires: 1, state: "complete" });
    expect(
      (
        await request(
          e,
          `/api/admin/uploads/${ticket.sessionId}/complete`,
          "POST",
          { fileId: details.fileId },
        )
      ).status,
    ).toBe(200);
    await e.DB.prepare(
      "UPDATE upload_sessions SET owner='other@example.com' WHERE id=?",
    )
      .bind(ticket.sessionId)
      .run();
    expect(
      (
        await request(
          e,
          `/api/admin/uploads/${ticket.sessionId}/complete`,
          "POST",
          { fileId: details.fileId },
        )
      ).status,
    ).toBe(404);
  });
  it("deduplicates artwork creation retries and rejects reuse for a different asset", async () => {
    const e = env();
    const c = (await (
      await request(e, "/api/admin/collections", "POST", {
        slug: "idempotent",
        title,
        description: title,
      })
    ).json()) as Collection;
    const aid = crypto.randomUUID();
    await e.DB.prepare("INSERT INTO assets(id,file_id,data) VALUES(?,?,?)")
      .bind(aid, "private", JSON.stringify({ ...asset, id: aid }))
      .run();
    const fields = {
      creationId: crypto.randomUUID(),
      collectionId: c.id,
      assetId: aid,
      title,
      description: title,
      alt: title,
      year: "2026",
    };
    const first = await request(e, "/api/admin/artworks", "POST", fields);
    expect(first.status).toBe(200);
    const created = (await first.json()) as Artwork;
    expect(
      await (await request(e, "/api/admin/artworks", "POST", fields)).json(),
    ).toEqual(created);
    expect(
      await e.DB.prepare("SELECT COUNT(*) AS count FROM artworks").first(),
    ).toEqual({ count: 1 });
    expect(
      await e.DB.prepare("SELECT version FROM collections WHERE id=?")
        .bind(c.id)
        .first(),
    ).toEqual({ version: 2 });
    expect(
      (
        await request(e, "/api/admin/artworks", "POST", {
          ...fields,
          assetId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(e, "/api/admin/artworks", "POST", {
          ...fields,
          creationId: "bad",
        })
      ).status,
    ).toBe(400);
  });
  it.each(["rejected", "unknown", "unknown-then-rejected"])(
    "cleans only definitive absent public uploads: %s",
    async (failure) => {
      const e = env();
      const c = (await (
        await request(e, "/api/admin/collections", "POST", {
          slug: "cleanup",
          title,
          description: title,
        })
      ).json()) as Collection;
      const aid = crypto.randomUUID();
      await e.DB.prepare("INSERT INTO assets(id,file_id,data) VALUES(?,?,?)")
        .bind(aid, "private", JSON.stringify({ ...asset, id: aid }))
        .run();
      const a = (await (
        await request(e, "/api/admin/artworks", "POST", {
          collectionId: c.id,
          assetId: aid,
          title,
          description: title,
          alt: title,
          year: "2026",
        })
      ).json()) as Artwork;
      vi.stubGlobal(
        "fetch",
        failure === "rejected"
          ? vi.fn().mockResolvedValue(new Response(null, { status: 429 }))
          : vi.fn().mockRejectedValue(new TypeError("lost response")),
      );
      expect(
        (
          await request(e, `/api/admin/artworks/${a.id}/publish`, "POST", {
            version: 1,
          })
        ).status,
      ).toBe(failure === "rejected" ? 429 : 502);
      if (failure === "unknown-then-rejected") {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
        );
        expect(
          (
            await request(e, `/api/admin/artworks/${a.id}/publish`, "POST", {
              version: 1,
            })
          ).status,
        ).toBe(429);
      }
      await request(e, `/api/admin/artworks/${a.id}`, "DELETE", { version: 1 });
      vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) =>
        init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : Response.json([]),
      );
      const cleanup = await (
        await request(e, `/api/admin/artworks/${a.id}/permanent`, "DELETE", {
          version: 2,
        })
      ).json();
      if (failure === "rejected") expect(cleanup).toEqual({ deleted: true });
      else
        expect(cleanup).toMatchObject({ deleted: true, cleanupPending: true });
      const remaining = await e.DB.prepare("SELECT id FROM assets WHERE id=?")
        .bind(aid)
        .first();
      if (failure === "rejected") expect(remaining).toBeNull();
      else expect(remaining).toEqual({ id: aid });
    },
  );
  it("never publishes after a failed public copy and successfully retries verified copy", async () => {
    const e = env();
    const c = (await (
      await request(e, "/api/admin/collections", "POST", {
        slug: "test",
        title,
        description: title,
      })
    ).json()) as Collection;
    const aid = crypto.randomUUID();
    await e.DB.prepare("INSERT INTO assets(id,file_id,data) VALUES(?,?,?)")
      .bind(
        aid,
        "private",
        JSON.stringify({ ...asset, id: aid, isPrivate: true }),
      )
      .run();
    const a = (await (
      await request(e, "/api/admin/artworks", "POST", {
        collectionId: c.id,
        assetId: aid,
        title,
        description: title,
        alt: title,
        year: "2026",
      })
    ).json()) as Artwork;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("upstream failure", { status: 503 })),
    );
    expect(
      (
        await request(e, `/api/admin/artworks/${a.id}/publish`, "POST", {
          version: 1,
        })
      ).status,
    ).toBe(502);
    expect(
      JSON.parse(
        (await e.DB.prepare("SELECT data FROM artworks WHERE id=?")
          .bind(a.id)
          .first<{ data: string }>())!.data,
      ).status,
    ).toBe("draft");
    const copy = {
      fileId: "public-id",
      name: `${aid}.jpg`,
      filePath: `/gallery/public/${aid}.jpg`,
      url: `https://ik.imagekit.io/test/gallery/public/${aid}.jpg`,
      size: 1000,
      width: 100,
      height: 100,
      fileType: "image",
      isPrivateFile: false,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(copy))
        .mockResolvedValueOnce(Response.json(copy)),
    );
    expect(
      (
        await request(e, `/api/admin/artworks/${a.id}/publish`, "POST", {
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      await e.DB.prepare("SELECT public_file_id FROM assets WHERE id=?")
        .bind(aid)
        .first(),
    ).toMatchObject({ public_file_id: "public-id" });
    expect(
      (
        await request(e, `/api/admin/collections/${c.id}/publish`, "POST", {
          version: 2,
        })
      ).status,
    ).toBe(200);
    const publicGallery = (await (
      await request(e, "/api/public/gallery")
    ).json()) as GalleryData;
    expect(publicGallery.assets[0].fileId).toBe("");
    expect(publicGallery.assets[0].url).toBe(copy.url);
  });
  it("fences an expired mutation after another worker takes the lease", async () => {
    const e = env();
    const c = (await (
      await request(e, "/api/admin/collections", "POST", {
        slug: "test",
        title,
        description: title,
      })
    ).json()) as Collection;
    const aid = crypto.randomUUID();
    await e.DB.prepare("INSERT INTO assets(id,file_id,data) VALUES(?,?,?)")
      .bind(
        aid,
        "private",
        JSON.stringify({ ...asset, id: aid, isPrivate: true }),
      )
      .run();
    const a = (await (
      await request(e, "/api/admin/artworks", "POST", {
        collectionId: c.id,
        assetId: aid,
        title,
        description: title,
        alt: title,
        year: "2026",
      })
    ).json()) as Artwork;
    const copy = {
      fileId: "public-id",
      name: `${aid}.jpg`,
      filePath: `/gallery/public/${aid}.jpg`,
      url: `https://ik.imagekit.io/test/gallery/public/${aid}.jpg`,
      size: 1000,
      width: 100,
      height: 100,
      fileType: "image",
      isPrivateFile: false,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(async () => {
          await e.DB.prepare("UPDATE mutation_lock SET token=? WHERE id=1")
            .bind("new-worker")
            .run();
          return Response.json(copy);
        })
        .mockResolvedValueOnce(Response.json(copy)),
    );
    expect(
      (
        await request(e, `/api/admin/artworks/${a.id}/publish`, "POST", {
          version: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      await e.DB.prepare("SELECT public_file_id FROM assets WHERE id=?")
        .bind(aid)
        .first(),
    ).toMatchObject({ public_file_id: null });
    expect(
      await e.DB.prepare("SELECT token FROM mutation_lock WHERE id=1").first(),
    ).toMatchObject({ token: "new-worker" });
  });
  it("retains shared files and supports cleanup retry after provider deletion fails", async () => {
    const e = env();
    const c = (await (
      await request(e, "/api/admin/collections", "POST", {
        slug: "test",
        title,
        description: title,
      })
    ).json()) as Collection;
    const aid = crypto.randomUUID();
    await e.DB.prepare("INSERT INTO assets(id,file_id,data) VALUES(?,?,?)")
      .bind(
        aid,
        "private",
        JSON.stringify({ ...asset, id: aid, isPrivate: true }),
      )
      .run();
    const fields = {
      collectionId: c.id,
      assetId: aid,
      title,
      description: title,
      alt: title,
      year: "2026",
    };
    const first = (await (
      await request(e, "/api/admin/artworks", "POST", fields)
    ).json()) as Artwork;
    const second = (await (
      await request(e, "/api/admin/artworks", "POST", fields)
    ).json()) as Artwork;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
    );
    await request(e, `/api/admin/artworks/${first.id}`, "DELETE", {
      version: 1,
    });
    expect(
      (
        await request(
          e,
          `/api/admin/artworks/${first.id}/permanent`,
          "DELETE",
          { version: 2 },
        )
      ).status,
    ).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    await request(e, `/api/admin/artworks/${second.id}`, "DELETE", {
      version: 1,
    });
    expect(
      await (
        await request(
          e,
          `/api/admin/artworks/${second.id}/permanent`,
          "DELETE",
          { version: 2 },
        )
      ).json(),
    ).toMatchObject({ deleted: true, cleanupPending: true });
    expect(
      (await request(e, "/api/admin/artworks", "POST", fields)).status,
    ).toBe(409);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    expect(
      (await request(e, `/api/admin/assets/${aid}`, "DELETE", {})).status,
    ).toBe(200);
    expect(
      await e.DB.prepare("SELECT id FROM assets WHERE id=?").bind(aid).first(),
    ).toBeNull();
  });
  it("cleans a durably recorded public copy when upload succeeds but details verification fails", async () => {
    const e = env();
    const c = (await (
      await request(e, "/api/admin/collections", "POST", {
        slug: "test",
        title,
        description: title,
      })
    ).json()) as Collection;
    const aid = crypto.randomUUID();
    await e.DB.prepare("INSERT INTO assets(id,file_id,data) VALUES(?,?,?)")
      .bind(
        aid,
        "private-id",
        JSON.stringify({ ...asset, id: aid, isPrivate: true }),
      )
      .run();
    const a = (await (
      await request(e, "/api/admin/artworks", "POST", {
        collectionId: c.id,
        assetId: aid,
        title,
        description: title,
        alt: title,
        year: "2026",
      })
    ).json()) as Artwork;
    const copy = {
      fileId: "pending-public",
      name: `${aid}.jpg`,
      filePath: `/gallery/public/${aid}.jpg`,
      url: `https://ik.imagekit.io/test/gallery/public/${aid}.jpg`,
      size: 1000,
      width: 100,
      height: 100,
      fileType: "image",
      isPrivateFile: false,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(copy))
        .mockResolvedValueOnce(new Response("failed details", { status: 503 })),
    );
    expect(
      (
        await request(e, `/api/admin/artworks/${a.id}/publish`, "POST", {
          version: 1,
        })
      ).status,
    ).toBe(502);
    expect(
      await e.DB.prepare(
        "SELECT pending_public_file_id,public_url,public_path FROM assets WHERE id=?",
      )
        .bind(aid)
        .first(),
    ).toEqual({
      pending_public_file_id: "pending-public",
      public_url: null,
      public_path: copy.filePath,
    });
    await request(e, `/api/admin/artworks/${a.id}`, "DELETE", { version: 1 });
    const calls = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", calls);
    expect(
      await (
        await request(e, `/api/admin/artworks/${a.id}/permanent`, "DELETE", {
          version: 2,
        })
      ).json(),
    ).toEqual({ deleted: true });
    expect(calls.mock.calls.map(([url]) => url)).toEqual([
      "https://api.imagekit.io/v1/files/pending-public",
      "https://api.imagekit.io/v1/files/private-id",
    ]);
  });
  it("reconciles an unknown publication by exact deterministic path and never deletes a near match", async () => {
    const e = env();
    const aid = crypto.randomUUID();
    const path = `/gallery/public/${aid}.jpg`;
    await e.DB.prepare(
      "INSERT INTO assets(id,file_id,data,public_path) VALUES(?,?,?,?)",
    )
      .bind(
        aid,
        "private-id",
        JSON.stringify({ ...asset, id: aid, isPrivate: true }),
        path,
      )
      .run();
    const calls = vi.fn().mockResolvedValueOnce(
      Response.json([
        {
          fileId: "unrelated",
          name: `${aid}.jpg`,
          filePath: `/another/${aid}.jpg`,
        },
      ]),
    );
    vi.stubGlobal("fetch", calls);
    expect(
      (await request(e, `/api/admin/assets/${aid}`, "DELETE", {})).status,
    ).toBe(502);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(
      await e.DB.prepare("SELECT id FROM assets WHERE id=?").bind(aid).first(),
    ).toMatchObject({ id: aid });
    const recovered = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([
          { fileId: "recovered-public", name: `${aid}.jpg`, filePath: path },
        ]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", recovered);
    expect(
      (await request(e, `/api/admin/assets/${aid}`, "DELETE", {})).status,
    ).toBe(200);
    expect(recovered.mock.calls[1][0]).toBe(
      "https://api.imagekit.io/v1/files/recovered-public",
    );
    expect(recovered.mock.calls[2][0]).toBe(
      "https://api.imagekit.io/v1/files/private-id",
    );
  });
  it("limits public CORS and rejects oversized JSON bodies", async () => {
    const e = { ...env(), PUBLIC_ORIGIN: "https://gallery.example.com" };
    expect(
      (
        await request(
          e,
          "/api/public/gallery",
          "GET",
          undefined,
          "https://evil.example",
        )
      ).headers.has("Access-Control-Allow-Origin"),
    ).toBe(false);
    expect(
      (
        await request(
          e,
          "/api/public/gallery",
          "GET",
          undefined,
          e.PUBLIC_ORIGIN,
        )
      ).headers.get("Access-Control-Allow-Origin"),
    ).toBe(e.PUBLIC_ORIGIN);
    await expect(
      readBody(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ x: "x".repeat(40000) }),
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("public-only deployment rejects admin and assets even when authentication would succeed", async () => {
    const e = { ...env(), PUBLIC_ONLY: "true" };
    expect((await request(e, "/api/admin/me")).status).toBe(404);
    expect((await request(e, "/admin/")).status).toBe(404);
    expect(
      (
        await request(e, "/api/admin/collections", "POST", {
          slug: "forbidden",
          title,
          description: title,
        })
      ).status,
    ).toBe(404);
    expect((await request(e, "/api/public/gallery", "POST", {})).status).toBe(
      404,
    );
    expect((await request(e, "/api/public/gallery")).status).toBe(200);
    expect((await request(e, "/api/public/gallery", "OPTIONS")).status).toBe(
      204,
    );
  });
  it("reports recorded originals/copies and remaining reservations only to administrators", async () => {
    const e = env();
    await e.DB.prepare(
      "INSERT INTO assets(id,file_id,data,public_bytes) VALUES(?,?,?,?)",
    )
      .bind(asset.id, asset.fileId, JSON.stringify(asset), 1000)
      .run();
    await e.DB.prepare("INSERT INTO assets(id,file_id,data) VALUES(?,?,?)")
      .bind(
        "private",
        "private",
        JSON.stringify({ ...asset, id: "private", bytes: 2000 }),
      )
      .run();
    await request(e, "/api/admin/uploads", "POST", {
      fileName: "pending.jpg",
      bytes: 3000,
      mime: "image/jpeg",
    });
    const response = (await (
      await request(e, "/api/admin/gallery")
    ).json()) as GalleryData & {
      usage: { storedBytes: number; reservedBytes: number };
    };
    expect(response.usage).toEqual({ storedBytes: 4000, reservedBytes: 8000 });
    expect(
      await (await request(e, "/api/public/gallery")).json(),
    ).not.toHaveProperty("usage");
  });
});
