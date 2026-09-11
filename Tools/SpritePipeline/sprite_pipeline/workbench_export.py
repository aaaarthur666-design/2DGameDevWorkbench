"""Forge-only bridge: native exports hand exact identities to the parent workbench.

Standalone SpritePipeline keeps its normal file downloads. No game paths, keys or
host tools are handled inside the embedded tool.
"""

_REQUEST = r"""
    const params = new URLSearchParams(location.search);
    const origin = params.get('workbench_origin');
    if (params.get('workbench_embedded') !== '1' || window.parent === window || !origin) return [];
    try { if (new URL(origin).origin !== origin || !/^https?:/.test(origin)) return []; } catch { return []; }
    if (!available || !/^[a-zA-Z0-9_-]{1,200}$/.test(jobId || '') || !Number.isInteger(candidateIndex) || candidateIndex < 1) return [];
    const name = String(filename || '角色动画').replace(/\.png$/i, '').slice(0,160);
    window.parent.postMessage({type:'workbench:sprite-godot-export',jobId,candidateIndex,name},origin);
    return [];
"""

REQUEST_GODOT_EXPORT_JS = "(jobId, candidateIndex, available, filename) => {" + _REQUEST + "}"
EXPORTED_GODOT_JS = """(details) => {
    if (!details?.ok) return [];
    const filename = [details.job?.character?.display_name, details.job?.action?.display_name || details.job?.action?.action_id].filter(Boolean).join(' · ');
    const jobId = details.job?.job_id;
    const candidateIndex = details.job?.export?.candidate_index;
    const available = details.job?.export?.godot_package_path;
""" + _REQUEST + "}"
