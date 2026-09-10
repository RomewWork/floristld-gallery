"use client";
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpRightFromSquare,
  faAsterisk,
  faArrowUp,
} from "@fortawesome/free-solid-svg-icons";
import type { Locale } from "@/lib/types";
import { messages } from "@/lib/messages";
import { isDemo } from "@/lib/api";
import { LANGUAGE_PREFERENCE_KEY } from "@/lib/locale-entry";
const LocaleContext = createContext<Locale>("zh");
export const useLocale = () => useContext(LocaleContext);
export function Shell({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const t = messages[locale];
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState("");
  // 查询参数在浏览器读取；灯箱主动触发 popstate 后，同步语言链接中的选中作品。
  useEffect(() => {
    document.documentElement.lang = locale;
    setQuery(window.location.search);
    const fn = () => setQuery(window.location.search);
    window.addEventListener("popstate", fn);
    return () => window.removeEventListener("popstate", fn);
  }, [locale, path]);
  const other = locale === "zh" ? "en" : "zh";
  return (
    <LocaleContext.Provider value={locale}>
      <a className="skip" href="#main">
        {locale === "zh" ? "跳到内容" : "Skip to content"}
      </a>
      <header className="site-header">
        <Link
          href={`/${locale}/`}
          className="brand"
          aria-label="Floristld home"
        >
          <FontAwesomeIcon icon={faAsterisk} />
          <span>
            floristld<span className="brand-dot">.</span>
          </span>
        </Link>
        <button
          className="menu-toggle"
          aria-expanded={menu}
          aria-label="Menu"
          onClick={() => setMenu(!menu)}
        >
          ☰
        </button>
        <nav className={menu ? "open" : ""}>
          <Link
            onClick={() => setMenu(false)}
            className={!path.includes("about") ? "active" : ""}
            href={`/${locale}/`}
          >
            {t.collections}
          </Link>
          <Link
            onClick={() => setMenu(false)}
            className={path.includes("about") ? "active" : ""}
            href={`/${locale}/about/`}
          >
            {t.about}
          </Link>
          <a
            className="language"
            onClick={() => {
              try {
                // 只记录主动切换，不因用户打开某种语言的链接就覆盖偏好。
                localStorage.setItem(LANGUAGE_PREFERENCE_KEY, other);
              } catch {
                // 浏览器禁止存储时仍允许正常跳转。
              }
            }}
            href={`${path.replace(/^\/(zh|en)/, `/${other}`)}${query}`}
          >
            {t.language}
            <span>↗</span>
          </a>
        </nav>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div>
          <Link className="brand footer-brand" href={`/${locale}/`}>
            floristld.
          </Link>
          <p>{t.footer}</p>
        </div>
        <div className="footer-meta">
          <span>
            © {new Date().getFullYear()} Floristld · {t.copyright}
          </span>
          <a href={process.env.NEXT_PUBLIC_ADMIN_URL || "/admin/"}>
            {t.studio} <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </a>
          <button
            onClick={() =>
              window.scrollTo({
                top: 0,
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "instant"
                  : "smooth",
              })
            }
            aria-label="Back to top"
          >
            <FontAwesomeIcon icon={faArrowUp} />
          </button>
        </div>
      </footer>
      {isDemo && <div className="demo-ribbon">{t.demo}</div>}
    </LocaleContext.Provider>
  );
}
