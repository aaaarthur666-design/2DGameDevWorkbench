// Read-only presentation shared by MCP, HTTP and CLI. No task creation or browser side effects.
export function taskViewPath(manifest, task, result = null, candidateIndex) {
  const route = manifest.capabilities.find((c) => c.id === task.capabilityId)
    ?.ui?.route;
  if (!route) return null;
  const query = new URLSearchParams();
  if (task.capabilityId === 'sprite-generator') {
    const job = task.adapter?.remoteJobId || task.input?.jobId || result?.jobId;
    if (!job) return `/advanced?task=${encodeURIComponent(task.id)}`;
    query.set('job', job);
    const candidate = candidateIndex ?? task.input?.candidateIndex;
    if (Number.isInteger(candidate) && candidate > 0)
      query.set('candidate', String(candidate));
  } else if (task.capabilityId === 'reference-art') {
    query.set('task', task.input?.sourceTaskId || task.id);
  } else {
    query.set('task', task.id);
  }
  return `${route}?${query}`;
}

export function taskPresentation(
  manifest,
  task,
  { result = null, artifacts = [], candidateIndex } = {},
) {
  const operation = task.input?.operation;
  const nativeStatus = task.adapter?.remoteStatus || result?.remoteStatus;
  result = result?.jobRecord
    ? {
        ...result,
        character: result.jobRecord.character,
        action: result.jobRecord.action,
      }
    : result;
  const title =
    task.input?.name ||
    task.input?.project?.name ||
    (result?.character?.display_name &&
      `${result.character.display_name} · ${result.action?.display_name || result.action?.action_id || '动作'}`) ||
    manifest.capabilities.find((c) => c.id === task.capabilityId)?.name ||
    '作品';
  let state = task.status;
  let summary =
    {
      prepared: '输入已准备，尚未执行。',
      running: '正在处理，可继续查看进度。',
      awaiting_configuration: '需要先完成服务或 API 配置。',
      failed: '本次操作未完成，请查看原因后继续。',
      attention_required: '这份作品需要检查或处理。',
      completed: '本次操作已完成。',
    }[state] || '请查看作品当前状态。';
  if (state === 'completed' && operation === 'create') {
    state = 'saved';
    summary = '作业已保存，尚未生成动画。';
  }
  if (state === 'completed' && operation === 'save-project') {
    state = 'saved';
    summary = '交互物项目已保存，可以继续编辑；尚未导出。';
  }
  if (state === 'completed' && operation === 'transfer')
    summary = '原图已移送为角色，可继续选择动作；尚未生成动画。';
  if (
    state === 'completed' &&
    task.capabilityId === 'reference-art' &&
    operation === 'generate'
  )
    summary = '角色原图已保存，可以预览或用于制作动作。';
  if (
    !['prepared', 'awaiting_configuration', 'failed'].includes(task.status) &&
    task.capabilityId === 'sprite-generator'
  ) {
    const labels = {
      created: ['saved', '作业已保存，等待生成。'],
      review_required: ['attention_required', '动画已生成，等待播放检查。'],
      approved: ['saved', '动画已通过检查，可以导出。'],
      exported: ['completed', '动画素材已导出。'],
      attention_required: [
        'attention_required',
        '动画需要处理，请查看原任务。',
      ],
      failed: ['attention_required', '动画需要处理，请查看原任务。'],
    };
    if (labels[nativeStatus]) [state, summary] = labels[nativeStatus];
    if (task.status === 'running') {
      state = 'running';
      summary = '动画正在生成或检查，可继续查看进度。';
    }
  }
  if (task.status === 'failed') {
    const error = typeof task.error === 'string' ? task.error : '';
    if (/401|403|API.?Key|credential|密钥/i.test(error))
      summary = '图片服务未接受当前配置，请在工具设置中检查 Key 和模型权限。';
    else if (/429|quota|balance|额度|余额/i.test(error))
      summary = '图片服务额度或请求频率受限，请查看账户用量后再继续。';
    else if (/timeout|fetch failed|ECONN|offline|超时|未连接/i.test(error))
      summary =
        '服务连接中断或超时，请先查看原任务是否已有结果，避免重复生成。';
  }
  const missing = artifacts.some((a) => a.missing);
  if (missing) {
    state = 'attention_required';
    summary = '部分产物无法读取，请检查文件位置；不会自动重新生成。';
  }
  const viewPath = taskViewPath(manifest, task, result, candidateIndex);
  const actions = viewPath
    ? [
        {
          kind: 'open',
          label:
            state === 'running'
              ? '查看进度'
              : state === 'awaiting_configuration'
                ? '打开配置所在工具'
                : '查看作品',
          viewPath,
        },
      ]
    : [];
  if (
    task.capabilityId === 'reference-art' &&
    operation === 'transfer' &&
    task.status === 'completed' &&
    result?.characterId
  ) {
    const route = manifest.capabilities.find((c) => c.id === 'sprite-generator')
      ?.ui.route;
    if (route)
      actions.unshift({
        kind: 'open',
        label: '选择角色动作',
        viewPath: `${route}?character=${encodeURIComponent(result.characterId)}`,
      });
  }
  const image = (
    candidateIndex === undefined ||
    candidateIndex === task.input?.candidateIndex
      ? artifacts
      : []
  ).find((a) => !a.missing && /(?:preview\.gif|reference\.png)$/.test(a.path));
  return {
    title,
    state,
    summary,
    viewPath,
    viewUrl: viewPath
      ? new URL(viewPath, manifest.workspace.frontend.url).href
      : null,
    actions,
    ...(image
      ? {
          preview: {
            kind: image.path.endsWith('.gif') ? 'animation' : 'image',
            url: `/api/workbench/artifacts?path=${encodeURIComponent(image.path)}`,
            artifactPath: image.path,
          },
        }
      : {}),
    ...(task.error
      ? {
          issue: {
            summary:
              '本次操作未完成。请查看详情，保留当前作品；生成结果不明时不要重新提交。',
            detail: task.error,
          },
        }
      : {}),
    detailsPath: task.id
      ? `/advanced?task=${encodeURIComponent(task.id)}`
      : null,
    browserOpened: false,
  };
}

