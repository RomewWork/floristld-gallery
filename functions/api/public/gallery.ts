interface Context {
  request: Request;
  env: { PUBLIC_API?: { fetch(request: Request): Promise<Response> } };
}

// Only the public gallery read is exposed through Pages. Never forward cookies
// or Access credentials, and never depend on the custom domain's DNS.
export async function onRequest({ request, env }: Context): Promise<Response> {
  if (request.method !== "GET")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  try {
    if (!env.PUBLIC_API) throw new Error("Missing PUBLIC_API binding");
    const url = new URL("https://public-api.internal/api/public/gallery");
    url.search = new URL(request.url).search;
    return await env.PUBLIC_API.fetch(new Request(url, { method: "GET" }));
  } catch {
    return Response.json(
      {
        error: {
          code: "PUBLIC_API_UNAVAILABLE",
          message: "画廊暂时不可用，请稍后重试",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
