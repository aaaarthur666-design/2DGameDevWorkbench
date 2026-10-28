# Visual structure worker

This optional, **local-only** worker performs prompted segmentation in an isolated
Python environment. It does not replace SpritePipeline or generate artwork.
The V0 profile is experimental; pixel-art accuracy and actual control benefit
must be established separately. `runtime-profile.json` pins the upstream source.

Runtime, model weights and downloaded source live in the ignored
`work/visual-structure-runtime/`. Do not install Torch or SAM into the existing
SpritePipeline environment. Inference never downloads models automatically.

The worker accepts `doctor` or `segment --job <frozen-job.json>`. A segment job
contains source/model SHA-256 values, native-pixel point/box prompts, semantic
provenance and a fresh output directory. The caller must validate authorization,
source identity and paths before constructing this private job. Output masks
are limited to visible source pixels; model scores are not accuracy estimates.
No model result approves artwork, changes source images or authorizes editing.

Development pilot artifacts and cost ledgers remain in ignored `work/`, never in
this tool directory. The runtime profile does not claim SAM 3 was evaluated.

The V1 preparation-page integration, persistence, correction workflow and setup
commands are documented in [visual structures](../../docs/visual-structures.md).
It is not yet a claim of temporal tracking or generation-quality improvement.

Upstream: https://github.com/facebookresearch/sam2
License: Apache-2.0, with upstream third-party notices. No upstream source or
weights are bundled in the tracked repository. See `THIRD_PARTY_NOTICES.md`.
