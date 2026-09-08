"""Bind positional Gradio events to one server lifetime, before reading bodies."""
from __future__ import annotations
import json
import uuid
from starlette.responses import JSONResponse

STALE_MESSAGE = "页面已更新，请刷新页面后重新操作。刚才的操作未执行，API Key 请刷新后重新填写。"

class UiSessionMiddleware:
    def __init__(self, app, *, api_prefix, revision):
        self.app=app
        self.api_prefix=api_prefix.rstrip("/")
        self.revision=revision
        self.versioned_prefix=f"{self.api_prefix}/ui-{revision}"

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope,receive,send)
        path=scope["path"]
        headers={"Cache-Control":"no-store, max-age=0"}
        if path=="/ui-session":
            response=JSONResponse({"revision":self.revision},headers=headers)
            return await response(scope,receive,send)
        if path.startswith(self.api_prefix+"/ui-"):
            if not (path==self.versioned_prefix or path.startswith(self.versioned_prefix+"/")):
                response=JSONResponse({"error":STALE_MESSAGE,"detail":STALE_MESSAGE,"code":"ui_version_mismatch"},status_code=409,headers=headers)
                return await response(scope,receive,send)
            scope=dict(scope)
            scope["path"]=self.api_prefix+path[len(self.versioned_prefix):]
            raw=scope.get("raw_path",path.encode("utf-8"))
            scope["raw_path"]=self.api_prefix.encode("ascii")+raw[len(self.versioned_prefix):]
        elif (path==self.api_prefix or path.startswith(self.api_prefix+"/")) and scope["method"] not in {"GET","HEAD","OPTIONS"}:
            # Old tabs lack the version segment. Never parse their data: it may
            # contain a key intended for an entirely different positional event.
            response=JSONResponse({"error":STALE_MESSAGE,"detail":STALE_MESSAGE,"code":"ui_version_mismatch"},status_code=409,headers=headers)
            return await response(scope,receive,send)
        async def no_cache(message):
            if message["type"]=="http.response.start" and path in {"/","/config","/config/"}:
                message=dict(message)
                message["headers"]=[(k,v) for k,v in message.get("headers",[]) if k.lower()!=b"cache-control"]+[(b"cache-control",b"no-store, max-age=0")]
            await send(message)
        await self.app(scope,receive,no_cache)


def install_ui_session(app,demo):
    revision=uuid.uuid4().hex
    original=demo.get_config_file
    prefix=original()["api_prefix"].rstrip("/")
    def versioned_config():
        config=original()
        config["api_prefix"]=f"{prefix}/ui-{revision}"
        return config
    demo.get_config_file=versioned_config
    app.add_middleware(UiSessionMiddleware,api_prefix=prefix,revision=revision)
    app.state.sprite_pipeline_ui_revision=revision
    # A visible prompt preserves unsaved edits instead of silently reloading.
    return """<script>
(() => {
 const revision = REVISION;
 let stopped = false;
 function changed() {
   if (stopped) return;
   stopped = true;
   const overlay = document.createElement('div');
   overlay.id = 'sprite-ui-version-notice';
   overlay.setAttribute('role', 'alertdialog');
   overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#080d18e8;display:grid;place-items:center;color:white;font:16px sans-serif';
   const panel = document.createElement('div');
   panel.style.cssText = 'max-width:460px;padding:28px;background:#17233b;border:1px solid #8264ef;border-radius:12px';
   const title = document.createElement('h2'); title.textContent = '页面已更新';
   const text = document.createElement('p'); text.textContent = '为避免旧按钮执行错误操作，请刷新后继续。尚未保存的输入需要重新填写；已保存的作品和任务仍保留。';
   const button = document.createElement('button'); button.textContent = '刷新到最新页面';
   button.style.cssText = 'padding:12px 20px;border:0;border-radius:8px;background:#7857ed;color:white;cursor:pointer';
   button.onclick = () => location.reload();
   panel.append(title,text,button); overlay.append(panel); document.body.append(overlay);
 }
 async function check() {
   if (stopped || document.hidden) return;
   try {
     const response = await fetch(new URL('ui-session',location.href), {cache:'no-store'});
     if (response.ok && (await response.json()).revision !== revision) changed();
   } catch (_) { /* A temporarily disconnected service does not erase the page. */ }
 }
 setInterval(check, 5000);
 document.addEventListener('visibilitychange',check);
 window.addEventListener('focus',check);
})();
</script>""".replace("REVISION",json.dumps(revision))
