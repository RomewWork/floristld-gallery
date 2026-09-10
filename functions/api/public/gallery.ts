interface Context {
  request: Request;
  env: { PUBLIC_API?: { fetch(request: Request): Promise<Response> } };
}

// Pages 仅代理公开列表读取；重新构造请求，避免转发 Cookie 或 Access 凭证。
// PUBLIC_API 使用服务绑定，不依赖自定义域名的 DNS；路由范围见 public/_routes.json。
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
