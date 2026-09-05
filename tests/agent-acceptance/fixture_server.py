"""Real isolated SpritePipeline HTTP service; only offline fixture jobs allowed."""
import os
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
port = int(sys.argv[2])
pipeline = Path(__file__).resolve().parents[2] / 'Tools' / 'SpritePipeline'
sys.path.insert(0, str(pipeline))
os.environ['GRADIO_ANALYTICS_ENABLED'] = 'False'
os.environ.pop('PIXELLAB_API_KEY', None)
shutil.copytree(pipeline / 'presets', root / 'presets', dirs_exist_ok=True)

from sprite_pipeline.service import SpritePipelineService
from sprite_pipeline.api_app import create_api
from sprite_pipeline.errors import ValidationHarnessError
import uvicorn


class OfflineService(SpritePipelineService):
    def create_job(self, request):
        provider = request.get('provider') if isinstance(request, dict) else request.provider
        if provider != 'fixture':
            raise ValidationHarnessError('Acceptance service only allows fixture provider')
        return super().create_job(request)


uvicorn.run(create_api(service=OfflineService(root)), host='127.0.0.1', port=port, log_level='error')
