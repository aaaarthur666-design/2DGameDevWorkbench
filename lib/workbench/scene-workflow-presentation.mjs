export function sceneWorkflowPath(manifest, documentId, workId) {
  const route = manifest.editorModules.find((entry) => entry.id === 'scene-composer')?.ui?.route;
  if (!route || !documentId) throw new Error('Scene workflow preview requires a saved scene.');
  // Shared scene loading also publishes its local scene identity. Include both
  // so the heartbeat can acknowledge arrival without a redirect/blocked loop.
  const query = new URLSearchParams({ document: documentId, scene: documentId });
  if (workId) query.set('sceneWorkflow', workId);
  return `${route}?${query}`;
}

export function sceneWorkflowPresentation(manifest, work) {
  return {
    title: work.plans.at(-1)?.plan.title || '场景协作',
    summary: work.message || '查看此场景任务的方案、进度和候选。',
    state: work.status,
    viewPath: sceneWorkflowPath(manifest, work.spec.documentId, work.id),
  };
}
