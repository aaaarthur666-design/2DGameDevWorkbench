from types import SimpleNamespace
import pytest
from sprite_pipeline.workbench_links import selected_candidate


def test_exact_candidate_selection_does_not_mutate_job():
    job = SimpleNamespace(candidates=[SimpleNamespace(candidate_index=1), SimpleNamespace(candidate_index=3)])
    assert selected_candidate(job, "3") == 3
    assert selected_candidate(job, "") is None
    assert [c.candidate_index for c in job.candidates] == [1, 3]
    for invalid in ["2", "0", "-1", "oops", "1.0", "３", "10000"]:
        with pytest.raises(ValueError):
            selected_candidate(job, invalid)
