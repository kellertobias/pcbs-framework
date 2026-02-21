# [1.7.0](https://github.com/kellertobias/pcbs-framework/compare/v1.6.0...v1.7.0) (2026-02-21)


### Features

* document the new `parts` command for searching JLC components. ([4e86517](https://github.com/kellertobias/pcbs-framework/commit/4e86517763c453dc94e8a7fa1c0ddd7ebb04bf4c))

# [1.6.0](https://github.com/kellertobias/pcbs-framework/compare/v1.5.0...v1.6.0) (2026-02-21)


### Features

* add lcsc parts search command ([4268b9b](https://github.com/kellertobias/pcbs-framework/commit/4268b9bdd957cc5b58582043d638a303cf35416c))
* add LCSC parts search command ([031f128](https://github.com/kellertobias/pcbs-framework/commit/031f128b4f28f0e2e5c752915fef131d723cab08))
* add LCSC parts search command ([9784039](https://github.com/kellertobias/pcbs-framework/commit/97840395cf74bdfa045097ba5c1140da9b7c63dd))
* add LCSC parts search command ([8f401f5](https://github.com/kellertobias/pcbs-framework/commit/8f401f5719eafafbb477c54fac635d95bf14fa61))

# [1.5.0](https://github.com/kellertobias/pcbs-framework/compare/v1.4.1...v1.5.0) (2026-02-21)


### Features

* enhance schematic layout with gravity-based placement, support for unplaced components, and refined drawing options ([e65acc3](https://github.com/kellertobias/pcbs-framework/commit/e65acc33a7253afa69ed0f9030a183de00333da5))
* improve interface ([26267d7](https://github.com/kellertobias/pcbs-framework/commit/26267d7638964591067c115fc60c96921ee9643d))

## [1.4.1](https://github.com/kellertobias/pcbs-framework/compare/v1.4.0...v1.4.1) (2026-02-21)


### Bug Fixes

* patch circuit-synth ([a8b896d](https://github.com/kellertobias/pcbs-framework/commit/a8b896d9ab91c5a4d563240d5ce054f6d6b56a56))

# [1.4.0](https://github.com/kellertobias/pcbs-framework/compare/v1.3.0...v1.4.0) (2026-02-21)


### Bug Fixes

* types ([28d5b7a](https://github.com/kellertobias/pcbs-framework/commit/28d5b7ada0a6ce0d49ad6c2ceaea266d0f06a29a))


### Features

* enable string and number pin names, improve codegen for DNC net pin access, add synthesis debug output, and adjust Kicad symbol path priority. ([bbe7501](https://github.com/kellertobias/pcbs-framework/commit/bbe75017633a058c4830cbb3226c37bd1a482255))

# [1.3.0](https://github.com/kellertobias/pcbs-framework/compare/v1.2.0...v1.3.0) (2026-02-20)


### Features

* long holes ([d749d60](https://github.com/kellertobias/pcbs-framework/commit/d749d60f8fa5bed588f2ddf8efd6ac49cd6dad15))

# [1.2.0](https://github.com/kellertobias/pcbs-framework/compare/v1.1.1...v1.2.0) (2026-02-20)


### Features

* add rounded corners ([7629475](https://github.com/kellertobias/pcbs-framework/commit/7629475bb01184b5901208a4e43d1514ae345ca2))

## [1.1.1](https://github.com/kellertobias/pcbs-framework/compare/v1.1.0...v1.1.1) (2026-02-20)


### Bug Fixes

* correctly render drill through in 3d ([a46cff3](https://github.com/kellertobias/pcbs-framework/commit/a46cff36d9a32a6aaa63e37fe80324d37f082308))

# [1.1.0](https://github.com/kellertobias/pcbs-framework/compare/v1.0.0...v1.1.0) (2026-02-19)


### Bug Fixes

* fix package lock file ([410bd47](https://github.com/kellertobias/pcbs-framework/commit/410bd47115527435bf046f7b636800e226436f75))


### Features

* disable npm publishing in semantic-release config and add an explicit npm publish step to the release workflow. ([c4a0106](https://github.com/kellertobias/pcbs-framework/commit/c4a010616f60e5d1eec186291fd8b39c5ddb05ad))

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
