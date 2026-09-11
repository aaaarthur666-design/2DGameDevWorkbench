export type GodotExportOffer = {
  name: string;
  blob?: Blob;
  url?: string;
  assetId?: string;
  revision?: string;
  jobId?: string;
  candidateIndex?: number;
};
export function offerGodotExport(offer: GodotExportOffer) {
  window.dispatchEvent(
    new CustomEvent('forge:godot-export', { detail: offer }),
  );
}
