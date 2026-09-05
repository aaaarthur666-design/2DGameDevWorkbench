import type { InteractableProject } from './contract.mjs';
export function readSourcePackage(
  bytes: ArrayBuffer | Uint8Array,
): Promise<InteractableProject>;
