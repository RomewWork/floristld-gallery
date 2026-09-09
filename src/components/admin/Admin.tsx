"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Admin and public builds are deployed on separate origins. */
import { useCallback, useEffect, useRef, useState } from "react";
import { gallery, isDemo, me, mutate, exportData } from "@/lib/api";
import {
  blankText,
  textFor,
  type Artwork,
  type Collection,
  type GalleryData,
  type Locale,
  type Profile,
  type Text,
} from "@/lib/types";
import { processImage, type ProcessedImage } from "@/lib/process-image";
import { uploadImage } from "@/lib/upload";
const dictionary = {
  zh: {
    studio: "创作工作室",
    collections: "合集管理",
    profile: "画师资料",
    trash: "回收站",
    view: "查看画廊",
    create: "新建合集",
    save: "保存",
    cancel: "取消",
    publish: "发布",
    unpublish: "下架",
    edit: "编辑",
    remove: "移入回收站",
    restore: "恢复为草稿",
    destroy: "永久删除",
    upload: "添加作品",
    choose: "选择图片",
    name: "标题",
    description: "说明",
    alt: "图片描述（alt）",
    year: "创作年份",
    cover: "设为封面",
    draft: "草稿",
    published: "已发布",
    empty: "这里还没有内容",
    back: "返回合集",
    demo: "本地演示模式：不发送验证码，数据仅保存在此浏览器。",
    loading: "正在打开工作室…",
    retry: "重试",
    account: "当前账号",
    export: "导出内容",
    usage: "本站记录图片容量",
    usageNote: "不代表服务商实时用量；公开副本也会占用空间。",
    provider: "查看 ImageKit 用量",
    hint: "支持 JPEG / PNG / WebP。最多 50 MiB、4000 万像素；展示版不超过 5 MB。",
    preview: "先检查展示图，确认后上传。原文件不会被修改。",
    start: "上传至合集",
    failed: "失败",
    ready: "待上传",
    processing: "正在处理",
    done: "已添加为草稿",
    uploading: "正在上传",
    cancelled: "已取消",
    confirm: "确认永久删除？此操作不可恢复。",
    nameRequired: "请填写中英文标题",
    success: "已保存",
    signin: "登录工作室",
    logout: "退出登录",
    loginInfo: "使用允许名单中的邮箱接收验证码。",
    noPermission: "会话失效或没有访问权限",
    up: "向上移动",
    down: "向下移动",
    slug: "链接标识（英文）",
    contact: "其他联系方式",
    email: "联系邮箱",
    instagram: "Instagram 链接",
    artist: "画师名称",
    tagline: "首页简短介绍",
    bio: "关于介绍",
  },
  en: {
    studio: "Artist studio",
    collections: "Collections",
    profile: "Artist profile",
    trash: "Recycle bin",
    view: "View gallery",
    create: "New collection",
    save: "Save",
    cancel: "Cancel",
    publish: "Publish",
    unpublish: "Unpublish",
    edit: "Edit",
    remove: "Move to trash",
    restore: "Restore as draft",
    destroy: "Delete permanently",
    upload: "Add artworks",
    choose: "Choose images",
    name: "Title",
    description: "Description",
    alt: "Image description (alt)",
    year: "Year",
    cover: "Set as cover",
    draft: "Draft",
    published: "Published",
    empty: "Nothing here yet",
    back: "Back to collections",
    demo: "Local demo: no email is sent. Data stays in this browser only.",
    loading: "Opening the studio…",
    retry: "Retry",
    account: "Signed in as",
    export: "Export content",
    usage: "Recorded image storage",
    usageNote: "Not live provider usage. Published copies also use storage.",
    provider: "View ImageKit usage",
    hint: "JPEG / PNG / WebP. Up to 50 MiB and 40 megapixels; display image up to 5 MB.",
    preview:
      "Review the display image before uploading. Your original file stays untouched.",
    start: "Upload to collection",
    failed: "Failed",
    ready: "Ready",
    processing: "Processing",
    done: "Added as draft",
    uploading: "Uploading",
    cancelled: "Cancelled",
    confirm: "Permanently delete this item? This cannot be undone.",
    nameRequired: "Both Chinese and English titles are required",
    success: "Saved",
    signin: "Sign in to studio",
    logout: "Sign out",
    loginInfo: "Receive a verification code at an approved email address.",
    noPermission: "Session expired or access denied",
    up: "Move up",
    down: "Move down",
    slug: "URL slug",
    contact: "Other contact details",
    email: "Contact email",
    instagram: "Instagram URL",
    artist: "Artist name",
    tagline: "Homepage introduction",
    bio: "About biography",
  },
};
type Editor = { kind: "collections" | "artworks"; item?: Collection | Artwork };
export function Admin() {
  const [locale, setLocale] = useState<Locale>("zh");
  const t = dictionary[locale];
  const [data, setData] = useState<GalleryData | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"collections" | "profile" | "trash">(
    "collections",
  );
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [uploads, setUploads] = useState(false);
  const refresh = useCallback(async () => {
    const d = await gallery(true);
    setData(d);
  }, []);
  useEffect(() => {
    me()
      .then((x) => {
        setEmail(x.email);
        return refresh();
      })
      .catch((e) => setError(e.message));
  }, [refresh]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = (await fn()) as
        { cleanupPending?: boolean; message?: string } | undefined;
      await refresh();
      setNotice(
        result?.cleanupPending
          ? locale === "zh"
            ? "内容已移除，但图片清理尚未完成；请在回收站重试清理。"
            : "Content removed; image cleanup is pending. Retry cleanup in the recycle bin."
          : t.success,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const change = (kind: string, item: Collection | Artwork, op: string) =>
    action(() =>
      mutate(
        `/api/admin/${kind}/${item.id}${op === "delete" ? "" : `/${op}`}`,
        op === "delete" || op === "permanent" ? "DELETE" : "POST",
        { version: item.version },
      ),
    );
  const selected = data?.collections.find((c) => c.id === collectionId);
  const download = () =>
    action(async () => {
      const d = await exportData();
      const u = URL.createObjectURL(
        new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = u;
      a.download = `gallery-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(u);
    });
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <a
          className="brand"
          href={process.env.NEXT_PUBLIC_SITE_URL || `/${locale}/`}
        >
          ✳ floristld.
        </a>
        <span className="eyebrow">THE ARTIST’S STUDIO</span>
        <nav>
          {(["collections", "profile", "trash"] as const).map((key, i) => (
            <button
              key={key}
              className={tab === key ? "selected" : ""}
              onClick={() => {
                setTab(key);
                setCollectionId(null);
                setUploads(false);
              }}
            >
              <span>{["▦", "✎", "↺"][i]}</span>
              {t[key]}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <span>{t.account}</span>
          <strong>{email || "—"}</strong>
          <a href={process.env.NEXT_PUBLIC_SITE_URL || `/${locale}/`}>
            {t.view} ↗
          </a>
          {!isDemo && <a href="/cdn-cgi/access/logout">{t.logout}</a>}
          <button onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>
            {locale === "zh" ? "English" : "中文"}
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-header">
          <div>
            <span className="eyebrow">A PLACE FOR YOUR STORIES</span>
            <h1>{selected ? textFor(selected.title, locale) : t[tab]}</h1>
          </div>
          {tab === "collections" && !selected && (
            <button
              className="button"
              onClick={() => setEditor({ kind: "collections" })}
            >
              ＋ {t.create}
            </button>
          )}
          {selected && (
            <button className="button" onClick={() => setUploads(!uploads)}>
              ＋ {t.upload}
            </button>
          )}
        </header>
        {isDemo && <div className="admin-demo">{t.demo}</div>}
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button
              onClick={() => {
                setError("");
                refresh().catch((e) => setError(e.message));
              }}
            >
              {t.retry}
            </button>
            {!email && !isDemo && (
              <a href={process.env.NEXT_PUBLIC_ADMIN_URL || "/admin/"}>
                {t.signin}
              </a>
            )}
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            {notice}
          </div>
        )}
        {!data ? (
          <p>{error ? t.noPermission : t.loading}</p>
        ) : (
          <>
            <div className="admin-stats">
              <div>
                <span>{t.collections}</span>
                <strong>
                  {data.collections
                    .filter((c) => !c.deletedAt)
                    .length.toString()
                    .padStart(2, "0")}
                </strong>
              </div>
              <div>
                <span>{locale === "zh" ? "作品" : "Artworks"}</span>
                <strong>
                  {data.artworks
                    .filter((a) => !a.deletedAt)
                    .length.toString()
                    .padStart(2, "0")}
                </strong>
              </div>
              <div>
                <span>{t.usage}</span>
                <strong>
                  {(
                    (data.usage?.storedBytes ??
                      data.assets.reduce((n, a) => n + a.bytes, 0)) / 1e6
                  ).toFixed(1)}{" "}
                  <small>MB</small>
                </strong>
                <p>{t.usageNote}</p>
                <a
                  href="https://imagekit.io/dashboard"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t.provider} ↗
                </a>
              </div>
            </div>
            {tab === "collections" && !selected && (
              <div className="admin-collection-list">
                {[...data.collections]
                  .filter((c) => !c.deletedAt)
                  .sort((a, b) => a.position - b.position)
                  .map((c, index, all) => {
                    const a = data.artworks.find((a) => a.id === c.coverId);
                    const s = data.assets.find((s) => s.id === a?.assetId);
                    return (
                      <article className="admin-collection" key={c.id}>
                        <button
                          className="admin-cover"
                          onClick={() => setCollectionId(c.id)}
                        >
                          {s ? (
                            <img src={s.url} alt={textFor(c.title, locale)} />
                          ) : (
                            <span>✳</span>
                          )}
                        </button>
                        <div>
                          <span className={`status ${c.status}`}>
                            {t[c.status]}
                          </span>
                          <h2>
                            <button onClick={() => setCollectionId(c.id)}>
                              {textFor(c.title, locale)}
                            </button>
                          </h2>
                          <p>
                            {c.slug} ·{" "}
                            {
                              data.artworks.filter(
                                (a) => a.collectionId === c.id && !a.deletedAt,
                              ).length
                            }{" "}
                            {locale === "zh" ? "件作品" : "artworks"}
                          </p>
                          <div className="row-actions">
                            <button
                              aria-label={t.up}
                              disabled={busy || index === 0}
                              onClick={() =>
                                action(() => {
                                  const ids = all.map((x) => x.id);
                                  [ids[index], ids[index - 1]] = [
                                    ids[index - 1],
                                    ids[index],
                                  ];
                                  return mutate(
                                    "/api/admin/collections/order",
                                    "POST",
                                    {
                                      collectionIds: ids,
                                      versions: Object.fromEntries(
                                        all.map((c) => [c.id, c.version]),
                                      ),
                                    },
                                  );
                                })
                              }
                            >
                              ↑
                            </button>
                            <button
                              aria-label={t.down}
                              disabled={busy || index === all.length - 1}
                              onClick={() =>
                                action(() => {
                                  const ids = all.map((x) => x.id);
                                  [ids[index], ids[index + 1]] = [
                                    ids[index + 1],
                                    ids[index],
                                  ];
                                  return mutate(
                                    "/api/admin/collections/order",
                                    "POST",
                                    {
                                      collectionIds: ids,
                                      versions: Object.fromEntries(
                                        all.map((c) => [c.id, c.version]),
                                      ),
                                    },
                                  );
                                })
                              }
                            >
                              ↓
                            </button>
                            <button
                              onClick={() =>
                                setEditor({ kind: "collections", item: c })
                              }
                            >
                              {t.edit}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                change(
                                  "collections",
                                  c,
                                  c.status === "published"
                                    ? "unpublish"
                                    : "publish",
                                )
                              }
                            >
                              {c.status === "published"
                                ? t.unpublish
                                : t.publish}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => change("collections", c, "delete")}
                            >
                              {t.remove}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                {!data.collections.some((c) => !c.deletedAt) && (
                  <div className="empty">{t.empty}</div>
                )}
              </div>
            )}
            {tab === "collections" && selected && (
              <>
                <button
                  className="back-link"
                  onClick={() => {
                    setCollectionId(null);
                    setUploads(false);
                  }}
                >
                  ← {t.back}
                </button>
                {uploads && (
                  <UploadPanel
                    collectionId={selected.id}
                    locale={locale}
                    onDone={refresh}
                  />
                )}
                <div className="admin-art-grid">
                  {data.artworks
                    .filter(
                      (a) => a.collectionId === selected.id && !a.deletedAt,
                    )
                    .sort((a, b) => a.position - b.position)
                    .map((a, i, all) => {
                      const s = data.assets.find((s) => s.id === a.assetId);
                      const reorder = (offset: number) =>
                        action(async () => {
                          const ids = all.map((a) => a.id);
                          [ids[i], ids[i + offset]] = [ids[i + offset], ids[i]];
                          await mutate(
                            `/api/admin/collections/${selected.id}/order`,
                            "POST",
                            { artworkIds: ids, version: selected.version },
                          );
                        });
                      return (
                        <article className="admin-art-card" key={a.id}>
                          {s && (
                            <img src={s.url} alt={textFor(a.alt, locale)} />
                          )}
                          <div className="admin-art-body">
                            <span className={`status ${a.status}`}>
                              {t[a.status]}
                              {selected.coverId === a.id ? " · COVER" : ""}
                            </span>
                            <h3>{textFor(a.title, locale)}</h3>
                            <div className="row-actions">
                              <button
                                onClick={() =>
                                  setEditor({ kind: "artworks", item: a })
                                }
                              >
                                {t.edit}
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  change(
                                    "artworks",
                                    a,
                                    a.status === "published"
                                      ? "unpublish"
                                      : "publish",
                                  )
                                }
                              >
                                {a.status === "published"
                                  ? t.unpublish
                                  : t.publish}
                              </button>
                              <button
                                disabled={busy || a.status !== "published"}
                                onClick={() =>
                                  action(() =>
                                    mutate(
                                      `/api/admin/collections/${selected.id}`,
                                      "PATCH",
                                      {
                                        coverId: a.id,
                                        version: selected.version,
                                      },
                                    ),
                                  )
                                }
                              >
                                {t.cover}
                              </button>
                              <button
                                disabled={busy || i === 0}
                                onClick={() => reorder(-1)}
                                aria-label={t.up}
                              >
                                ↑
                              </button>
                              <button
                                disabled={busy || i === all.length - 1}
                                onClick={() => reorder(1)}
                                aria-label={t.down}
                              >
                                ↓
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => change("artworks", a, "delete")}
                              >
                                {t.remove}
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                </div>
              </>
            )}
            {tab === "profile" && (
              <ProfileEditor
                profile={data.profile}
                locale={locale}
                onSave={(p) =>
                  action(() =>
                    mutate(
                      "/api/admin/profile",
                      "PATCH",
                      p as unknown as Record<string, unknown>,
                    ),
                  )
                }
              />
            )}
            {tab === "trash" && (
              <div className="trash-list">
                {[
                  ...data.collections.map((c) => ({
                    kind: "collections",
                    item: c,
                  })),
                  ...data.artworks.map((a) => ({ kind: "artworks", item: a })),
                ]
                  .filter((x) => x.item.deletedAt)
                  .map(({ kind, item }) => (
                    <article key={item.id}>
                      <div>
                        <span className="eyebrow">{kind}</span>
                        <h3>{textFor(item.title, locale)}</h3>
                      </div>
                      <div className="row-actions">
                        <button
                          disabled={busy}
                          onClick={() => change(kind, item, "restore")}
                        >
                          {t.restore}
                        </button>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(t.confirm))
                              change(kind, item, "permanent");
                          }}
                        >
                          {t.destroy}
                        </button>
                      </div>
                    </article>
                  ))}
                {!data.collections.some((c) => c.deletedAt) &&
                  !data.artworks.some((a) => a.deletedAt) && (
                    <div className="empty">{t.empty}</div>
                  )}
                <h2>
                  {locale === "zh"
                    ? "未关联图片与待清理文件"
                    : "Unlinked images & pending cleanup"}
                </h2>
                <p>
                  {locale === "zh"
                    ? "包括上传后尚未添加为作品的图片。请先结束上传，再清理不再需要的文件；删除后无法恢复。"
                    : "Includes uploads not yet attached to an artwork. Finish uploading before cleaning up unused files. Deletion is permanent."}
                </p>
                {data.assets
                  .filter((s) => !data.artworks.some((a) => a.assetId === s.id))
                  .map((s) => (
                    <article key={s.id}>
                      <div>
                        <strong>{s.id}</strong>
                        <p>
                          {s.width} × {s.height} · {(s.bytes / 1e6).toFixed(2)}{" "}
                          MB
                        </p>
                      </div>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(t.confirm))
                            action(() =>
                              mutate(`/api/admin/assets/${s.id}`, "DELETE"),
                            );
                        }}
                      >
                        {locale === "zh"
                          ? "永久清理图片"
                          : "Permanently clean up image"}
                      </button>
                    </article>
                  ))}
              </div>
            )}
            <div className="admin-bottom">
              <span>FLORISTLD STUDIO · {new Date().getFullYear()}</span>
              <button onClick={download}>{t.export} ↓</button>
            </div>
          </>
        )}
        {editor && (
          <EditDialog
            editor={editor}
            locale={locale}
            onClose={() => setEditor(null)}
            onSave={async (body) => {
              await mutate(
                `/api/admin/${editor.kind}${editor.item ? `/${editor.item.id}` : ""}`,
                editor.item ? "PATCH" : "POST",
                {
                  ...body,
                  ...(editor.item ? { version: editor.item.version } : {}),
                },
              );
              await refresh();
              setEditor(null);
              setNotice(t.success);
            }}
          />
        )}
      </main>
    </div>
  );
}
function Bilingual({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: Text;
  onChange: (v: Text) => void;
  multiline?: boolean;
}) {
  return (
    <fieldset className="bilingual">
      <legend>{label}</legend>
      {(["zh", "en"] as const).map((locale) => (
        <label key={locale}>
          <span>{locale === "zh" ? "中文" : "English"}</span>
          {multiline ? (
            <textarea
              value={value[locale]}
              onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
              rows={4}
            />
          ) : (
            <input
              value={value[locale]}
              onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
              maxLength={200}
            />
          )}
        </label>
      ))}
    </fieldset>
  );
}
function EditDialog({
  editor,
  locale,
  onClose,
  onSave,
}: {
  editor: Editor;
  locale: Locale;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const t = dictionary[locale];
  const [title, setTitle] = useState(editor.item?.title || blankText());
  const [description, setDescription] = useState(
    editor.item?.description || blankText(),
  );
  const [slug, setSlug] = useState((editor.item as Collection)?.slug || "");
  const [alt, setAlt] = useState((editor.item as Artwork)?.alt || blankText());
  const [year, setYear] = useState(
    (editor.item as Artwork)?.year || String(new Date().getFullYear()),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog className="editor-dialog" ref={ref} onCancel={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await onSave({
              title,
              description,
              ...(editor.kind === "collections" ? { slug } : { alt, year }),
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="dialog-title">
          <h2>{editor.item ? t.edit : t.create}</h2>
          <button type="button" onClick={onClose} aria-label={t.cancel}>
            ✕
          </button>
        </div>
        <Bilingual label={t.name} value={title} onChange={setTitle} />
        {editor.kind === "collections" ? (
          <label className="field">
            {t.slug}
            <input
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="botanical-dreams"
            />
          </label>
        ) : (
          <>
            <Bilingual label={t.alt} value={alt} onChange={setAlt} />
            <label className="field">
              {t.year}
              <input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                maxLength={20}
              />
            </label>
          </>
        )}
        <Bilingual
          label={t.description}
          value={description}
          onChange={setDescription}
          multiline
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t.cancel}
          </button>
          <button className="button" disabled={saving}>
            {t.save}
          </button>
        </div>
      </form>
    </dialog>
  );
}
function ProfileEditor({
  profile,
  locale,
  onSave,
}: {
  profile: Profile;
  locale: Locale;
  onSave: (p: Profile) => Promise<void>;
}) {
  const t = dictionary[locale];
  const [p, setP] = useState(profile);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="profile-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSave(p);
        setBusy(false);
      }}
    >
      {(["name", "tagline", "bio"] as const).map((key, i) => (
        <Bilingual
          key={key}
          label={[t.artist, t.tagline, t.bio][i]}
          value={p[key]}
          onChange={(v) => setP({ ...p, [key]: v })}
          multiline={key === "bio"}
        />
      ))}
      {(["email", "instagram", "contact"] as const).map((key) => (
        <label className="field" key={key}>
          {t[key]}
          <input
            value={p[key]}
            type={
              key === "email" ? "email" : key === "instagram" ? "url" : "text"
            }
            onChange={(e) => setP({ ...p, [key]: e.target.value })}
          />
        </label>
      ))}
      <button className="button" disabled={busy}>
        {t.save}
      </button>
    </form>
  );
}
type QueueItem = {
  id: string;
  file: File;
  image?: ProcessedImage;
  title: Text;
  state: "processing" | "ready" | "uploading" | "done" | "failed" | "cancelled";
  progress: number;
  error?: string;
  controller?: AbortController;
  assetId?: string;
};
function UploadPanel({
  collectionId,
  locale,
  onDone,
}: {
  collectionId: string;
  locale: Locale;
  onDone: () => Promise<void>;
}) {
  const t = dictionary[locale];
  const [items, setItems] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [running, setRunning] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const active = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const urls = useRef<string[]>([]);
  useEffect(() => {
    active.current = true;
    const previews = urls.current;
    const inflight = controllers.current;
    return () => {
      active.current = false;
      previews.forEach(URL.revokeObjectURL);
      inflight.forEach((controller) => controller.abort());
    };
  }, []);
  const update = (id: string, patch: Partial<QueueItem>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const choose = async (files: File[]) => {
    setProcessing(true);
    for (const file of files) {
      if (!active.current) break;
      const id = crypto.randomUUID();
      setItems((list) => [
        ...list,
        { id, file, title: blankText(), state: "processing", progress: 0 },
      ]);
      try {
        const image = await processImage(file);
        if (!active.current) {
          URL.revokeObjectURL(image.preview);
          break;
        }
        urls.current.push(image.preview);
        update(id, { image, state: "ready" });
      } catch (e) {
        update(id, {
          state: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (active.current) setProcessing(false);
  };
  const refresh = async () => {
    setRefreshError(false);
    try {
      await onDone();
    } catch {
      if (active.current) setRefreshError(true);
    }
  };
  const run = async () => {
    setRunning(true);
    const pending = items.filter(
      (i) => i.image && ["ready", "failed", "cancelled"].includes(i.state),
    );
    let current = 0;
    async function work() {
      while (active.current && current < pending.length) {
        const item = pending[current++];
        if (!item.title.zh.trim() || !item.title.en.trim()) {
          update(item.id, { state: "failed", error: t.nameRequired });
          continue;
        }
        const controller = new AbortController();
        controllers.current.add(controller);
        update(item.id, { controller, state: "uploading", error: undefined });
        try {
          let assetId = item.assetId;
          if (!assetId) {
            const asset = await uploadImage(
              item.image!,
              controller.signal,
              (n) => update(item.id, { progress: n }),
            );
            assetId = asset.id;
            update(item.id, { assetId });
          }
          if (!active.current || controller.signal.aborted)
            throw new DOMException("Cancelled", "AbortError");
          await mutate(
            "/api/admin/artworks",
            "POST",
            {
              creationId: item.id,
              collectionId,
              assetId,
              title: item.title,
              alt: item.title,
              description: blankText(),
              year: String(new Date().getFullYear()),
            },
            controller.signal,
          );
          update(item.id, { state: "done", progress: 100 });
        } catch (e) {
          update(item.id, {
            state:
              e instanceof DOMException && e.name === "AbortError"
                ? "cancelled"
                : "failed",
            error: e instanceof Error ? e.message : String(e),
          });
        } finally {
          controllers.current.delete(controller);
        }
      }
    }
    try {
      await Promise.all([work(), work()]);
      if (active.current) await refresh();
    } finally {
      if (active.current) setRunning(false);
    }
  };
  return (
    <section className="upload-panel">
      <h2>{t.upload}</h2>
      <p>{t.hint}</p>
      {refreshError && (
        <div className="upload-refresh-error error" role="alert">
          <p>
            {locale === "zh"
              ? "上传处理已结束，但作品列表刷新失败。请重试刷新列表。"
              : "Uploads finished, but the artwork list could not refresh. Retry refreshing the list."}
          </p>
          <button disabled={running} onClick={refresh}>
            {locale === "zh" ? "重试刷新" : "Retry refresh"}
          </button>
        </div>
      )}
      <label className="upload-drop">
        <span>＋</span>
        <strong>{t.choose}</strong>
        <small>{t.preview}</small>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={processing || running}
          onChange={(e) => {
            choose(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
      </label>
      {items.map((item) => (
        <article className="queue-item" key={item.id}>
          {item.image && <img src={item.image.preview} alt="Upload preview" />}
          <div>
            <strong>{item.file.name}</strong>
            <span>
              {item.image
                ? `${item.image.width} × ${item.image.height} · ${(item.image.blob.size / 1e6).toFixed(2)} MB`
                : t.processing}
            </span>
            <div className="queue-titles">
              <input
                aria-label="中文标题"
                placeholder="中文标题"
                value={item.title.zh}
                disabled={["done", "uploading"].includes(item.state)}
                onChange={(e) =>
                  update(item.id, {
                    title: { ...item.title, zh: e.target.value },
                  })
                }
              />
              <input
                aria-label="English title"
                placeholder="English title"
                value={item.title.en}
                disabled={["done", "uploading"].includes(item.state)}
                onChange={(e) =>
                  update(item.id, {
                    title: { ...item.title, en: e.target.value },
                  })
                }
              />
            </div>
            <span className={item.state === "failed" ? "error" : ""}>
              {t[item.state]}{" "}
              {item.state === "uploading" ? `${item.progress}%` : ""}
            </span>
            {item.state === "uploading" && (
              <progress value={item.progress} max={100} />
            )}
            {item.error && <small className="error">{item.error}</small>}
          </div>
          {item.state === "uploading" && (
            <button onClick={() => item.controller?.abort()}>{t.cancel}</button>
          )}
        </article>
      ))}
      {items.some((i) => i.image && i.state !== "done") && (
        <button
          className="button"
          disabled={running || processing}
          onClick={run}
        >
          {running ? t.uploading : t.start}
        </button>
      )}
    </section>
  );
}
