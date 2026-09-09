import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/public/gallery";

describe("Pages public API binding", () => {
  it("reads through the binding with query parameters but without credentials", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe("/api/public/gallery");
      expect(new URL(request.url).search).toBe("?slug=flowers&cursor=24");
      expect(request.headers.has("Cookie")).toBe(false);
      expect(request.headers.has("Cf-Access-Jwt-Assertion")).toBe(false);
      return Response.json({ collections: [] });
    });
    const response = await onRequest({
      request: new Request(
        "https://floristld.pages.dev/api/public/gallery?slug=flowers&cursor=24",
        {
          headers: {
            Cookie: "session=test",
            "Cf-Access-Jwt-Assertion": "test",
          },
        },
      ),
      env: { PUBLIC_API: { fetch } },
    });
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not forward mutations", async () => {
    const fetch = vi.fn();
    const response = await onRequest({
      request: new Request("https://floristld.pages.dev/api/public/gallery", {
        method: "POST",
      }),
      env: { PUBLIC_API: { fetch } },
    });
    expect(response.status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns an explicit unavailable response when binding is missing", async () => {
    const response = await onRequest({
      request: new Request("https://floristld.pages.dev/api/public/gallery"),
      env: {},
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("PUBLIC_API_UNAVAILABLE");
  });
});
