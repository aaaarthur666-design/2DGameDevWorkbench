# Third-party source and license status

This file records provenance and the license status of incorporated source.

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
- No FrameRonin source is included in the tracked workbench files added by this repair. The map editor is a modular compatibility implementation built around the public Pixelwork v2 state shape and observed user-facing behavior.
- Any local reference clone under ignored runtime directories is research material only and must not be packaged or published.

## Package dependencies

JavaScript and Python dependencies retain their own licenses and notices. Exact installed JavaScript versions are recorded in `package-lock.json`; exact SpritePipeline Python versions are recorded in `Tools/SpritePipeline/requirements.lock`.
