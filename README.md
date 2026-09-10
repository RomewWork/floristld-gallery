# Floristld · 个人画师画廊

React / Next.js 静态画廊 + Cloudflare Workers/D1 在线后台 + Access 邮箱验证码 + ImageKit 展示图。

## 本地运行

需要 Node.js 24（后端测试使用内置 node:sqlite）。

```powershell
npm ci
npm run dev
```

打开 http://127.0.0.1:3000/zh/，后台 http://127.0.0.1:3000/admin/。默认明确标记的本地演示模式，内容保存在此浏览器 IndexedDB；支持编辑/排序/上传展示图/发布/回收站，不发送邮件、不请求云端。演示图片是本项目编写的 SVG 布局素材，并非画师真实作品。

## 检查与打包

```powershell
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm run admin:build
npm run api:check
```

公共静态输出 out/，管理输出 admin-dist/。静态导出不能使用 next start；开发预览使用 npm run dev，构建后可用 npm start 在 http://127.0.0.1:3100 预览静态输出，正式托管使用 Pages / Worker ASSETS。

真实上线前请阅读 [部署说明](docs/deployment.md) 与 [备份恢复](docs/backup-restore.md)。测试与未完成项目见 [验收记录](docs/acceptance.md)。

完整中文资料见 [文档索引](docs/README.md)，接手代码可先读 [维护指南](docs/maintenance.md)。

## 设计与实现

- 中文与英文界面；一个合集多件作品；原始比例网格、键盘和移动端灯箱。
- 后台支持你与管理员各自邮箱验证码登录，允许名单由 Access 和 Worker 双重校验。
- 原画保留在画师自己的设备及备份盘，浏览器生成展示图，不改变本地原文件。
- 图片免费额度耗尽可能暂停服务；不配置自动付费。私有展示主文件和公开副本都占空间。
- API 服务与前端独立，可换服务商；不引入数据库图片二进制或 Git 原图存储。

Font Awesome 图标保留各 npm 包的许可文件。依赖 lockfile 固定安装版本。此项目没有自动创建云账户、购买域名或升级计划。
