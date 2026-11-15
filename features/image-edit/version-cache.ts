import { readImageEdit, verifiedImagePixels } from './client';

export type VerifiedPixels = Awaited<ReturnType<typeof verifiedImagePixels>>;

/** Session versions are immutable. Cache only verified data, with a byte bound. */
export class ImageVersionCache {
  private entries = new Map<string, VerifiedPixels>();
  constructor(private readonly budget = 96 * 1024 * 1024) {}
  peek(editId: string, version: string) { return this.entries.get(`${editId}:${version}`); }
  put(editId: string, version: string, pixels: VerifiedPixels) {
    const key = `${editId}:${version}`;
    this.entries.delete(key); this.entries.set(key, pixels);
    let bytes = [...this.entries.values()].reduce((total, item) => total + item.pixels.byteLength + (item.previewSource?.length || 0) * 2, 0);
    for (const [old, item] of this.entries) {
      if (bytes <= this.budget) break;
      this.entries.delete(old); bytes -= item.pixels.byteLength + (item.previewSource?.length || 0) * 2;
    }
    return pixels;
  }
  async load(editId: string, version: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const cached = this.peek(editId, version);
    if (cached) { this.entries.delete(`${editId}:${version}`); this.entries.set(`${editId}:${version}`, cached); return cached; }
    const { edit } = await readImageEdit(editId, version, true, signal);
    if (edit.editId !== editId || edit.selectedVersion !== version || !edit.pixels) throw new Error('返回的图片版本与所选版本不一致。');
    const pixels = await verifiedImagePixels(edit.pixels);
    signal?.throwIfAborted();
    return this.put(editId, version, pixels);
  }
}

/** Last intent wins, including when an old fetch ignores cancellation. */
export class ImageViewRequest {
  private current?: AbortController;
  begin() { this.cancel(); this.current = new AbortController(); return this.current.signal; }
  cancel() { this.current?.abort(); this.current = undefined; }
}
