# Cloudflare 与 ImageKit 部署

## 需要准备的配置

1. Cloudflare 免费账户与 D1 数据库。记录 database_id，填入 wrangler.toml 和 wrangler.public.toml，同一个库绑定到两个 Worker。
2. Cloudflare Access 团队域名与应用 audience，两个允许邮箱；使用 One-time PIN 登录，仅邮箱名单通过。不要使用“所有人允许”策略。
3. ImageKit Free：public key、private key、URL endpoint。不开通 Lite/Pro、不启用额外付费功能。使用默认图片域名，无需购买图片域名。
4. 公共 Pages 地址、公开只读 API Worker 地址、管理 Worker 地址。自定义站点域名可后配，其注册续费不是图片费用。

真实值放在平台配置和本地 .env.local / .dev.vars（均被忽略），不要提交密钥。管理员邮箱属于配置，不需要写入业务源码。

## 为什么两个 Worker

管理 Worker 整个域名由 Access 保护，ASSETS 和写 API 同源；公共只读 Worker 设置 PUBLIC_ONLY=true，不绑定图片私钥和管理 ASSETS，所有非公开路径返回404。公共站只访问只读 Worker。这样 Access 不会把访客的图片列表请求重定向到登录页面。

## D1

```powershell
npx wrangler d1 create gallery
```

把返回的 database_id 填入两个配置文件。然后运行：

```powershell
npx wrangler d1 migrations apply gallery --remote --config wrangler.toml
```

正式库迁移前导出备份。第一次迁移创建空画廊与空画师资料；生产不会注入演示作品。

## ImageKit 与 Access

在 wrangler.toml 填写 ACCESS_TEAM_DOMAIN（仅主机名）、ACCESS_AUD、ADMIN_EMAILS（逗号分隔你的邮箱和妹妹邮箱）、IMAGEKIT_PUBLIC_KEY、IMAGEKIT_URL_ENDPOINT。私钥：

```powershell
npx wrangler secret put IMAGEKIT_PRIVATE_KEY --config wrangler.toml
```

生产保持 ENVIRONMENT=production，不设置 DEV_AUTH。在 Cloudflare 控制台为管理 Worker 域名启用 Access 应用，允许 One-time PIN 且仅允许两个邮箱；将应用 audience 与 Worker 配置保持一致。默认 workers.dev 域名按 Workers 的 Access 集成启用，或绑定自有管理子域名后创建 self-hosted Access 应用。公开只读 Worker 不添加 Access 登录保护。

Worker 自身校验 Access 签名/issuer/audience/exp/email：即使误开放某个备用域名，没有有效 JWT 也不能访问管理数据。上线必须测试默认域名、预览域名和自定义域名都不能绕过。

## 构建管理站

管理站 NEXT_PUBLIC_API_URL 必须为空，让它访问同源 /api/admin。将以下值放入 .env.local（只填真实地址，不放私钥）：

```dotenv
NEXT_PUBLIC_DATA_MODE=live
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_SITE_URL=https://your-gallery.pages.dev
NEXT_PUBLIC_ADMIN_URL=https://your-admin-worker.workers.dev/admin/
```

```powershell
npm run build
npm run admin:build
npx wrangler deploy --config wrangler.toml
```

管理入口为该 Worker 的 /admin/。默认根路径不是公共首页。

## 部署只读 API 与公共站

wrangler.public.toml 设置 PUBLIC_ORIGIN 为最终 Pages origin（不含路径或结尾斜杠）。不放 Access 或 ImageKit 私钥。

```powershell
npx wrangler deploy --config wrangler.public.toml
```

公共站现在通过 Pages Function 的 PUBLIC_API Service binding 调用只读 Worker，不经过自定义域名 DNS。Pages 生产和预览环境都绑定 PUBLIC_API → floristld-gallery-public；NEXT_PUBLIC_API_URL 留空，其余保持 live。重新 npm run build；将 out/ 和仓库根目录的 functions/ 部署到 Pages。可以用控制台 Git 集成（build=npm run build，output=out）或：

```powershell
npx wrangler pages deploy out --project-name floristld
```

公共构建不要重新运行 admin:build 覆盖已打包的同源管理资源。更新管理站时重新按管理配置构建。所有 NEXT_PUBLIC_* 都是构建时值，修改后必须重新构建。

## 当前域名与到期安排

