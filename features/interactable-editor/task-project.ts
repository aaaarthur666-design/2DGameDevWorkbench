import { normalizeProject, projectSchema, makeId, type InteractableProject } from './contract.mjs';
import type { WorkItem } from '@/lib/workbench/work-items';

/** Import a persisted Agent result; retain any differing local draft as a separate project. */
export async function restoreTaskProject(taskId: string, storage: {
  read: (key: string) => Promise<unknown>;
  save: (key: string, project: InteractableProject, items: WorkItem[], mapping: string) => Promise<void>;
  request: typeof fetch;
  items: (project: InteractableProject, completed: string[]) => WorkItem[];
}): Promise<InteractableProject> {
  const mappingKey = `interactable-task:${taskId}`;
  const mapped = await storage.read(mappingKey);
  if (typeof mapped === 'string') {
    const saved = await storage.read(mapped);
    if (saved) return projectSchema.parse(saved);
  }
  const response = await storage.request(`/api/workbench/tasks/${encodeURIComponent(taskId)}`, { cache: 'no-store' });
  const payload = await response.json() as { task?: { capabilityId: string; status: string; outputs?: string[]; input?: { operation?: string } } };
  const task = payload.task;
  if (!response.ok || task?.capabilityId !== 'interactable-editor' || task.status !== 'completed')
    throw new Error('此交互物任务尚未完成或无法读取。');
  const source = task.outputs?.find((output: string) => output.endsWith('/interactable-project.json'));
  if (!source) throw new Error('任务缺少可编辑的交互物源文件。');
  const artifact = await storage.request(`/api/workbench/artifacts?path=${encodeURIComponent(source)}`, { cache: 'no-store' });
  if (!artifact.ok) throw new Error('交互物源文件暂时无法读取。');
  let project = normalizeProject(await artifact.json()) as InteractableProject;
  const key = `interactable-project:${project.projectId}`;
  const local = await storage.read(key);
  if (local && JSON.stringify(projectSchema.parse(local)) !== JSON.stringify(project)) {
    project = { ...project, projectId: makeId('project'), name: `${project.name.slice(0, 180)}（Agent 版本）` };
  }
  const completed = task.input?.operation === 'export-godot' ? project.objects.map((o) => o.definitionId) : [];
  await storage.save(`interactable-project:${project.projectId}`, project, storage.items(project, completed), mappingKey);
  return project;
}

