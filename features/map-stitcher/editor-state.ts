import type {
  FrameRoninTile,
  MapImageLayer,
  RegionShape,
} from './frame-ronin-types';

export interface MapDocument {
  tiles: FrameRoninTile[];
  shapes: RegionShape[];
}
export type EditorMode = 'navigate' | 'region' | 'pixel';
export type RegionScope = 'view' | 'tile';
export type EditorSelection =
  | { kind: 'none' }
  | { kind: 'tile'; tileKey: string }
  | { kind: 'region'; tileKey: string; id: string };
export interface EditorPreferences {
  regionScope: RegionScope;
  showRegions: boolean;
  showImage: boolean;
  concurrency: number;
  memoryProtection: boolean;
  memoryLimitMb: number;
}
export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  regionScope: 'view',
  showRegions: true,
  showImage: true,
  concurrency: 1,
  memoryProtection: true,
  memoryLimitMb: 1024,
};

/** History owns immutable documents, including image references. View changes never enter it. */
export class MapHistory {
  past: Array<{ document: MapDocument; label: string }> = [];
  future: Array<{ document: MapDocument; label: string }> = [];
  private listeners = new Set<() => void>();
  private view: {
    document: MapDocument;
    past: MapHistory['past'];
    future: MapHistory['future'];
    revision: number;
  };
  constructor(
    public document: MapDocument = { tiles: [], shapes: [] },
    private limit = 80,
  ) {
    this.view = { document, past: this.past, future: this.future, revision: 0 };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.view;
  private notify() {
    this.view = {
      document: this.document,
      past: this.past,
      future: this.future,
      revision: this.view.revision + 1,
    };
    for (const listener of this.listeners) listener();
  }
  reset(document: MapDocument) {
    this.document = document;
    this.past = [];
    this.future = [];
    this.notify();
  }
  clearHistory() {
    this.past = [];
    this.future = [];
    this.notify();
  }
  commit(next: MapDocument, label: string) {
    if (next === this.document) return;
    this.past = [
      ...this.past.slice(-(this.limit - 1)),
      { document: this.document, label },
    ];
    this.future = [];
    this.document = next;
    this.notify();
  }
  undo() {
    const previous = this.past.at(-1);
    if (!previous) return false;
    this.past = this.past.slice(0, -1);
    this.future = [
      ...this.future,
      { document: this.document, label: previous.label },
    ];
    this.document = previous.document;
    this.notify();
    return true;
  }
  redo() {
    const next = this.future.at(-1);
    if (!next) return false;
    this.future = this.future.slice(0, -1);
    this.past = [...this.past, { document: this.document, label: next.label }];
    this.document = next.document;
    this.notify();
    return true;
  }
  documents() {
    return [
      this.document,
      ...this.past.map((entry) => entry.document),
      ...this.future.map((entry) => entry.document),
    ];
  }
}

export interface ImageWriteTicket {
  epoch: number;
  tileKey: string;
  layer: MapImageLayer;
  before: string | undefined;
  lockVersion: number;
}
export function assertImageWrite(
  ticket: ImageWriteTicket,
  document: MapDocument,
  epoch: number,
  locked: boolean,
  lockVersion: number,
) {
  if (ticket.epoch !== epoch)
    throw new Error('地图或历史已改变，已丢弃旧操作结果。');
  if (locked || ticket.lockVersion !== lockVersion)
    throw new Error('目标图片锁定状态已改变，未写入结果。');
  const tile = document.tiles.find((item) => item.key === ticket.tileKey);
  if (!tile) throw new Error('目标地图块已不存在。');
  if (tile.images[ticket.layer]?.url !== ticket.before)
    throw new Error('目标图片已更新，未覆盖新的内容。');
}

export function retainedAssets(documents: MapDocument[]) {
  const assets = new Map<
    string,
    NonNullable<FrameRoninTile['images'][MapImageLayer]>
  >();
  for (const document of documents)
    for (const tile of document.tiles)
      for (const asset of Object.values(tile.images)) {
        if (asset) assets.set(asset.url, asset);
      }
  return assets;
}

export function readEditorPreferences(value: unknown): EditorPreferences {
  const data =
    value && typeof value === 'object'
      ? (value as Partial<EditorPreferences>)
      : {};
  const number = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(min, Math.min(max, Math.round(v)))
      : fallback;
  return {
    regionScope: data.regionScope === 'tile' ? 'tile' : 'view',
    showRegions: data.showRegions !== false,
    showImage: data.showImage !== false,
    concurrency: number(data.concurrency, 1, 1, 4),
    memoryProtection: data.memoryProtection !== false,
    memoryLimitMb: number(data.memoryLimitMb, 1024, 64, 8192),
  };
}
