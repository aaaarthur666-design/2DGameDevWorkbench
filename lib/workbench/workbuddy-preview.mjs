import { randomUUID } from 'node:crypto';
import { frontendContext, previewPath } from './preview-follow.mjs';
import { getFrontend } from './frontend-service.mjs';

// MCP cannot invoke host tools. It can require a page acknowledgement before
// the first WorkBuddy submission and return an explicit host-owned next action.
export class WorkBuddyPreview {
  constructor(root, clientName, inspectFrontend = getFrontend) {
    this.root = root;
    this.clientName = clientName;
    this.inspectFrontend = inspectFrontend;
    this.sessionId = randomUUID();
    this.seen = false;
    this.disabledReason = null;
  }
  get enabled() {
    return process.env.FORGE_MCP_HOST === 'workbuddy' || /workbuddy|codebuddy/i.test(this.clientName() || '');
  }
  configure(reason) {
    if (reason === 'auto') { this.disabledReason = null; this.seen = false; }
    else if (reason) this.disabledReason = reason;
  }
  async context(manifest, requestId) {
    return frontendContext(this.root, manifest, { requestId, sessionId: this.sessionId });
  }
  async inspect(manifest, viewPath = '/', frontend) {
    const context = await this.context(manifest);
    const visible = context.pages.find(p => p.visible);
    if (visible) this.seen = true;
    const common = { sessionId: this.sessionId, browserOpened: false, displayed: false };
    if (this.disabledReason) return { ...common, state: 'disabled', reason: this.disabledReason, requiresHostAction: false };
    if (visible) return { ...common, state: visible.following ? 'connected' : 'paused', pageId: visible.pageId,
      requiresHostAction: false, next: visible.following ? '本会话预览已连接；生成后将自动跟随。' : '用户已暂停跟随；保留当前页面，不强制切换。' };
    if (this.seen) return { ...common, state: 'hidden_or_closed', requiresHostAction: false,
      next: '本会话预览已隐藏或关闭，不自动重新打开。继续查询原任务；用户要求时再显示。' };
    frontend ||= await this.inspectFrontend(manifest);
    if (!frontend.ready) {
      const offline = frontend.state === 'offline' || frontend.runtime?.state === 'offline';
      const blocked = [frontend.state, frontend.runtime?.state].some(s => ['conflict','unreachable','blocked'].includes(s));
      return { ...common, state: 'frontend_not_ready', frontend, requiresHostAction: true,
        nextTool: offline && !blocked ? 'workbench_start_frontend' : 'workbench_get_environment',
        next: blocked ? '先报告服务冲突或不可达，不重启未知服务；本次尚未提交生成。' : '先启动离线前端并检查 ready，再打开预览；本次尚未提交生成。' };
    }
    const url = new URL(previewPath(manifest, viewPath), frontend.url);
    url.searchParams.set('previewSession', this.sessionId);
    return { ...common, state: 'open_required', requiresHostAction: true, frontendReady: true,
      hostAction: { ...frontend.hostAction, arguments: { ...frontend.hostAction.arguments, files: [url.href], explanation: '在 WorkBuddy 内部浏览器显示本次任务并启用进度跟随' } },
      next: '先发现 WorkBuddy 宿主 present_files 的真实 schema，按 hostAction 打开本次会话预览，再查询 workbench_get_frontend_context 确认本 sessionId 的 visible 页面。仅有 URL 或旧页面不算已打开。用户在本对话已关闭预览、明确拒绝或宿主工具确实不可用时，使用 previewPolicy 说明原因；不打开系统浏览器。' };
  }
  async beforeRun(manifest, viewPath) {
    if (!this.enabled) return null;
    const preview = await this.inspect(manifest, viewPath);
    if (!preview.requiresHostAction) return null;
    return { status: 'preview_required', createsTask: false, providerCalled: false,
      summary: '尚未创建任务或调用生成 API。请先完成本次会话的前端预览连接。', preview,
      next: '完成 preview.next 后再以相同制作参数调用 workbench_run_task；这次没有提交生成，不是重试已存在的生成作业。' };
  }
  async decorate(manifest, value, viewPath) {
    if (!this.enabled || value.preview) return value;
    try { return { ...value, preview: await this.inspect(manifest, viewPath, value.frontend) }; }
    catch { return { ...value, preview: { sessionId: this.sessionId, state: 'unavailable', requiresHostAction: false,
      next: '预览状态暂不可读；保留已返回的任务 ID，不重提生成。', browserOpened: false, displayed: false } }; }
  }
}
