// 前端、演示适配层与 Worker 共用的领域契约；字段变动需同步接口校验和存储。
export type Locale = "zh" | "en";
export type Text = { zh: string; en: string };
export type Status = "draft" | "published";
export interface Collection {
  id: string;
  slug: string;
  title: Text;
  description: Text;
  status: Status;
  position: number;
  // 封面指向本合集作品的 ID，不是 Asset.id。
  coverId: string | null;
  // 服务端公开接口提供完整可见数量，不能用当前分页长度代替。
  artworkCount?: number;
  deletedAt: string | null;
  // 乐观锁版本；编辑和排序带回读取时的值，冲突后刷新再操作。
  version: number;
}
export interface Artwork {
  id: string;
  collectionId: string;
  title: Text;
  description: Text;
  alt: Text;
  year: string;
  status: Status;
  position: number;
  assetId: string;
  deletedAt: string | null;
  version: number;
}
export interface Asset {
  id: string;
  // 服务商文件 ID；公开响应会清空，不能依赖它做前端列表标识。
  fileId: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  verified: boolean;
  isPrivate: boolean;
}
export interface Profile {
  name: Text;
  tagline: Text;
  bio: Text;
  email: string;
  instagram: string;
  contact: string;
}
export interface GalleryData {
  usage?: { storedBytes: number; reservedBytes: number };
  collections: Collection[];
  artworks: Artwork[];
  assets: Asset[];
  profile: Profile;
}
export interface UploadTicket {
  sessionId: string;
  token: string;
  signature: string;
  expire: number;
  publicKey: string;
  fileName: string;
  folder: string;
}
export const blankText = (): Text => ({ zh: "", en: "" });
// 当前语言为空时回退另一语言；发布时的双语必填由业务校验保证。
export const textFor = (text: Text, locale: Locale) =>
  text[locale] || text[locale === "zh" ? "en" : "zh"];
