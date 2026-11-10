// Compatibility entry point; all callers share one protected settings store.
export { imageSettingsPath as mapSettingsPath, readImageSettings as readMapSettings, writeImageSettings as writeMapSettings } from './image-settings-store.mjs';
