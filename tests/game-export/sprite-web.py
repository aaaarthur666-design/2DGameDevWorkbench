import argparse
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'Tools' / 'SpritePipeline'))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'Tools' / 'SpritePipeline' / 'tests'))
from test_harness_integration import TemporaryHarness
from sprite_pipeline.service import SpritePipelineService
from sprite_pipeline.ui import create_ui_app
import uvicorn

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True)
parser.add_argument('--port', type=int, required=True)
args = parser.parse_args()
root = Path(args.root)
harness = TemporaryHarness(root)
service = SpritePipelineService(root)
exported_mode = os.environ.get('FORGE_TEST_EXPORTED', '')
candidate_index = 4 if exported_mode else 1
job = service.create_job({**harness.create_request('import'), 'candidate_count': candidate_index})
harness.write_sequence(root / 'incoming')
service.ingest_candidate(job.job_id, candidate_index, root / 'incoming')
service.approve_candidate(job.job_id, candidate_index, reviewer='browser-fixture', acknowledge_warnings=True)
if exported_mode:
    service.export_candidate(job.job_id, candidate_index, {'filename':'旧角色.png'})
    if exported_mode == 'png':
        with service.store.locked_job(job.job_id) as saved:
            saved.export.godot_package_path = None
            saved.export.godot_sha256 = None
    service.archive_history()
print('Fixture job: ' + job.job_id, flush=True)
uvicorn.run(create_ui_app(root=root, port=args.port), host='127.0.0.1', port=args.port, log_level='warning')
