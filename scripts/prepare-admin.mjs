import { mkdir, cp, access } from "node:fs/promises";
await access("out/admin/index.html");
await mkdir("admin-dist", { recursive: true });
for (const dir of ["admin", "_next", "art"])
  await cp(`out/${dir}`, `admin-dist/${dir}`, { recursive: true });
console.log(
  "Admin static assets copied to admin-dist. API requests use the same Worker origin.",
);
