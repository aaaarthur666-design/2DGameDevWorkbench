import sharp from 'sharp';
import { mapAspectMatches } from './map-generation-size.mjs';

/** Only fully transparent template pixels may be replaced, independently of the provider. */
export async function preserveMapTemplatePixels(source, generated) {
  const options = { limitInputPixels: 64_000_000 };
  const template = await sharp(source, options)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = template.info;
  const metadata = await sharp(generated, options).metadata();
  // Uniform resizing is allowed; silently stretching a side-view scene is not.
  if (
    !metadata.width ||
    !metadata.height ||
    !mapAspectMatches(width, height, metadata.width, metadata.height)
  ) {
    throw new Error(
      `生成图片宽高比与扩图模板不一致：模板 ${width}×${height}，返回 ${metadata.width ?? '?'}×${metadata.height ?? '?'}，无法在保持比例的同时保护接缝。`,
    );
  }
  const pixels = await sharp(generated, options)
    .resize(width, height, { kernel: 'nearest' })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (template.data[offset + 3] !== 0) {
      template.data.copy(pixels, offset, offset, offset + 4);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
