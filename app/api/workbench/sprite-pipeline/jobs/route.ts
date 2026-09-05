import manifest from '@/workbench/manifest.json';
const label = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

/** Read only: observe native UI jobs without creating tasks or submitting generation. */
export async function GET() {
  const capability = manifest.capabilities.find(
    (c) => c.id === 'sprite-generator',
  );
  const connector = capability?.connector as
    | { urlEnv?: string; defaultUrl?: string; tokenEnv?: string }
    | undefined;
  const baseUrl =
    (connector?.urlEnv && process.env[connector.urlEnv]) ||
    connector?.defaultUrl;
  if (!baseUrl)
    return Response.json({ error: '序列帧服务未配置' }, { status: 503 });
  const token = connector?.tokenEnv
    ? process.env[connector.tokenEnv]
    : undefined;
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/jobs`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    const payload = (await response.json()) as {
      data?: { jobs?: Record<string, unknown>[] };
    };
    if (!response.ok || !Array.isArray(payload.data?.jobs))
      throw new Error('Invalid job response');
    const jobs = payload.data.jobs
      .filter(
        (job: Record<string, unknown>) =>
          typeof job.job_id === 'string' &&
          job.character_id !== 'diagnostic_dummy' &&
          job.provider !== 'fixture' &&
          job.status !== 'invalid',
      )
      .map((job: Record<string, unknown>) => ({
        job_id: job.job_id,
        status: label(job.status, 'attention_required'),
        updated_at: label(job.updated_at),
        character_id: label(job.character_id),
        character_name: label(job.character_name),
        action_id: label(job.action_id),
        action_name: label(job.action_name),
      }));
    return Response.json(
      { jobs },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return Response.json({ error: '序列帧服务暂时无法连接' }, { status: 503 });
  }
}
