"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faArrowUpRightFromSquare,
  faAsterisk,
  faEnvelope,
} from "@fortawesome/free-solid-svg-icons";
import { faInstagram } from "@fortawesome/free-brands-svg-icons";
import { gallery, collectionPage } from "@/lib/api";
import { textFor, type GalleryData, type Asset } from "@/lib/types";
import { messages } from "@/lib/messages";
import { useLocale } from "./Shell";
import { Lightbox } from "./Lightbox";
export function imageUrl(asset: Asset, width: number) {
  if (!asset.url.startsWith("https://")) return asset.url;
  const u = new URL(asset.url);
  // 私有预览签名绑定原 URL，不能追加变换参数；仅调整未签名的 ImageKit 展示图。
  if (u.hostname === "ik.imagekit.io" && !u.searchParams.has("ik-s"))
    u.searchParams.set("tr", `w-${width},q-85,f-auto`);
  return u.toString();
}
export function ArtworkImage({
  asset,
  alt,
  priority = false,
  interactiveParent = false,
}: {
  asset?: Asset;
  alt: string;
  priority?: boolean;
  interactiveParent?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const t = messages[useLocale()];
  if (!asset) return <div className="image-missing">{alt}</div>;
  if (failedUrl === asset.url)
    return (
      <span className="image-missing">
        <span role="img" aria-label={`${alt}: ${t.error}`}>
          {alt}
          <br />
          {t.error}
        </span>
        {/* 父级已是链接或按钮时不再嵌套重试按钮，避免无效交互结构。 */}
        {!interactiveParent && (
          <button onClick={() => setFailedUrl(null)}>{t.retry} ↻</button>
        )}
      </span>
    );
  return (
    <img
      src={imageUrl(asset, 960)}
      srcSet={
        asset.url.startsWith("https://")
          ? `${imageUrl(asset, 480)} 480w, ${imageUrl(asset, 960)} 960w, ${imageUrl(asset, 1600)} 1600w`
          : undefined
      }
      sizes="(max-width: 700px) 90vw, 50vw"
      width={asset.width}
      height={asset.height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      onError={() => setFailedUrl(asset.url)}
    />
  );
}
function useGallery() {
  const [data, setData] = useState<GalleryData | null>(null);
  const [error, setError] = useState(false);
  const load = () => {
    setError(false);
    gallery()
      .then(setData)
      .catch(() => setError(true));
  };
  useEffect(load, []);
  return { data, error, load };
}
function State({ error, retry }: { error: boolean; retry: () => void }) {
  const t = messages[useLocale()];
  return (
    <section className="state">
      <span className="eyebrow">FLORISTLD · GALLERY</span>
      <h1>{error ? t.error : t.loading}</h1>
      {error && (
        <button className="button" onClick={retry}>
          {t.retry}
        </button>
      )}
    </section>
  );
}
export function Home() {
  const locale = useLocale(),
    t = messages[locale];
  const { data, error, load } = useGallery();
  const reduce = useReducedMotion();
  if (!data) return <State error={error} retry={load} />;
  const collections = [...data.collections].sort(
    (a, b) => a.position - b.position,
  );
  const hero = collections[0];
  const artwork =
    data.artworks.find((a) => a.id === hero?.coverId) || data.artworks[0];
  const asset = data.assets.find((a) => a.id === artwork?.assetId);
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
          >
            <span className="eyebrow">
              <span className="status-dot" /> ILLUSTRATION & LITTLE WONDERS
            </span>
            <h1>
              {locale === "zh" ? (
                <>
                  让想象
                  <br />
                  悄悄<span className="serif accent">生长</span>
                  <span className="title-star">✳</span>
                </>
              ) : (
                <>
                  A little wild.
                  <br />A little <span className="serif accent">wonder.</span>
                  <span className="title-star">✳</span>
                </>
              )}
            </h1>
            <p className="hero-note">{textFor(data.profile.tagline, locale)}</p>
            <a className="button" href="#collections">
              {t.explore}
              <FontAwesomeIcon icon={faArrowRight} />
            </a>
          </motion.div>
          <div className="hero-bottom">
            <span className="handwritten">Made with a little daydream.</span>
            <span>SCROLL TO EXPLORE ↓</span>
          </div>
        </div>
        <motion.div
          className="hero-art"
          initial={reduce ? false : { opacity: 0, rotate: 3, y: 20 }}
          animate={{ opacity: 1, rotate: 0, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="art-mat">
            <ArtworkImage
              asset={asset}
              alt={artwork ? textFor(artwork.alt, locale) : "Gallery cover"}
              priority
            />
            <span className="art-label">
              {artwork ? textFor(artwork.title, locale) : "Coming soon"}{" "}
              <span>01 / SELECTED</span>
            </span>
          </div>
          <div className="circle-seal">
            DRAWN WITH LOVE
            <br />
            <span>✳</span>
            <br />
            FLORISTLD STUDIO
          </div>
        </motion.div>
      </section>
      <section id="collections" className="collections-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">THE PORTFOLIO / 01</span>
            <h2>
              {t.selected}
              <span className="sup">
                ({String(collections.length).padStart(2, "0")})
              </span>
            </h2>
          </div>
          <p>{t.selectedNote}</p>
        </div>
        {collections.length === 0 ? (
          <div className="empty">
            <h3>{t.empty}</h3>
            <p>{t.emptyNote}</p>
          </div>
        ) : (
          <div className="collection-grid">
            {collections.map((c, i) => {
              const a = data.artworks.find((a) => a.id === c.coverId);
              const s = data.assets.find((s) => s.id === a?.assetId);
              return (
                <motion.article
                  className={`collection-card collection-${i % 3}`}
                  key={c.id}
                  initial={reduce ? false : { opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.1 }}
                  transition={{ duration: 0.5 }}
                >
                  <Link
                    href={`/${locale}/collection/?slug=${encodeURIComponent(c.slug)}`}
                    className="collection-image"
                  >
                    <ArtworkImage
                      interactiveParent
                      asset={s}
                      alt={textFor(c.title, locale)}
                    />
                    <span className="collection-index">
                      NO. {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="image-link">
                      <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                    </span>
                  </Link>
                  <div className="card-title">
                    <h3>
                      <Link
                        href={`/${locale}/collection/?slug=${encodeURIComponent(c.slug)}`}
                      >
                        {textFor(c.title, locale)}
                      </Link>
                    </h3>
                    <span>
                      {c.artworkCount ??
                        data.artworks.filter((a) => a.collectionId === c.id)
                          .length}{" "}
                      {t.works}
                    </span>
                  </div>
                  <p>{textFor(c.description, locale)}</p>
                </motion.article>
              );
            })}
          </div>
        )}
      </section>
      <Contact data={data} />
    </>
  );
}
export function Contact({ data }: { data: GalleryData }) {
  const locale = useLocale(),
    t = messages[locale];
  return (
    <section className="contact-section">
      <FontAwesomeIcon className="contact-star" icon={faAsterisk} />
      <span className="eyebrow">A NEW CHAPTER</span>
      <h2>{t.contact}</h2>
      <p>{t.contactNote}</p>
      {data.profile.email ? (
        <a className="text-link" href={`mailto:${data.profile.email}`}>
          {t.email}
          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
        </a>
      ) : (
        <span className="muted">{t.notConfigured}</span>
      )}
      {data.profile.contact && (
        <p className="contact-address">{data.profile.contact}</p>
      )}
    </section>
  );
}
export function About() {
  const locale = useLocale(),
    t = messages[locale];
  const { data, error, load } = useGallery();
  if (!data) return <State error={error} retry={load} />;
  return (
    <>
      <section className="about-page">
        <div className="about-image">
          <ArtworkImage
            asset={data.assets[0]}
            alt={textFor(data.profile.name, locale)}
            priority
          />
          <span className="handwritten">A world of my own.</span>
        </div>
        <div className="about-copy">
          <span className="eyebrow">THE ARTIST / 02</span>
          <h1>
            {t.story}
            <span className="accent">.</span>
          </h1>
          <h2>{textFor(data.profile.name, locale)}</h2>
          <div className="bio">
            {textFor(data.profile.bio, locale)
              .split("\n")
              .map((p, i) => (
                <p key={i}>{p}</p>
              ))}
          </div>
          <div className="social-links">
            {data.profile.email && (
              <a href={`mailto:${data.profile.email}`}>
                <FontAwesomeIcon icon={faEnvelope} /> Email ↗
              </a>
            )}
            {data.profile.instagram && (
              <a
                target="_blank"
                rel="noopener noreferrer"
                href={data.profile.instagram}
              >
                <FontAwesomeIcon icon={faInstagram} /> Instagram ↗
              </a>
            )}
          </div>
        </div>
      </section>
      <Contact data={data} />
    </>
  );
}
export function CollectionPage() {
  const locale = useLocale(),
    t = messages[locale];
  const params = useSearchParams();
  const slug = params.get("slug") || "";
  const [data, setData] = useState<GalleryData | null>(null);
  const [error, setError] = useState(false);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(
    params.get("artwork"),
  );
  const load = () => {
    setError(false);
    setData(null);
    collectionPage(
      slug,
      0,
      new URLSearchParams(window.location.search).get("artwork") || undefined,
    )
      .then((d) => {
        setData(d);
        setNext(d.nextCursor ?? null);
      })
      .catch(() => setError(true));
  };
  useEffect(() => {
    let valid = true;
    // 切换合集或卸载后忽略旧响应；首屏也必须携带 artwork，才能打开后续分页中的作品。
    setError(false);
    setData(null);
    collectionPage(
      slug,
      0,
      new URLSearchParams(window.location.search).get("artwork") || undefined,
    )
      .then((d) => {
        if (valid) {
          setData(d);
          setNext(d.nextCursor ?? null);
        }
      })
      .catch(() => valid && setError(true));
    return () => {
      valid = false;
    };
  }, [slug]);
  useEffect(() => {
    const fn = () =>
      setSelected(new URLSearchParams(window.location.search).get("artwork"));
    window.addEventListener("popstate", fn);
    return () => window.removeEventListener("popstate", fn);
  }, []);
  const select = (id: string | null) => {
    setSelected(id);
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("artwork", id);
    else u.searchParams.delete("artwork");
    window.history.replaceState(null, "", u);
    // replaceState 不会自动触发 popstate，手动通知语言导航同步查询参数。
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  if (!data) return <State error={error} retry={load} />;
  const c = data.collections.find((c) => c.slug === slug);
  if (!c)
    return (
      <section className="state">
        <h1>{t.notFound}</h1>
        <Link href={`/${locale}/`}>{t.back}</Link>
      </section>
    );
  const arts = data.artworks
    .filter((a) => a.collectionId === c.id)
    .sort((a, b) => a.position - b.position);
  const more = async () => {
    if (next === null || busy) return;
    setBusy(true);
    try {
      const d = await collectionPage(slug, next);
      // 首屏可能额外包含封面或深链接作品，后续分页合并时按 ID 去重。
      setData({
        ...d,
        artworks: [
          ...data.artworks,
          ...d.artworks.filter(
            (a) => !data.artworks.some((x) => x.id === a.id),
          ),
        ],
        assets: [
          ...data.assets,
          ...d.assets.filter((s) => !data.assets.some((x) => x.id === s.id)),
        ],
      });
      setNext(d.nextCursor ?? null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="collection-page">
      <Link className="back-link" href={`/${locale}/`}>
        ← {t.back}
      </Link>
      <header className="collection-heading">
        <span className="eyebrow">A COLLECTION BY FLORISTLD</span>
        <h1>
          {textFor(c.title, locale)}
          <span className="accent">.</span>
        </h1>
        <p>{textFor(c.description, locale)}</p>
        <span className="pill">
          {c.artworkCount ?? arts.length}
          {c.artworkCount === undefined && next !== null ? "+" : ""} {t.works}
        </span>
      </header>
      <div className="artwork-grid">
        {arts.map((a) => (
          <article key={a.id}>
            <button
              className="artwork-button"
              onClick={() => select(a.id)}
              aria-label={`${t.detail}: ${textFor(a.title, locale)}`}
            >
              <ArtworkImage
                interactiveParent
                asset={data.assets.find((s) => s.id === a.assetId)}
                alt={textFor(a.alt, locale)}
              />
              <span className="artwork-open">↗</span>
            </button>
            <div className="artwork-caption">
              <h3>{textFor(a.title, locale)}</h3>
              <span>{a.year}</span>
            </div>
          </article>
        ))}
      </div>
      {!arts.length && (
        <div className="empty">
          <h2>{t.empty}</h2>
          <p>{t.emptyNote}</p>
        </div>
      )}
      {error && <p role="alert">{t.error}</p>}
      {next !== null && (
        <button className="button load-more" disabled={busy} onClick={more}>
          {busy ? t.loading : t.loadMore}
        </button>
      )}
      {selected && arts.some((a) => a.id === selected) && (
        <Lightbox
          artworks={arts}
          assets={data.assets}
          selected={selected}
          onSelect={select}
          onClose={() => select(null)}
        />
      )}
    </section>
  );
}
