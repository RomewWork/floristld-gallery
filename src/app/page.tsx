/* 禁用 JavaScript 时原生链接也须可用，因此这里不使用客户端路由链接。 */
/* eslint-disable @next/next/no-html-link-for-pages */
import { localeEntryScript } from "@/lib/locale-entry";
export default function Root() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: localeEntryScript }} />
      <noscript>
        <main className="redirect">
          <p>JavaScript is disabled. 请选择语言：</p>
          <a href="/zh/">中文画廊 →</a>
          <a href="/en/">English gallery →</a>
        </main>
      </noscript>
    </>
  );
}
