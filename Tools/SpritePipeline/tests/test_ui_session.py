import asyncio
import json

import pytest
from starlette.responses import JSONResponse
from sprite_pipeline.ui_session import UiSessionMiddleware, install_ui_session


async def request(path, method="POST"):
    seen = []
    reads = []
    messages = []
    async def receive():
        reads.append(True)
        return {"type": "http.request", "body": b"private-test-input", "more_body": False}
    async def downstream(scope, receive, send):
        body = await receive()
        seen.append((scope, body))
        await JSONResponse({"ok": True})(scope, receive, send)
    middleware = UiSessionMiddleware(downstream, api_prefix="/gradio_api", revision="current")
    await middleware({"type": "http", "method": method, "path": path,
                      "raw_path": path.encode(), "query_string": b"session_hash=test"},
                     receive, lambda message: collect(messages, message))
    return seen, reads, messages


async def collect(messages, message):
    messages.append(message)


@pytest.mark.parametrize("path,method", [
    ("/gradio_api/queue/join", "POST"),
    ("/gradio_api/run/save_api_key", "POST"),
    ("/gradio_api/ui-previous/queue/join", "POST"),
    ("/gradio_api/ui-previous/queue/data", "GET"),
    ("/gradio_api/ui-current-extra/queue/join", "POST"),
])
def test_stale_ui_is_rejected_before_reading_key_or_dispatching_event(path, method):
    seen, reads, messages = asyncio.run(request(path, method))
    assert not seen and not reads
    assert messages[0]["status"] == 409
    payload = json.loads(messages[1]["body"])
    assert payload["code"] == "ui_version_mismatch"
    assert "刷新" in payload["error"]
    assert b"private-test-input" not in messages[1]["body"]


def test_current_ui_preserves_body_and_query_but_maps_gradio_route():
    seen, reads, messages = asyncio.run(request("/gradio_api/ui-current/queue/join"))
    assert len(seen) == len(reads) == 1
    scope, body = seen[0]
    assert scope["path"] == "/gradio_api/queue/join"
    assert scope["raw_path"] == b"/gradio_api/queue/join"
    assert scope["query_string"] == b"session_hash=test"
    assert body["body"] == b"private-test-input"
    assert messages[0]["status"] == 200


@pytest.mark.parametrize("path,method", [("/v1/jobs", "POST"), ("/gradio_api/file=test.png", "GET")])
def test_rest_and_static_resources_keep_their_routes(path, method):
    seen, _, messages = asyncio.run(request(path, method))
    assert seen[0][0]["path"] == path
    assert messages[0]["status"] == 200


@pytest.mark.parametrize("path", ["/", "/config", "/config/"])
def test_page_and_config_cannot_be_cached(path):
    _, _, messages = asyncio.run(request(path, "GET"))
    assert (b"cache-control", b"no-store, max-age=0") in messages[0]["headers"]


def test_revision_endpoint_never_reads_body_or_calls_gradio():
    seen, reads, messages = asyncio.run(request("/ui-session", "GET"))
    assert not seen and not reads
    assert json.loads(messages[1]["body"]) == {"revision": "current"}


def test_gradio_config_uses_distinct_server_lifetimes():
    from fastapi import FastAPI
    import gradio as gr
    revisions = []
    for _ in range(2):
        app = FastAPI()
        with gr.Blocks() as demo:
            gr.Textbox()
        head = install_ui_session(app, demo)
        revisions.append(app.state.sprite_pipeline_ui_revision)
        config = demo.get_config_file()
        assert config["api_prefix"] == "/gradio_api/ui-" + revisions[-1]
        assert demo.get_config_file()["api_prefix"] == config["api_prefix"]
        assert revisions[-1] in head
    assert revisions[0] != revisions[1]
