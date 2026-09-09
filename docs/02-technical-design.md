# 当前技术方案

用户批准：Next.js 静态前端 + Workers/D1 + Access + ImageKit Free，取代旧云端原图方案。

## 部署与模型
公共 Pages 提供 out 目录，通过 Worker /api/public/gallery 读取发布数据。管理静态资源由独立 Worker ASSETS 提供，所有管理接口与页面同源并经 Access 验证。D1 使用 collections/artworks 一对多、assets、upload_sessions、profile 和 mutation_locks；JSON 保存双语字段，外键/索引/版本防止关联和并发错误。

公共路由 /zh/、/en/、/{locale}/collection/?slug=…、/{locale}/about/；后台 /admin/。切换语言保留查询参数。新增作品无需重新部署。提供站点级 SEO，合集数据客户端加载，不承诺逐合集 SSR 搜索/社交预览。

## 权限
Access OTP 允许两个管理员邮箱，Worker 再校验 RS256、issuer、audience、exp 和邮箱名单；写请求严格检查 Origin。公共 API 只为配置的 PUBLIC_ORIGIN 提供 CORS。开发绕过同时要求 development、DEV_AUTH=true、loopback hostname；生产配置缺失时拒绝。

## 图片
浏览器读取尺寸并生成 WebP 质量0.9（浏览器不支持时 PNG fallback），不为大小目标无限降低画质。签名直传私有文件，complete 通过服务端 provider details 验证分配路径、大小、类型、尺寸与私有性，重复完成幂等。

ImageKit 不能直接切换已上传文件的私有属性。服务器发布时创建公开副本、验证后更新数据库。保留私有主文件供管理，容量按两份计算；下架隐藏元数据，不保证旧公开缓存立即撤回。无引用资产在永久删除后清理，失败保留可重试记录。

## 容量
应用保护阈值2.5 GB；账户中应用外上传、孤立文件等仍以平台账目为准。当前 ImageKit Free 为3 GB存储、20 GB/月流量，超限停止服务。D1/Workers保持免费配置；不自动升级。[ImageKit价格](https://imagekit.io/plans/) / [D1价格](https://developers.cloudflare.com/d1/platform/pricing/)。

原画由画师独立备份。导出是元数据与展示图引用，不是原文件备份。真实画作色彩和中国大陆/海外访问效果需实测。
