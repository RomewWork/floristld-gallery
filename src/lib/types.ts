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
  coverId: string | null;
  artworkCount?: number;
  deletedAt: string | null;
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
export const textFor = (text: Text, locale: Locale) =>
  text[locale] || text[locale === "zh" ? "en" : "zh"];