- Pages 项目：floristld，仓库 RomewWork/floristld-gallery，main 分支。旧 floristld-gallery.pages.dev 已删除，不再列入 CORS。
- 稳定画廊入口：https://floristld.pages.dev/zh/ 。NEXT_PUBLIC_SITE_URL=https://floristld.pages.dev。
- 浏览器读取同源 /api/public/gallery，由 functions/api/public/gallery.ts 通过 PUBLIC_API 绑定访问 floristld-gallery-public；只允许 GET，不转发 Cookie 或 Access 凭证。public/_routes.json 将 Function 限定在这个路径，静态页面保持静态托管。
- NEXT_PUBLIC_ADMIN_URL=https://floristld-gallery-api.romewwork.workers.dev/admin/；管理构建的 API 地址也保持空值。管理入口必须由 Cloudflare Access 保护，并使用与 ACCESS_AUD 一致的应用。
- 两个 Worker 保留 workers.dev 入口，关闭预览 URL；PUBLIC_ORIGIN=https://floristld.pages.dev，PUBLIC_ADDITIONAL_ORIGINS=https://crossingriver.love。
- crossingriver.love 及 api/admin 子域名仅作为目前有效的附加入口。域名到期后，访问这些地址本身无法自动转向备用站点；应提前收藏/分享 pages.dev 地址。主站列表、图片（ik.imagekit.io）和管理 Worker 的备用地址不依赖这个域名。
- 确认不续费时，在到期前从 Pages 移除 crossingriver.love 自定义域，从两个 Worker 移除 api/admin 自定义域，从 Access 应用移除对应自定义主机名，并清空两个配置文件的 PUBLIC_ADDITIONAL_ORIGINS 后重新部署。保留 workers.dev 的 Access 应用及 ACCESS_AUD。此清理需要在决定停用时执行，当前仍保留有效线上入口。
- 备用 Pages 和 Workers 地址不保证中国大陆所有运营商可达；尤其后台 workers.dev 可能仍需代理。若要求长期稳定国内直连，应维持有效自定义域名和合适的托管线路；内部 Service binding 仅消除了浏览器直连公开 workers.dev API 的依赖。

## 本地真实 API 调试

复制 .dev.vars.example 为 .dev.vars，填入开发专用凭证。只在本机调试时设置 ENVIRONMENT=development 和 DEV_AUTH=true，并使用127.0.0.1。初始化本地 D1 后运行 npm run api:dev。该模式不是验证码联调，localhost 绕过也不是生产认证测试。

## 运行边界与免费容量

- 云端只保留展示图；原画自行保留两份备份。发布的图片同时存在私有主文件和公开副本，不按单份计算空间。应用将新上传的双份预留账面控制在 2.5 GB，给免费账户其他文件和异常恢复留余量；这不是服务商强制额度，也无法阻止管理员从服务商控制台额外上传。
- 以全部 1000 件作品均发布估算，双份展示图平均每份约 1.25 MB 才能落在应用 2.5 GB 预留预算内。1000 件是容量测试规模，不是承诺 1000 张 5 MB 图片都能免费容纳；实际流量和空间以 ImageKit 控制台为准。
- 未完成上传、未知网络结果、服务商缓存可能造成账面与实际占用不同。确定被拒绝的公开副本会释放新建清理意图；结果不明时保留记录，不能为显示“清理成功”而丢弃文件线索。需要时按文件 ID/固定路径在服务商后台人工核对。
- 当前排序接口单次接收最多 1000 个 ID，是请求安全边界，不限制创建作品总数。若单个合集超过 1000 件，要先调整 `worker/index.ts` 的排序请求校验与批处理策略，并补充大批量 D1 测试；不要单纯扩大请求体到任意大小。
- 上传票据短期有效。已经上传但确认响应丢失的文件，可由原管理员再次核验其原会话及固定路径，不重新签发上传权限。浏览器重试队列的检查点仅保存在当前页面；刷新或关闭页面后请先检查后台作品列表/未关联图片，再重新上传。已接受的远端写入不能靠浏览器“取消”撤销。
- 下架将内容移出公开查询，不等于立即撤销此前公开图片 URL 或访客/CDN 缓存。不要上传禁止公开传播的素材；若要撤回已发布文件，需永久清理并核对服务商缓存。

## 发布验收清单

- 两个邮箱可收到验证码，其他邮箱和伪造 JWT 被拒绝。
- 未登录公众可读取列表，任何访客写操作被拒绝。
- 手机选择10 MB以上原画，检查处理后方向/颜色/透明度，上传草稿、发布和下架。
- 重复上传完成、过期会话、发布中断、删除失败恢复按验收记录测试。
- 管理 API 同源，公共 CORS 精确，不用通配 Origin 携带 credentials。
- ImageKit Free 容量/流量查看真实控制台；应用账面不是服务商总量，不能保证所有流量下不停服。
- 海外与大陆三网实测需实际网络条件，本地模拟移动设备不代表真实手机或中国大陆网络。
