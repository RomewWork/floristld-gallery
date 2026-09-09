import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());

it("returns one artwork for retries with the same creation ID", async () => {
  const { mutate, readDemo } = await import("../src/lib/api");
  const data = await readDemo();
  const fields = {
    creationId: crypto.randomUUID(),
    collectionId: data.collections[0].id,
    assetId: data.assets[0].id,
  };
  const first = await mutate("/api/admin/artworks", "POST", fields);
  const second = await mutate("/api/admin/artworks", "POST", fields);
  expect(second).toEqual(first);
  expect((await readDemo()).artworks).toHaveLength(data.artworks.length + 1);
});

it("does not remove an image still referenced by an artwork", async () => {
  const { mutate, readDemo } = await import("../src/lib/api");
  const data = await readDemo();
  const id = data.artworks[0].assetId;
  await expect(
    mutate(`/api/admin/assets/${id}`, "DELETE"),
  ).rejects.toMatchObject({ status: 409 });
  expect((await readDemo()).assets.some((a) => a.id === id)).toBe(true);
});

it("cleans up an unreferenced demo image after artwork deletion", async () => {
  const { mutate, readDemo } = await import("../src/lib/api");
  const data = await readDemo();
  const id = data.artworks[0].assetId;
  for (const art of data.artworks.filter((a) => a.assetId === id)) {
    await mutate(`/api/admin/artworks/${art.id}`, "DELETE", {
      version: art.version,
    });
    await mutate(`/api/admin/artworks/${art.id}/permanent`, "DELETE", {
      version: art.version + 1,
    });
  }
  await mutate(`/api/admin/assets/${id}`, "DELETE");
  expect((await readDemo()).assets.some((a) => a.id === id)).toBe(false);
});

it("keeps both collections when two demo writes overlap", async () => {
  const { mutate, readDemo } = await import("../src/lib/api");
  await Promise.all(
    ["parallel-one", "parallel-two"].map((slug) =>
      mutate("/api/admin/collections", "POST", { slug }),
    ),
  );
  const data = await readDemo();
  expect(
    data.collections.filter((c) => c.slug.startsWith("parallel-")),
  ).toHaveLength(2);
});

it("rejects a stale collection reorder without changing persisted order", async () => {
  const { mutate, readDemo } = await import("../src/lib/api");
  const data = await readDemo();
  const ids = data.collections.map((c) => c.id).reverse();
  const versions = Object.fromEntries(
    data.collections.map((c) => [c.id, c.version]),
  );
  await mutate("/api/admin/collections/order", "POST", {
    collectionIds: ids,
    versions,
  });
  await expect(
    mutate("/api/admin/collections/order", "POST", {
      collectionIds: [...ids].reverse(),
      versions,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await readDemo()).collections
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((c) => c.id),
  ).toEqual(ids);
});
