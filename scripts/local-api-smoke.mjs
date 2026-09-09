import assert from "node:assert/strict";
const origin = "http://127.0.0.1:8787";
async function request(path, method = "GET", body) {
  const response = await fetch(`${origin}/api/${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(response.ok, true, JSON.stringify(data));
  return data;
}
assert.equal((await request("admin/me")).email, "local@localhost");
const before = await request("public/gallery");
assert.ok(Array.isArray(before.collections));
const created = await request("admin/collections", "POST", {
  slug: `local-smoke-${Date.now()}`,
  title: { zh: "本地接口验收", en: "Local API smoke" },
  description: { zh: "仅用于本地测试", en: "Local test only" },
});
assert.equal(created.status, "draft");
assert.equal(
  (await request("public/gallery")).collections.some(
    (c) => c.id === created.id,
  ),
  false,
);
const edited = await request(`admin/collections/${created.id}`, "PATCH", {
  version: created.version,
  title: { zh: "本地编辑已验证", en: "Local edit verified" },
});
assert.equal(edited.title.en, "Local edit verified");
const trashed = await request(`admin/collections/${created.id}`, "DELETE", {
  version: edited.version,
});
assert.ok(trashed.deletedAt);
const restored = await request(
  `admin/collections/${created.id}/restore`,
  "POST",
  { version: trashed.version },
);
assert.equal(restored.status, "draft");
assert.equal(restored.deletedAt, null);
const again = await request(`admin/collections/${created.id}`, "DELETE", {
  version: restored.version,
});
await request(`admin/collections/${created.id}/permanent`, "DELETE", {
  version: again.version,
});
assert.equal(
  (await request("admin/gallery")).collections.some((c) => c.id === created.id),
  false,
);
console.log(
  "Local Worker/D1 smoke passed: public read, local auth, draft isolation, CRUD, trash/restore, cleanup of own test collection.",
);
