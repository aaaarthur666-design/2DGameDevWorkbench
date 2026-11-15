import { documentInputs } from './document-contract.mjs';

// MCP and CLI never write document files. The long-lived bridge serializes all
// browser and agent mutations, including concurrent clients in other processes.
export async function forwardDocumentRequest(operation, input) {
  const parsed = documentInputs[operation].parse(input);
  const base = process.env.WORKBENCH_RUNTIME_URL?.trim() || `http://127.0.0.1:${process.env.WORKBENCH_RUNTIME_PORT || 8790}`;
  let response;
  try {
    response = await fetch(`${base.replace(/\/+$/, '')}/v1/agent/${operation}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed), signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    throw Object.assign(new Error('Shared document Bridge is unavailable. Start or reuse the workbench frontend before editing; do not fall back to direct file writes.'), { code: 'DOCUMENT_BRIDGE_UNAVAILABLE', status: 503, cause: error });
  }
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'Shared document request failed.'), { status: response.status, code: body.code, currentRevision: body.currentRevision, expectedRevision: body.expectedRevision });
  return body;
}
