"""Explicit offline UI test service. Never used by production launchers."""
import sys
from pathlib import Path
from dataclasses import replace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_open_motion import Planner, Provider
from test_harness_integration import TemporaryHarness
from sprite_pipeline.api_app import create_api
from sprite_pipeline.service import SpritePipelineService
from sprite_pipeline.vision_review import VisionReviewer
import uvicorn

root = Path(sys.argv[1]).resolve()
fixture = TemporaryHarness(root)
fixture.write_sequence(root/'target-fixture')
service = SpritePipelineService(root)
service.settings = replace(service.settings, poll_interval_seconds=0.25)
if '--checkpoints' in sys.argv:
    from test_open_motion_checkpoints import CheckpointPlanner
    service.open_motion_model = CheckpointPlanner()
else:
    service.open_motion_model = Planner()
provider = Provider(fixture)
with patch('sprite_pipeline.providers.get_provider', return_value=provider):
    uvicorn.run(create_api(service=service), host='127.0.0.1', port=int(sys.argv[2]), log_level='warning')
