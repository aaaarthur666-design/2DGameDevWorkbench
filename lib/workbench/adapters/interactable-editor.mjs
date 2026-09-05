import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  selectedProject,
  describeError,
} from '../../../features/interactable-editor/contract.mjs';
import { buildGodotPackage } from '../../../features/interactable-editor/godot-builder.mjs';

export function validateInteractableInput(input) {
  if (input.operation !== 'export-godot')
    return ['operation must be export-godot.'];
  if (
    input.targetProfile !== undefined &&
    !['generic', 'copyworms'].includes(input.targetProfile)
  )
    return ['targetProfile must be generic or copyworms.'];
  try {
    selectedProject(input.project, input.selectedDefinitionIds);
    return [];
  } catch (e) {
    return [describeError(e)];
  }
}
export async function executeInteractable({
  input,
  outputDirectory,
  repositoryRoot,
}) {
  const result = await buildGodotPackage(input, {
    repositoryRoot,
    exportId: path.basename(outputDirectory),
  });
  const zipName =
    result.metadata.targetProfile === 'copyworms'
      ? 'interactables-copyworms.zip'
      : 'interactables.zip';
  await writeFile(path.join(outputDirectory, zipName), result.bytes);
  // Standalone JSON is portable as well: assets are embedded, never dangling zip paths.
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(result.bytes);
  const portable = {
    ...result.source,
    assets: await Promise.all(
      result.source.assets.map(async (a) => ({
        ...a,
        source: `data:${a.mime};base64,${await zip.file(a.source).async('base64')}`,
      })),
    ),
  };
  await writeFile(
    path.join(outputDirectory, 'interactable-project.json'),
    JSON.stringify(portable, null, 2),
  );
  return {
    status: 'completed',
    generatedOutputNames: [zipName, 'interactable-project.json'],
    result: result.metadata,
    adapter: {
      id: 'interactable-editor',
      operation: 'export-godot',
      targetProfile: result.metadata.targetProfile,
    },
  };
}
