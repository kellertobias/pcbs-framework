# [2.1.0](https://github.com/kellertobias/pcbs-framework/compare/v2.0.2...v2.1.0) (2026-02-26)


### Features

* warn on unconnected and non-dnc pins during synthesis ([853f668](https://github.com/kellertobias/pcbs-framework/commit/853f668510eb93db81e5a4ec0e557250389bf9a4))

## [2.0.2](https://github.com/kellertobias/pcbs-framework/compare/v2.0.1...v2.0.2) (2026-02-23)


### Bug Fixes

* unify api ([16bcfbe](https://github.com/kellertobias/pcbs-framework/commit/16bcfbe097bd5ce5473f143f0ce1315a9eade78f))

## [2.0.1](https://github.com/kellertobias/pcbs-framework/compare/v2.0.0...v2.0.1) (2026-02-23)


### Bug Fixes

* improve hierarchical placer ([a4b54a1](https://github.com/kellertobias/pcbs-framework/commit/a4b54a1c0929a6980c88455b4e85782c31c4fbea))
* improve local component placement ([cb4857a](https://github.com/kellertobias/pcbs-framework/commit/cb4857aeef54434b5d48552f3e73b812521a23ad))

# [2.0.0](https://github.com/kellertobias/pcbs-framework/compare/v1.9.0...v2.0.0) (2026-02-23)


### chore

* **release:** bump to v2 ([9173fe8](https://github.com/kellertobias/pcbs-framework/commit/9173fe85735f9a12c3ccfb90da0a8acb4f268030))


### BREAKING CHANGES

* **release:** migration to native kicad file generation done

# [1.9.0](https://github.com/kellertobias/pcbs-framework/compare/v1.8.1...v1.9.0) (2026-02-23)


### Bug Fixes

* add test asset ([f525c6c](https://github.com/kellertobias/pcbs-framework/commit/f525c6ce440f24382ba7dd2abb179dbcd7014df1))
* correctly auto-rotate components ([f6d068a](https://github.com/kellertobias/pcbs-framework/commit/f6d068adda3bb8f8603729367821a8ee3a9c4d05))
* correctly render nets ([d5312f8](https://github.com/kellertobias/pcbs-framework/commit/d5312f847182b51daebb5c7729f8cc4de831d80f))
* correctly rotate global label text for vertical wires in KiCad schematic generation. ([ac35e3c](https://github.com/kellertobias/pcbs-framework/commit/ac35e3ca1c2cec4b3308585c8d173582d459a6a8))
* fix schematic generation formatting and quotation ([2b08f2a](https://github.com/kellertobias/pcbs-framework/commit/2b08f2a22f8513ece7beedb9e133409a423a9673))
* generate kicad 9 files ([10e0ecf](https://github.com/kellertobias/pcbs-framework/commit/10e0ecf40e5058d6e79489c235a4050c2fb474c6))
* global label layouts and inverted Y coords ([61161df](https://github.com/kellertobias/pcbs-framework/commit/61161dfa1b44385eb93be2e5621631aa3e92dfc6))
* handle symbol inheritance and improve debugging ([0606ff3](https://github.com/kellertobias/pcbs-framework/commit/0606ff319dc25630abb4b6f5c44f865438a80836))
* handle symbol inheritance order and debugging ([492e939](https://github.com/kellertobias/pcbs-framework/commit/492e939b065cd880002f61045ab5a1c4655b0840))
* improve error handling ([ee86367](https://github.com/kellertobias/pcbs-framework/commit/ee863676d35c2380da0d382d31a814cc95c31f6d))
* **kicad:** correct global label orientations and text justification ([3863a54](https://github.com/kellertobias/pcbs-framework/commit/3863a54b2dbefec232935fcd808f523c6bcc513c))
* netlist generation works now ([1ebed10](https://github.com/kellertobias/pcbs-framework/commit/1ebed1053513db8cb6b3aa169d6cd0a46c55a83d))
* show warning if components overlap ([a0a2ab4](https://github.com/kellertobias/pcbs-framework/commit/a0a2ab4c3aba8423d065fc12d8d425da5e4665fb))


### Features

* generate empty PCB file if doesn't exist yet ([8b6ee56](https://github.com/kellertobias/pcbs-framework/commit/8b6ee561615d5551a51ad3ad365c97b0c8cddd82))
* native KiCad generation improvements ([ca8f2d5](https://github.com/kellertobias/pcbs-framework/commit/ca8f2d58ec3e6d68150bb8d045b2b3954d4422bb))
* replace circuit-synth with native KiCad generation ([66be1df](https://github.com/kellertobias/pcbs-framework/commit/66be1df4b135fc5647c08e47d446eb5f4c5ff379))

## [1.8.1](https://github.com/kellertobias/pcbs-framework/compare/v1.8.0...v1.8.1) (2026-02-22)


### Bug Fixes

* remove the last remains of circuit-synth ([a0e2005](https://github.com/kellertobias/pcbs-framework/commit/a0e20057023b16688e9286fc4d6f0558afd51086))

# [1.8.0](https://github.com/kellertobias/pcbs-framework/compare/v1.7.0...v1.8.0) (2026-02-22)


### Bug Fixes

* **export:** use rotation from .kicad_pcb for JLC CPL ([6dc1d87](https://github.com/kellertobias/pcbs-framework/commit/6dc1d879f574df47755ec7a5253bc2dd5f516b76))


### Features

* **cpl:** add support for placement overrides ([abd9af2](https://github.com/kellertobias/pcbs-framework/commit/abd9af265a09a9ea694218503d4ae23d26f6cced))
* **cpl:** add support for placement overrides ([34b1a46](https://github.com/kellertobias/pcbs-framework/commit/34b1a46caabdb8648d5462c3aefcd647f5810c87))

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
