import { afterEach, expect, it, vi } from "vitest";
import type { ProcessedImage } from "../src/lib/process-image";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("does not retry a queued mutation after cancellation during a busy response", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
  const controller = new AbortController();
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    controller.abort();
    return Response.json(
      { error: { code: "MUTATION_BUSY", message: "Busy" } },
      { status: 409 },
    );
  });
  const { mutate } = await import("../src/lib/api");
  await expect(
    mutate("/api/admin/artworks", "POST", {}, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toHaveLength(1);
});

it("retries verification of the same uploaded file after an interrupted completion response", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
  let tickets = 0,
    transfers = 0,
    completions = 0;
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    if (url.endsWith("/uploads")) {
      tickets++;
      return Response.json({
        sessionId: "session-1",
        token: "token",
        signature: "sig",
        expire: 9999999999,
        publicKey: "key",
        fileName: "file.webp",
        folder: "/gallery",
      });
    }
    if (url.endsWith("/session-1/complete")) {
      expect(JSON.parse(String(options.body))).toEqual({ fileId: "file-1" });
      if (++completions === 1) throw new TypeError("Network interrupted");
      return Response.json({ id: "asset-1", fileId: "file-1", verified: true });
    }
    throw new Error("Unexpected API request");
  });
  class UploadTransport {
    upload = {};
    status = 200;
    responseText = '{"fileId":"file-1"}';
    onload?: () => void;
    open() {}
    abort() {}
    send() {
      transfers++;
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("XMLHttpRequest", UploadTransport);
  const { uploadImage } = await import("../src/lib/upload");
  const image: ProcessedImage = {
    blob: new Blob(["image"], { type: "image/webp" }),
    name: "test.webp",
    width: 100,
    height: 100,
    preview: "blob:preview",
  };
  await expect(
    uploadImage(image, new AbortController().signal, () => {}),
  ).rejects.toThrow("Network interrupted");
  await expect(
    uploadImage(image, new AbortController().signal, () => {}),
  ).resolves.toMatchObject({ id: "asset-1" });
  expect({ tickets, transfers, completions }).toEqual({
    tickets: 1,
    transfers: 1,
    completions: 2,
  });
});
