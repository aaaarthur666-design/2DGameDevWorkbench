export { imageAspectMatches as mapAspectMatches, planImageGenerationSize as planMapGenerationSize } from './image-generation-size.mjs';

export function mapOutputPrompt(prompt, output) {
  // Migrate only our known sentence, including old saved queue snapshots.
  const authored = prompt.replaceAll(
    'Return the same canvas dimensions and aspect ratio, with no crop, border or reframing.',
    'Preserve the canvas aspect ratio and composition, with no crop, border or reframing.',
  );
  return `${authored}\n\nOutput canvas requirement: Return exactly ${output.width} x ${output.height} pixels, matching the API size parameter. The reference may have a higher or lower resolution; preserve its full framing, aspect ratio and relative positions. Do not return the reference image pixel dimensions. The application will restore the output to the original map resolution and preserve its existing pixels.`;
}
