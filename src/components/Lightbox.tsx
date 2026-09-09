"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Artwork, Asset } from "@/lib/types";
import { textFor } from "@/lib/types";
import { useLocale } from "./Shell";
import { messages } from "@/lib/messages";
import { imageUrl } from "./Gallery";
export function Lightbox({
  artworks,
  assets,
  selected,
  onSelect,
  onClose,
}: {
  artworks: Artwork[];
  assets: Asset[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const locale = useLocale(),
    t = messages[locale];
  const index = artworks.findIndex((a) => a.id === selected);
  const a = artworks[index];
  const asset = assets.find((s) => s.id === a.assetId);
  const [zoom, setZoom] = useState(1);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dialog = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef({ x: 0, y: 0, distance: 0 });
  const start = useRef({ x: 0, y: 0 });
  const closeRef = useRef(onClose);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    closeRef.current = onClose;
    selectRef.current = onSelect;
  }, [onClose, onSelect]);
  useEffect(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, [selected]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "ArrowRight")
        selectRef.current(artworks[(index + 1) % artworks.length].id);
      if (e.key === "ArrowLeft")
        selectRef.current(
          artworks[(index - 1 + artworks.length) % artworks.length].id,
        );
      if (e.key === "Tab") {
        const list = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href]",
          ) || [],
        );
        const first = list[0],
          end = list.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog.current)
        ) {
          e.preventDefault();
          end?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === end ||
            document.activeElement === dialog.current)
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [index, artworks]);
  const adjust = (z: number) => {
    setZoom(Math.max(1, Math.min(4, z)));
    if (z <= 1) setPosition({ x: 0, y: 0 });
  };
  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lightbox-title"
      ref={dialog}
      tabIndex={-1}
    >
      <div className="lightbox-top">
        <span>
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(artworks.length).padStart(2, "0")}
        </span>
        <div className="lightbox-controls">
          <button onClick={() => adjust(zoom - 0.5)} aria-label={t.zoomOut}>
            −
          </button>
          <button
            onClick={() => {
              adjust(1);
            }}
            aria-label={t.resetZoom}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => adjust(zoom + 0.5)} aria-label={t.zoomIn}>
            ＋
          </button>
          <button
            className="lightbox-close"
            onClick={onClose}
            aria-label={t.close}
          >
            ✕
          </button>
        </div>
      </div>
      <div
        className="lightbox-stage"
        onWheel={(e) => {
          if (e.ctrlKey) adjust(zoom + (e.deltaY < 0 ? 0.2 : -0.2));
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          start.current = { x: e.clientX, y: e.clientY };
          last.current = { x: e.clientX, y: e.clientY, distance: 0 };
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const values = [...pointers.current.values()];
          if (values.length === 2) {
            const distance = Math.hypot(
              values[0].x - values[1].x,
              values[0].y - values[1].y,
            );
            if (last.current.distance)
              adjust((zoom * distance) / last.current.distance);
            last.current.distance = distance;
          } else if (zoom > 1) {
            setPosition((p) => ({
              x: p.x + e.clientX - last.current.x,
              y: p.y + e.clientY - last.current.y,
            }));
          }
          last.current.x = e.clientX;
          last.current.y = e.clientY;
        }}
        onPointerUp={(e) => {
          if (
            pointers.current.size === 1 &&
            zoom === 1 &&
            Math.abs(e.clientX - start.current.x) > 70 &&
            Math.abs(e.clientY - start.current.y) < 80
          )
            onSelect(
              artworks[
                (index +
                  (e.clientX < start.current.x ? 1 : -1) +
                  artworks.length) %
                  artworks.length
              ].id,
            );
          pointers.current.delete(e.pointerId);
          last.current.distance = 0;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          last.current.distance = 0;
        }}
      >
        {!asset || failedUrl === asset.url ? (
          <div className="image-missing" role="alert">
            <p>{t.error}</p>
            {asset && (
              <button
                onClick={() => {
                  setFailedUrl(null);
                  setImageAttempt((n) => n + 1);
                }}
              >
                {t.retry} ↻
              </button>
            )}
          </div>
        ) : (
          <img
            key={`${asset.id}-${imageAttempt}`}
            draggable={false}
            src={imageUrl(asset, 3840)}
            alt={textFor(a.alt, locale)}
            onError={() => setFailedUrl(asset.url)}
            style={{
              transform: `translate(${position.x}px,${position.y}px) scale(${zoom})`,
            }}
          />
        )}
      </div>
      <button
        className="lightbox-prev"
        onClick={() =>
          onSelect(artworks[(index - 1 + artworks.length) % artworks.length].id)
        }
        aria-label={t.previous}
      >
        ←
      </button>
      <button
        className="lightbox-next"
        onClick={() => onSelect(artworks[(index + 1) % artworks.length].id)}
        aria-label={t.next}
      >
        →
      </button>
      <div className="lightbox-caption">
        <div>
          <h2 id="lightbox-title">{textFor(a.title, locale)}</h2>
          <p>{textFor(a.description, locale)}</p>
        </div>
        <span>{a.year}</span>
      </div>
    </div>,
    document.body,
  );
}
