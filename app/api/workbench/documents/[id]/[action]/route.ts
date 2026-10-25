import { forwardDocumentHttp } from '@/lib/workbench/document-proxy';
export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await context.params;
  return forwardDocumentHttp(request, `/${encodeURIComponent(id)}/${encodeURIComponent(action)}`);
}
