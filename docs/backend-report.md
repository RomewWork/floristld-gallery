# 后端接口与一致性说明

Worker 入口为 `worker/index.ts`，鉴权与公开数据筛选在 `worker/core.ts`，图片服务适配在 `worker/provider.ts`。数据库须依次执行 `migrations/0001_gallery.sql`、`migrations/0002_pending_publication.sql`。实际配置与上线步骤见[部署说明](deployment.md)。

## 接口约定

管理接口均以 `/api/admin` 为前缀。`coverId` 指向作品 ID，而不是图片资源 ID。

| 方法与路径 | 用途与约束 |
| --- | --- |
| `GET /api/public/gallery?slug=&limit=24&cursor=0&artwork=` | 只返回已发布、未删除且有已验证公开图片的内容。文件 ID 清空，版本置零；封面和指定作品可额外加入结果，但不推进分页游标。 |
| `GET /me`、`GET /gallery`、`GET /export` | 当前管理员、完整管理数据、元数据导出。管理预览使用五分钟签名 URL；导出包含资源映射，不含密钥。 |
| `POST /collections`、`PATCH /collections/:id` | 创建与编辑合集。 |
| `POST /artworks`、`PATCH /artworks/:id` | 创建与编辑作品。创建支持 UUID 格式的 `creationId` 去重；创建后不能改所属合集或图片资源。 |
| `POST /{collections或artworks}/:id/{publish或unpublish或restore}` | 发布、下架或恢复；修改已有记录需提交 `version`。花括号内选择一个实际路径段。 |
| `DELETE /{collections或artworks}/:id`、`DELETE /{collections或artworks}/:id/permanent` | 软删除、永久删除。永久删除要求已在回收站；合集须先移除全部子作品。 |
| `POST /collections/:id/order` | 接收 `{artworkIds,version}`，包含该合集全部未删除作品且不重复；原子更新排序和版本。 |
| `POST /collections/order` | 接收 `{collectionIds,versions:{[id]:version}}`，检查所有未删除合集及其版本，再原子更新。 |
| `PATCH /profile` | 提交完整画师资料。 |
| `POST /uploads` | 签发五分钟 ImageKit V1 票据，使用返回目录和文件名，设置 `useUniqueFileName=false`、`isPrivateFile=true`。 |
| `POST /uploads/:id/complete` | 接收 `{fileId}`，从服务商核验文件，并通过签名 HEAD 请求确认可访问。 |
| `DELETE /assets/:id` | 提交 JSON `{}`，清理无作品引用的图片；外部删除失败保留记录以便重试。 |

上传会话预留期为十五分钟；过期后原管理员仍可核验已上传到原指定路径的文件，不会获得新票据。服务端接受 JPEG、PNG、WebP、AVIF，最大 5,000,000 字节、长边 3840 像素；浏览器输入仅接受 JPEG、PNG、WebP。公开合集的 `artworkCount` 为全部可见作品数，`nextCursor` 为数字或 `null`。

永久删除作品可能返回 `{deleted:true,cleanupPending:true}`，表示作品记录已删除，但图片清理需要重试。创建去重依赖仍存在的作品记录（含软删除）；永久删除后不再保留该创建 ID 的去重依据。

## 权限与并发

管理 API 与静态资源均校验 Access JWT 的 RS256 签名、签发者、受众、有效期及邮箱允许名单，缺配置时拒绝访问。本地绕过必须同时满足 `ENVIRONMENT=development`、`DEV_AUTH=true` 与回环主机名。写请求的 `Origin` 必须与请求地址同源。管理资源配置 `run_worker_first=true`，避免绕过鉴权直接取得静态文件。

公开只读 Worker 使用 `PUBLIC_ONLY=true`，在鉴权或静态资源处理前拒绝公开接口之外的路径和方法。公开 CORS 仅允许配置的 `PUBLIC_ORIGIN`、`PUBLIC_ADDITIONAL_ORIGINS`；当前 Pages 同源转发通过 `PUBLIC_API` 服务绑定访问它。

写操作取得数据库级五分钟租约，服务商请求超时为十五秒。每次写入和批处理都在同一 D1 事务内检查租约令牌，防止旧请求在锁被接管后落库。`version` 防止旧页面覆盖新内容。JSON 请求体上限为 32 KiB，排序请求最多 1000 个 ID；上传完成绑定原管理员，对同一文件幂等。

## 图片发布、清理与容量

私有展示主文件保留私有；发布时从其签名地址创建固定路径的公开副本，再核验路径、私有性、大小、类型和尺寸。重试复用固定名称，避免随机生成多份副本；副本核验失败不能使作品变为已发布。

调用服务商前保存 `public_path`，取得副本 ID 后先保存 `pending_public_file_id`，再核验详情。即使响应丢失或租约失效，后续仍能按精确路径对账；不删除近似匹配或结果不明确的文件。首次上传明确被拒绝时可清除本次意图；若之前有结果不明的请求，继续保留线索，详见[修复记录](integration-fix-report.md)。

永久清理先将图片标为不可引用，且仅在全部作品（含回收站）不再引用时删除私有主文件和公开副本。部分删除失败保留资源记录。下架只隐藏画廊元数据，不能保证已分享的公开 URL 或 CDN 缓存立即失效。

新上传按主文件两倍字节预留，计入未过期上传会话，以 2.5 GB 作为应用准入阈值。`usage.storedBytes` 为已记录主文件和公开副本，`usage.reservedBytes` 为上传预留及将来公开副本的空间；`Asset.bytes` 仅表示主文件大小，公共响应不含用量。

ImageKit V1 签名覆盖令牌和有效期，不覆盖上传内容。已认证管理员仍可能上传随后被应用拒绝的文件；废弃上传、服务商版本和应用外文件可能占用账外空间。应用阈值不能代替服务商容量统计，需定期核对孤立文件。

## 验证与历史依据

`tests/backend.test.ts` 使用本地签名 JWT 和带 D1 适配的真实内存 SQLite，覆盖鉴权拒绝、草稿隔离、发布条件、上传核验与恢复、版本排序、租约接管、引用删除、容量预留、CORS 和请求大小限制。

初次后端交付时记录为 40 项后端测试通过，类型检查和相关文件 lint 通过；后续回归和完整验证见[验收记录](acceptance.md)，不要把早期数量当成当前结果。本地替身不能证明真实 ImageKit、Access 验证码或 Cloudflare 部署已通过。

以下为实施时留存的官方资料链接，服务商接口变更时应重新核对：

- [ImageKit 上传接口](https://imagekit.io/docs/api-reference/upload-file/upload-file)
- [文件详情](https://imagekit.io/docs/api-reference/digital-asset-management-dam/managing-assets/get-file-details)
- [私有文件与签名地址](https://imagekit.io/docs/media-delivery-basic-security)
- [更新文件详情](https://imagekit.io/docs/api-reference/digital-asset-management-dam/managing-assets/update-file-details)
- [文件列表与搜索](https://imagekit.io/docs/api-reference/digital-asset-management-dam/list-and-search-assets)
