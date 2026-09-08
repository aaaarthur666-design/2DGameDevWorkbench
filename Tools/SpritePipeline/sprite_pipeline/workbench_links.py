"""Validate workbench deep links without mutating a saved job."""
def selected_candidate(job, value):
    if value in (None, ""):
        return None
    if not str(value).isascii() or not str(value).isdecimal():
        raise ValueError("Invalid candidate")
    index = int(value)
    if index < 1 or not any(c.candidate_index == index for c in job.candidates):
        raise ValueError("Candidate not found")
    return index
