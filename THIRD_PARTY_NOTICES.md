# Third-party source and license status

This file records provenance; it does not grant rights that an upstream project has not granted.

## NativeFramesGeneration / SpritePipeline

- Upstream: <https://github.com/flxBurnOut/NativeFramesGeneration.git>
- Integrated snapshot: commit `4254eb5`, under `Tools/SpritePipeline/`
- License status checked on 2026-09-04: no `LICENSE`, `COPYING`, or `NOTICE` file was present in the integrated upstream snapshot.
- Distribution status: **unresolved**. Do not redistribute, publish, sell, or include this directory in a public deployment until the copyright holder adds an explicit license or provides written permission.

The workbench's `sprite-pipeline` adapter communicates with this component through its documented local REST API. If redistribution permission cannot be obtained, keep the adapter and replace the vendored directory with a separately installed sidecar.

## FrameRonin compatibility reference

- Upstream: <https://github.com/systemchester/FrameRonin.git>
- Website behavior reference: <https://frameronin.com/>
- No FrameRonin source is included in the tracked workbench files added by this repair. The map editor is a modular compatibility implementation built around the public Pixelwork v2 state shape and observed user-facing behavior.
- Any local reference clone under ignored runtime directories is research material only and must not be packaged or published.

## Package dependencies

JavaScript and Python dependencies retain their own licenses and notices. Exact installed JavaScript versions are recorded in `package-lock.json`; exact SpritePipeline Python versions are recorded in `Tools/SpritePipeline/requirements.lock`.
