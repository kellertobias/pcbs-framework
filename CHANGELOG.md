# 1.0.0 (2026-02-19)


### Bug Fixes

* fix package lock file ([410bd47](https://github.com/kellertobias/pcbs-framework/commit/410bd47115527435bf046f7b636800e226436f75))
* force update ([31158d5](https://github.com/kellertobias/pcbs-framework/commit/31158d58287ce57ac4430b66fde4a0b2342a3469))
* kicad in tests ([bd5787e](https://github.com/kellertobias/pcbs-framework/commit/bd5787e2084b7635b90975e529e8805bc393ac98))
* Update OpenCascade.js loading mechanism to use `fs.readFileSync` and `eval` for improved compatibility and add minimal initialization tests. ([4789261](https://github.com/kellertobias/pcbs-framework/commit/478926173593993fe656dc30169e4775bc85353b))


### Features

* Add a check to prevent `tsconfig.json` path mapping setup within the framework's own repository. ([12a9725](https://github.com/kellertobias/pcbs-framework/commit/12a97252a5eca63d7e57da8fb53df14acf233570))
* Add CLI commands for automated KiCad library type generation and tsconfig setup, migrating type imports and updating project configuration. ([297ef7f](https://github.com/kellertobias/pcbs-framework/commit/297ef7f9ebcbc3a097ad48df2219c85a2a7ab242))
* disable npm publishing in semantic-release config and add an explicit npm publish step to the release workflow. ([c4a0106](https://github.com/kellertobias/pcbs-framework/commit/c4a010616f60e5d1eec186291fd8b39c5ddb05ad))
* Implement a schematic layout system for arranging components and composables within a design. ([bce2f43](https://github.com/kellertobias/pcbs-framework/commit/bce2f432004a09c660479792e238e7b6c9bab47e))
* Implement custom OpenCascade WASM loading and patching for improved Node.js/ESM compatibility. ([1f4f801](https://github.com/kellertobias/pcbs-framework/commit/1f4f8016284e7527f27e6ab3792f3136dbf53b92))
* Set up automated releases with semantic-release and add detailed project structure and usage examples to the README. ([4ef121e](https://github.com/kellertobias/pcbs-framework/commit/4ef121e22a37c9ec32b025a3307e3aa0add1002e))
