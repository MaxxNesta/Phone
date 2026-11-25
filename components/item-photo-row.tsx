"use client";

import { useRef, useState } from "react";
import { shrink } from "./item-photo-field";

export type PhotoInfo = {
  /** The model's name: whose photo a variant falls back to. */
  modelName: string;
  /** A variant's colour (or whichever attribute photos belong to), and how many variants share it. */
  scope: { optionId: string; option: string; attribute: string; count: number } | null;
  /** The variant shows the model's photo: its colour has none of its own. */
  inherits: boolean;
  /** On a model: the colours that have their own photo. */
  colours: string[];
  /** The model's photo, what a variant falls back to. */
  modelPhoto: string | null;
};

/**
 * The photo, and whose it is (2026-11-25). A model's photo is every
 * variant's default; a variant's photo is its colour's, shown for every size
 * of that colour; else none. Every change says who it is for and is
 * confirmed before it is kept for the save.
 */
export function ItemPhotoRow({ mode, shown, own, info, variants, onChange }: {
  mode: "plain" | "model" | "variant";
  /** What shows now: own, the colour's, or the model's. */
  shown: string | null;
  /** The item's own stored photo. */
  own: string | null;
  info: PhotoInfo;
  variants: number;
  onChange: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState("");
  const [pending, setPending] = useState("");
  const [ask, setAsk] = useState<null | "set" | "remove">(null);
  const [removed, setRemoved] = useState(false);
  const [replaceAll, setReplaceAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colour = info.scope?.option;
  const preview = picked || (removed ? (mode === "variant" ? info.modelPhoto : null) : shown);
  const inherits = mode === "variant" && !picked && (removed || info.inherits);

  async function take(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("That file is not a photo."); return; }
    setError(null);
    try {
      const data = await shrink(file);
      if (mode === "plain") { setPicked(data); setRemoved(false); onChange(); return; }
      setPending(data); setAsk("set"); dialog.current?.showModal();
    } catch { setError("That photo could not be read."); }
    finally { if (input.current) input.current.value = ""; }
  }
  const confirm = () => {
    if (ask === "set") { setPicked(pending); setRemoved(false); }
    else { setPicked(""); setRemoved(true); }
    dialog.current?.close(); setAsk(null); onChange();
  };
  const askRemove = () => {
    if (mode === "plain") { setPicked(""); setRemoved(true); onChange(); return; }
    setAsk("remove"); dialog.current?.showModal();
  };

  const title = ask === "remove"
    ? (mode === "variant" ? `Go back to ${info.modelName}'s photo?` : "Remove the photo?")
    : mode === "model" ? "Use this photo for all variants?" : `Use this photo for ${colour}?`;
  const others = info.colours.filter(Boolean);

  return (
    <div className="ie3-photo">
      <input type="hidden" name="photo_data" value={picked} />
      <input type="hidden" name="photo_remove" value={removed && !picked ? "1" : ""} />
      {mode === "variant" && info.scope && <input type="hidden" name="photo_scope_option" value={picked || removed ? info.scope.optionId : ""} />}
      {mode === "model" && <input type="hidden" name="photo_replace_all" value={picked && replaceAll ? "1" : ""} />}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" tabIndex={-1}
        onChange={(e) => take(e.target.files?.[0])} />

      {preview
        // eslint-disable-next-line @next/next/no-img-element
        ? <span className={`ie3-shot${inherits ? " faded" : ""}`}><img src={preview} alt="" /></span>
        : <span className="ie3-shot empty" aria-label="No photo" />}
      <div className="ie3-photo-text">
        {mode === "model" && <>
          <strong>{preview ? `Default photo for all ${variants} variants` : "No photo yet"}</strong>
          <span>{others.length
            ? `${others.join(", ")} ${others.length === 1 ? "has its own photo and keeps it" : "have their own photos and keep them"}; the others show this one.`
            : "Every variant shows it until its colour gets its own."}</span>
        </>}
        {mode === "variant" && (inherits ? <>
          <strong>{preview ? `Using ${info.modelName}'s photo` : "No photo yet"}</strong>
          <span>Upload one to give {colour} its own, for every {colour} variant.</span>
        </> : <>
          <strong>{colour}&apos;s own photo</strong>
          <span>Shown for every {colour} variant instead of {info.modelName}&apos;s photo.</span>
        </>)}
        {mode === "plain" && <span>Shown on the till and in search. PNG, JPEG or WebP.</span>}
        <div className="ie3-photo-acts">
          <button type="button" className="ie3-btn" onClick={() => input.current?.click()}>
            {mode === "variant" ? `Upload photo for ${colour}` : preview ? "Change photo" : "Upload photo"}
          </button>
          {mode === "variant" && !inherits && <button type="button" className="ie3-btn ghost" onClick={askRemove}>Use {info.modelName}&apos;s photo</button>}
          {mode !== "variant" && (own || picked) && !removed && <button type="button" className="ie3-btn ghost" onClick={askRemove}>Remove</button>}
        </div>
        {error && <span className="ie3-error">{error}</span>}
      </div>

      <dialog ref={dialog} className="pl3-dialog ie3-dialog" onClose={() => setAsk(null)}
        onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
        <div className="pl3-dialog-head">
          <div><h2>{title}</h2></div>
          <button type="button" className="pl3-x" aria-label="Close" onClick={() => dialog.current?.close()}>×</button>
        </div>
        <div className="pl3-dialog-body ie3-dialog-body">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {ask === "set" && pending && <span className="ie3-shot"><img src={pending} alt="" /></span>}
          {ask === "set" && mode === "model" && <>
            <p>{info.modelName} and its {variants} variants show this photo: on the till, in search and on every list.</p>
            {others.length > 0 && (
              <label className="pl3-check"><input type="checkbox" checked={replaceAll} onChange={(e) => setReplaceAll(e.target.checked)} />
                <span>Also replace {others.join(", ")}&apos;s own photo{others.length === 1 ? "" : "s"}</span></label>
            )}
          </>}
          {ask === "set" && mode === "variant" && <p>Every {colour} variant{info.scope && info.scope.count > 1 ? ` (${info.scope.count})` : ""} shows this photo instead of {info.modelName}&apos;s. Other colours keep theirs.</p>}
          {ask === "remove" && mode === "variant" && <p>{colour}&apos;s own photo is removed. Every {colour} variant shows {info.modelName}&apos;s photo again.</p>}
          {ask === "remove" && mode === "model" && <p>Variants without a colour photo of their own will show no photo.</p>}
          <p className="pl3-hint">Kept when you save.</p>
        </div>
        <div className="pl3-dialog-foot">
          <button type="button" className="pl3-btn" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="button" className="pl3-btn primary" style={{ marginLeft: 8 }} onClick={confirm}>
            {ask === "remove" ? (mode === "variant" ? `Remove ${colour} photo` : "Remove photo") : mode === "model" ? "Use for all variants" : `Use for ${colour}`}
          </button>
        </div>
      </dialog>
    </div>
  );
}
