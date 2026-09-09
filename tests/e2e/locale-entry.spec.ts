import { test, expect } from "@playwright/test";

for (const [languages, expected] of [
  [["zh-CN", "en-US"], "zh"],
  [["en-GB", "zh-CN"], "en"],
  [["fr-FR", "zh-TW"], "zh"],
  [["fr-FR"], "en"],
] as const) {
  test(`root chooses ${expected} for ${languages.join(",")}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (langs) =>
        Object.defineProperty(navigator, "languages", { get: () => langs }),
      languages,
    );
    await page.goto("/?from=portfolio#contact");
    await expect(page).toHaveURL(
      `http://127.0.0.1:3000/${expected}/?from=portfolio#contact`,
    );
  });
}

test("redirect runs without the Next client bundles and tolerates blocked storage", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => ["zh-HK"] });
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
  });
  await page.route("**/_next/**/*.js", (route) => route.abort());
  await page.goto("/");
  await expect(page).toHaveURL(/\/zh\/$/);
});

test("manual choice wins but explicit language URLs do not overwrite it", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "languages", { get: () => ["zh-CN"] }),
  );
  await page.goto("/zh/about/");
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await page.goto("/zh/");
  await expect(page.locator(".site-header .language")).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/en\/$/);
});

test("automatic root redirect replaces history instead of trapping Back", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] }),
  );
  await page.goto("/zh/about/");
  await page.goto("/");
  await expect(page).toHaveURL(/\/en\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/zh\/about\/$/);
});
