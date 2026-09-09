import { test, expect } from "@playwright/test";
test("touch swipe switches artworks and pinch zoom enlarges the lightbox image", async ({
  page,
}) => {
  await page.goto("/zh/collection/?slug=botanical-dreams&artwork=art-1");
  await expect(page.getByRole("dialog")).toBeVisible();
  const box = (await page.locator(".lightbox-stage").boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: x + 80, y, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x - 80, y, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page).toHaveURL(/artwork=art-4/);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: x - 30, y, id: 1 },
      { x: x + 30, y, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x - 40, y, id: 1 },
      { x: x + 40, y, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x - 80, y, id: 1 },
      { x: x + 80, y, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() =>
      page
        .locator(".lightbox-stage img")
        .evaluate((img) => new DOMMatrix(getComputedStyle(img).transform).a),
    )
    .toBeGreaterThan(1);
  await cdp.detach();
});
test("failed artwork preview has no nested buttons and lightbox can retry", async ({
  page,
}) => {
  let unavailable = true;
  await page.route("**/art/plate-1.svg", (route) =>
    unavailable ? route.abort() : route.continue(),
  );
  await page.goto("/zh/collection/?slug=botanical-dreams");
  await expect(
    page.locator(".artwork-button .image-missing").first(),
  ).toBeVisible();
  expect(await page.locator(".artwork-button button").count()).toBe(0);
  await page.locator(".artwork-button").first().click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  unavailable = false;
  await page.getByRole("dialog").getByRole("alert").getByRole("button").click();
  await expect(page.getByRole("dialog").getByRole("alert")).not.toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".lightbox-stage img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
});
test("upload refresh failure is visible and does not freeze the queue", async ({
  page,
}) => {
  await page.goto("/admin/");
  await page
    .getByRole("button", { name: "花与未完成的梦", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "添加作品", exact: false }).click();
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 80;
    c.height = 100;
    c.getContext("2d")!.fillRect(0, 0, 80, 100);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "refresh.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await expect(page.getByText("待上传", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "中文标题", exact: true })
    .fill("刷新恢复作品");
  await page
    .getByRole("textbox", { name: "English title", exact: true })
    .fill("Refresh recovery artwork");
  await page.evaluate(() => {
    let failNextRead = false;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        value?.artworks?.some(
          (a: { title: { en: string } }) =>
            a.title.en === "Refresh recovery artwork",
        )
      )
        failNextRead = true;
      return put.call(this, value, key);
    };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if (failNextRead && mode !== "readwrite") {
        failNextRead = false;
        throw new Error("Simulated refresh failure");
      }
      return transaction.call(this, names, mode, options);
    };
  });
  await page.getByRole("button", { name: "上传至合集", exact: true }).click();
  await expect(page.locator(".upload-refresh-error")).toBeVisible();
  await expect(page.locator("input[type=file]")).toBeEnabled();
  await page.locator(".upload-refresh-error").getByRole("button").click();
  await expect(page.locator(".upload-refresh-error")).not.toBeVisible();
  await expect(
    page.locator(".admin-art-card").filter({ hasText: "刷新恢复作品" }),
  ).toHaveCount(1);
});
test("batch upload preserves two children and handles a greater-than-10MB source plus transparency", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/admin/");
  await page
    .getByRole("button", { name: "花与未完成的梦", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "添加作品", exact: false }).click();
  const fixtures = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 2048;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(2048, 2048);
    let seed = 731;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels.data[i + channel] = seed >>> 24;
      }
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const large = canvas.toDataURL("image/png").split(",")[1];
    canvas.width = 240;
    canvas.height = 300;
    context.fillStyle = "#457963";
    context.fillRect(40, 50, 120, 160);
    return { large, transparent: canvas.toDataURL("image/png").split(",")[1] };
  });
  const large = Buffer.from(fixtures.large, "base64");
  expect(large.length).toBeGreaterThan(10 * 1024 * 1024);
  await page.locator("input[type=file]").setInputFiles([
    { name: "large-noise.png", mimeType: "image/png", buffer: large },
    {
      name: "transparent.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixtures.transparent, "base64"),
    },
  ]);
  await expect(page.getByText("待上传", { exact: true })).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("textbox", { name: "中文标题", exact: true })
      .nth(i)
      .fill(`批量作品${i}`);
    await page
      .getByRole("textbox", { name: "English title", exact: true })
      .nth(i)
      .fill(`Batch artwork ${i}`);
  }
  await page.getByRole("button", { name: "上传至合集", exact: true }).click();
  await expect(page.getByText("已添加为草稿", { exact: true })).toHaveCount(2);
  await page.reload();
  await page
    .getByRole("button", { name: "花与未完成的梦", exact: true })
    .first()
    .click();
  await expect(page.locator(".admin-art-card")).toHaveCount(5);
  const results = await page.evaluate(async () => {
    const data = await new Promise<{
      assets: Array<{
        id: string;
        url: string;
        bytes: number;
        width: number;
        height: number;
      }>;
      artworks: Array<{ assetId: string; title: { en: string } }>;
    }>((resolve) => {
      const r = indexedDB.open("floristld-demo-v1", 1);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("state"),
          get = tx.objectStore("state").get("gallery");
        get.onsuccess = () => resolve(get.result);
        tx.oncomplete = () => db.close();
      };
    });
    const assets = data.artworks
      .filter((a) => a.title.en.startsWith("Batch artwork"))
      .map((a) => data.assets.find((s) => s.id === a.assetId)!);
    const transparent = data.assets.find(
      (s) =>
        s.id ===
        data.artworks.find((a) => a.title.en === "Batch artwork 1")!.assetId,
    )!;
    const img = await createImageBitmap(
      await (await fetch(transparent.url)).blob(),
    );
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    img.close();
    return {
      assets: assets.map(({ bytes, width, height }) => ({
        bytes,
        width,
        height,
      })),
      cornerAlpha: ctx.getImageData(0, 0, 1, 1).data[3],
    };
  });
  expect(results.assets).toHaveLength(2);
  for (const asset of results.assets) {
    expect(asset.bytes).toBeLessThanOrEqual(5000000);
    expect(Math.max(asset.width, asset.height)).toBeLessThanOrEqual(3840);
  }
  expect(results.cornerAlpha).toBe(0);
  await test.info().attach("image-processing-evidence", {
    body: JSON.stringify({ inputBytes: large.length, ...results }),
    contentType: "application/json",
  });
});
test("deep-linked artwork outside first page survives English switch in a 1000-artwork collection", async ({
  page,
}) => {
  await page.goto("/admin/");
  await expect(page.locator(".admin-collection").first()).toBeVisible();
  await page
    .locator(".admin-collection")
    .first()
    .getByRole("button", { name: "向下移动", exact: true })
    .click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("floristld-demo-v1", 1);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction("state", "readwrite"),
          store = tx.objectStore("state");
        const get = store.get("gallery");
        get.onsuccess = () => {
          // The initial demo is not written until the first mutation.
          if (!get.result) {
            reject(new Error("Seed data must be persisted first"));
            return;
          }
          const data = get.result;
          const original = data.artworks.find(
            (a: { collectionId: string }) => a.collectionId === "botanical",
          );
          data.artworks = Array.from({ length: 1000 }, (_, i) => ({
            ...original,
            id: `capacity-${i}`,
            position: i,
            title: { zh: `容量作品${i}`, en: `Capacity artwork ${i}` },
          }));
          data.collections[0].coverId = "capacity-0";
          store.put(data, "gallery");
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.goto("/zh/collection/?slug=botanical-dreams&artwork=capacity-999");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#lightbox-title")).toHaveText("容量作品999");
  expect(await page.locator(".artwork-grid article").count()).toBeLessThan(30);
  await page.goto("/en/collection/?slug=botanical-dreams&artwork=capacity-999");
  await expect(page.locator("#lightbox-title")).toHaveText(
    "Capacity artwork 999",
  );
});
test("gallery navigation, language context and keyboard lightbox", async ({
  page,
}) => {
  await page.goto("/zh/");
  await expect(page.getByRole("heading", { name: "精选合集" })).toBeVisible();
  await page.locator(".collection-image").first().click();
  await expect(page.locator(".artwork-grid article")).toHaveCount(3);
  await page.locator(".artwork-button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/artwork=art-4/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/collection\/\?slug=botanical-dreams/);
  await expect(
    page.getByRole("heading", { name: "Botanical dreams." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("create bilingual collection, persist edits, trash and restore", async ({
  page,
}) => {
  await page.goto("/admin/");
  await expect(
    page.getByText("本地演示模式：", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建合集" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "中文", exact: true })
    .first()
    .fill("测试合集");
  await dialog
    .getByRole("textbox", { name: "English", exact: true })
    .first()
    .fill("Test collection");
  await dialog
    .getByRole("textbox", { name: "链接标识（英文）" })
    .fill("test-collection");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  const card = page
    .locator(".admin-collection")
    .filter({ hasText: "测试合集" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "移入回收站" }).click();
  await page
    .getByRole("button", { name: "回收站", exact: false })
    .first()
    .click();
  await expect(page.locator(".trash-list")).toContainText("测试合集");
  await page.getByRole("button", { name: "恢复为草稿" }).click();
  await page
    .getByRole("button", { name: "合集管理", exact: false })
    .first()
    .click();
  await expect(
    page.locator(".admin-collection").filter({ hasText: "测试合集" }),
  ).toBeVisible();
});
test("upload image through browser processing and publish child", async ({
  page,
}) => {
  await page.goto("/admin/");
  await page
    .getByRole("button", { name: "花与未完成的梦", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "添加作品", exact: false }).click();
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 300;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#578567";
    ctx.fillRect(0, 0, 240, 300);
    ctx.fillStyle = "#e3c184";
    ctx.fillRect(60, 70, 120, 150);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const png = Buffer.from(imageData, "base64");
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "tiny.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("待上传", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "中文标题", exact: true })
    .fill("新作品");
  await page
    .getByRole("textbox", { name: "English title", exact: true })
    .fill("New artwork");
  await page.getByRole("button", { name: "上传至合集", exact: true }).click();
  await expect(page.getByText("已添加为草稿", { exact: true })).toBeVisible();
  const card = page.locator(".admin-art-card").filter({ hasText: "新作品" });
  await card.getByRole("button", { name: "发布", exact: true }).click();
  await page.goto("/zh/collection/?slug=botanical-dreams");
  await expect(
    page.getByRole("heading", { name: "新作品", exact: true }),
  ).toBeVisible();
});