export function nativeTask(job) {
  return {
    id: null,
    capabilityId: 'sprite-generator',
    status: ['submitting', 'provider_pending', 'saving'].includes(job.status)
      ? 'running'
      : 'completed',
    input: { operation: 'get' },
    adapter: { remoteJobId: job.job_id, remoteStatus: job.status },
  };
}

function compactPresentation(presentation) {
  return {
    ...presentation,
    ...(presentation?.issue
      ? { issue: { summary: presentation.issue.summary } }
      : {}),
  };
}

export function mcpContent(name, value) {
  if (name === 'workbench_get_asset_manifest')
    return JSON.stringify({
      summary: value.summary,
      manifest: value.manifest,
      createsTask: false,
    });
  if (name === 'workbench_get_asset') return JSON.stringify(value);
  if (name === 'workbench_list_assets') return JSON.stringify(value);
  // Keep machine data in structuredContent; routine chat receives only the actionable projection.
  if (value.detailIncluded) return JSON.stringify(value);
  if (value.presentation)
    return JSON.stringify({
      ...(value.taskId || value.task?.id
        ? { taskId: value.taskId || value.task.id }
        : {}),
      ...(value.jobId ? { jobId: value.jobId } : {}),
      status: value.status || value.task?.status,
      presentation: compactPresentation(value.presentation),
      ...(value.refreshError
        ? {
            issue:
              '暂时无法刷新，这是上次保存的状态；请检查服务连接后继续查询原任务。',
          }
        : {}),
      next: 'Use the exact viewUrl in the existing workbench preview. Tell the user the outcome and next step; keep IDs, paths and diagnostic details out of routine replies. To read full artifacts and review evidence in text-only clients, call workbench_get_result with detail:true.',
    });
  if (name === 'workbench_list_tasks')
    return JSON.stringify({
      matches: [
        ...(value.tasks || []).map((t) => ({
          taskId: t.id,
          ...compactPresentation(t.presentation),
        })),
        ...(value.nativeJobs || []).map((j) => ({
          jobId: j.job_id,
          ...compactPresentation(j.presentation),
        })),
      ],
      searchedRecentTasks: value.searchedRecentTasks,
      ...(value.nativeError ? { issue: value.nativeError } : {}),
      next: 'Choose by user intent and title; if ambiguous, ask with the available host question tool. Browsing creates no tasks.',
    });
  if (
    name === 'workbench_get_environment' ||
    name === 'workbench_start_frontend' ||
    name === 'workbench_start_services'
  )
    return JSON.stringify(value);
  return JSON.stringify(value);
}
