# Third-party source and license status

This current-maintenance file records provenance and the license status of incorporated or behaviorally referenced source. It does not grant rights to user-supplied assets or externally generated media.

## NativeFramesGeneration / SpritePipeline

- Upstream: <https://github.com/flxBurnOut/NativeFramesGeneration.git>
- Synchronized through upstream commit `b5cd0a4` (feature update `c2c505c`, MIT license `322a6ae`, test dependency fix `b5cd0a4`) and subsequently adapted under `Tools/SpritePipeline/`.
- License: MIT License, Copyright (c) 2026 flxBurnOut.
- Authorization confirmed by the copyright holder on 2026-09-04. The integrated copy includes its license at `Tools/SpritePipeline/LICENSE`; the upstream repository also carries the MIT license.
- Distribution status: **resolved under the MIT License**.

The workbench's `sprite-pipeline` adapter communicates with this component through its documented local REST API.

## FrameRonin compatibility reference

- Upstream: <https://github.com/systemchester/FrameRonin.git>
- Website behavior reference: <https://frameronin.com/>
- No FrameRonin source is included in the tracked workbench. The map editor is a modular compatibility implementation built around the public Pixelwork v2 state shape and observed user-facing behavior.
- Any local reference clone under ignored runtime directories is research material only and must not be packaged or published.

## copyWorms interaction reference

- Upstream: <https://github.com/flxBurnOut/copyWorms>
- Reference revision: `bb1581d12c9626e294e403a01db5f3cffb229cd8`.
- Reference files: `LevelModule/Formal/InteractiveObject.gd`, the input and nearest-object selection in `LevelModule/Formal/Level_01.gd`, and `Tools/DropItem.gd`.
- `features/interactable-editor/godot-templates/` implements generalized range, focus, completion, and pickup behavior informed by those files, with new configuration, state isolation, dialogue, and packaging code. It does not embed copyWorms assets, game scenes, player controllers, singletons, or a source checkout. Exports are self-contained and never download upstream code.

## Package dependencies

JavaScript and Python dependencies retain their own licenses and notices. Exact installed JavaScript versions are recorded in `package-lock.json`; exact SpritePipeline Python versions are recorded in `Tools/SpritePipeline/requirements.lock`.

## External API services

Optional map layer generation can call Google Gemini (`gemini-3.1-flash-image`) or OpenAI Images (`gpt-image-2`). Those services and their model outputs are not incorporated source dependencies; use is subject to the account owner's provider terms, configuration, usage limits, and content rights. No provider credential is distributed with this repository.

SpritePipeline can use providers configured within that component. Its provider-specific behavior and terms are documented by the upstream component and service; the workbench does not redistribute provider credentials.
