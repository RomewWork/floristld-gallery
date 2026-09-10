import { mkdir, cp, access } from "node:fs/promises";
// 先用管理站环境变量构建 out/，再提取管理入口及依赖；API 请求应保持同源。
await access("out/admin/index.html");
await mkdir("admin-dist", { recursive: true });
for (const dir of ["admin", "_next", "art"])
  await cp(`out/${dir}`, `admin-dist/${dir}`, { recursive: true });
console.log(
  "Admin static assets copied to admin-dist. API requests use the same Worker origin.",
);
