import { chromium, devices } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch();
await mkdir("test-results/visual", { recursive: true });
for (const [name, options] of [
  ["desktop", { viewport: { width: 1440, height: 1000 } }],
  ["mobile", devices["iPhone 13"]],
]) {
  const context = await browser.newContext({
    ...options,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [screen, path, selector] of [
    ["home", "/zh/", ".collection-image"],
    ["collection", "/en/collection/?slug=botanical-dreams", ".artwork-button"],
    ["about", "/zh/about/", ".about-copy"],
    ["admin", "/admin/", ".admin-collection"],
  ]) {
    await page.goto(
      `${process.env.VISUAL_BASE_URL || "http://127.0.0.1:3000"}${path}`,
    );
    await page.locator(selector).first().waitFor();
    await page.screenshot({
      path: `test-results/visual/${name}-${screen}.png`,
      fullPage: true,
    });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error(`Horizontal overflow: ${name}/${screen}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  await context.close();
}
await browser.close();
console.log(
  "Saved desktop/mobile screenshots; no page errors or horizontal overflow.",
);
