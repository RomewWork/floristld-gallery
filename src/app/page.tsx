/* Native links in noscript must work without the client router. */
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
