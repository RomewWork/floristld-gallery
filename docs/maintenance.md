# 代码维护指南

## 从哪里开始

| 文件或目录 | 维护职责 |
| --- | --- |
| `src/app/` | 静态路由、页面元数据、全局样式；根页负责输出语言跳转脚本。 |
| `src/lib/locale-entry.ts`、`src/components/Shell.tsx` | 自动语言选择、手动偏好、导航与语言上下文。 |
| `src/lib/messages.ts` | 公共界面双语文案；后台文案在 `Admin.tsx` 的 `dictionary`。 |
| `src/lib/types.ts` | 双语字段、合集、作品、资源与票据的共享结构。 |
| `src/lib/api.ts`、`src/lib/demo.ts` | 真实 API 请求、本地 IndexedDB 演示数据和模拟写操作。 |
| `src/lib/process-image.ts`、`src/lib/upload.ts` | 展示图生成、私有直传、完成核验和重试检查点。 |
| `src/components/Gallery.tsx`、`src/components/Lightbox.tsx` | 公共画廊、分页、选中作品、键盘与触屏灯箱。 |
| `src/components/admin/Admin.tsx` | 内容编辑、排序、发布、回收站与上传队列。 |
| `worker/core.ts`、`worker/index.ts`、`worker/provider.ts` | 鉴权与公开数据筛选、业务写入、ImageKit 适配。 |
| `functions/api/public/gallery.ts`、`public/_routes.json` | Pages 同源公开列表转发及 Function 的路由范围。 |
| `migrations/`、`wrangler*.toml` | 数据库迁移、管理和只读 Worker 配置。 |
| `scripts/`、`tests/` | 资源打包、静态预览、冒烟与回归验证。 |

## 修改时保留的约束

- **静态导出**：业务数据在浏览器获取，写接口由 Worker 提供。合集用 `slug` 查询参数，不需要为每个合集重新构建页面。`[locale]` 预生成中英文路径；改 Next.js 代码前阅读已安装版本的 `node_modules/next/dist/docs/`，不要依赖旧版 API 印象。
- **语言偏好**：只有主动切换才写入 `gallery-preferred-locale`；不能恢复为每次访问写入，也不能使用旧 `gallery-locale` 键。指定作品的查询参数要在切换语言时保留。
- **双语内容**：新增文案同时补齐 `zh` 与 `en`。文档中文化不影响英文界面；`textFor` 仅对空字符串使用另一语言回退。
- **演示与真实模式**：`NEXT_PUBLIC_DATA_MODE=live` 才访问真实 API。演示写入须经过串行队列，有 Web Locks 时还会协调多个标签页；其数据不能当成真实云端备份。
- **上传恢复**：预处理逐张进行，上传最多两个任务并发。保留 `ProcessedImage` 对象以复用上传检查点，保留队列 ID 以复用 `creationId`；刷新页面会丢失内存检查点，应先核对作品和未关联资源再重新上传。
- **图片资源**：不修改原文件，不靠反复压缩强行满足大小限制。预览对象 URL 用完须释放；服务端核验通过前不能发布，私有主文件和公开副本都占空间。
- **并发与删除**：编辑与排序保留版本检查；Worker 写入保留事务内租约令牌检查。回收站作品仍算图片引用，网络结果未知时保留清理记录。
- **构建配置**：`NEXT_PUBLIC_*` 会写入浏览器构建产物，不能放私钥，改值后重新构建。当前公共 Pages 与管理站的 API 地址均可留空，分别走服务绑定和同源管理 API。完整步骤见[部署说明](deployment.md)。

## 验证方式

使用 Node.js 24，后端测试依赖 `node:sqlite`。安装依赖后进行基础检查：

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

涉及交互、语言或上传流程时运行 `npm run test:e2e`，首次先用 `npx playwright install chromium` 安装测试浏览器。布局变化可在开发服务启动后运行 `node scripts/visual-check.mjs`。

涉及管理资源打包时，在相应构建配置下运行 `npm run admin:build`；Worker 构建预检使用 `npm run api:check` 和 `npx wrangler deploy --dry-run --config wrangler.public.toml`。`--dry-run` 不发布线上资源。修改数据库时新增迁移文件，不改写已上线迁移，并先在本地验证。

注释重点说明限制、原因和失败恢复规则；行为改变时同步更新注释及对应文档。构建目录 `out/`、`admin-dist/`、`.next/` 与测试输出均为生成文件，不直接维护。
