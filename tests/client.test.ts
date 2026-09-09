import { describe, it, expect } from "vitest";
import { publicData } from "../src/lib/api";
import { demoData } from "../src/lib/demo";
import { readDimensions } from "../src/lib/process-image";
describe("public content boundaries", () => {
  it("filters drafts, trashed parents, and unverified images", () => {
    const d = structuredClone(demoData);
    d.collections[0].status = "draft";
    d.artworks[1].deletedAt = new Date().toISOString();
    d.assets[2].verified = false;
    const p = publicData(d);
    expect(p.artworks.map((a) => a.id)).not.toContain("art-1");
    expect(p.artworks.map((a) => a.id)).not.toContain("art-2");
    expect(p.artworks.map((a) => a.id)).not.toContain("art-3");
    expect(
      p.assets.every((s) => p.artworks.some((a) => a.assetId === s.id)),
    ).toBe(true);
  });
  it("retains multiple artworks in one collection", () => {
    const p = publicData(demoData);
    expect(
      p.artworks.filter((a) => a.collectionId === "botanical"),
    ).toHaveLength(3);
  });
});
describe("image header preflight", () => {
  it("reads PNG dimensions before decode", () => {
    const b = new Uint8Array(24);
    b[0] = 137;
    b[1] = 80;
    const view = new DataView(b.buffer);
    view.setUint32(16, 12000);
    view.setUint32(20, 9000);
    expect(readDimensions(b, "image/png")).toEqual({
      width: 12000,
      height: 9000,
    });
  });
  it("returns null for a truncated file", () =>
    expect(readDimensions(new Uint8Array(4), "image/png")).toBeNull());
});
