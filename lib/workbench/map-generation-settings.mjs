// Compatibility entry point for map tools during extraction.
export {
  getPublicImageGenerationSettings as getPublicMapGenerationSettings,
  updateImageGenerationSettings as updateMapGenerationSettings,
  resolveImageGenerationProvider as resolveMapGenerationProvider,
  validateImageApiKey as validateMapApiKey,
} from './image-generation-settings.mjs';
