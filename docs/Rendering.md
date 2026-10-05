# Named render series

Declare board review assets in a TypeScript file beside the board. The framework
uses native KiCad for copper plots, 3D views and populated-board WRL exports.
Rendering reads existing generated boards; it does not synthesize, route or fill
zones. Generate and verify the boards first. KiCad must be installed; `KICAD_CLI`
can select its executable.

```typescript
import { defineRenderSeries } from '@tobisk/pcbs';

export default defineRenderSeries({
    board: './Controller.kicad_pcb',
    outputDirectory: './review',
    renders: [
        { name: 'model', kind: 'model', origin: [53, 8.5] },
        {
            name: 'bottom-copper', kind: 'layers', side: 'bottom',
            layers: ['B.Cu', 'B.SilkS', 'Edge.Cuts'],
        },
        {
            name: 'oblique', kind: '3d', side: 'bottom',
            rotate: [-35, 0, 25], zoom: 0.55,
        },
        {
            name: 'panel', kind: '3d', board: '../panel/Panel.kicad_pcb',
            side: 'top', rotate: [0, 0, 0],
        },
    ],
});
```

```sh
npx @tobisk/pcbs renders path/to/renders.ts
npx @tobisk/pcbs renders path/to/renders.ts --only bottom-copper,oblique
npx @tobisk/pcbs renders path/to/renders.ts --output-dir ./review
```

Board paths and `outputDirectory` are relative to the definition file, independent
of the calling working directory. Outputs default to `name.png` or `name.wrl`;
a render's `output` overrides that name relative to `outputDirectory`. The CLI
`--output-dir` is relative to the calling directory and redirects every selected
output there using its filename, including custom outputs that normally target
another directory.

Definitions execute in declaration order. Put model exports before views of
boards that reference those exported models. `--only` selects exactly the named
jobs, preserving declaration order; it does not implicitly execute other jobs.
The full selected batch is validated before rendering. Duplicate names or outputs,
missing boards, invalid camera values and outputs that overwrite input boards are
rejected. A native failure stops the series and names the failed job; outputs from
already completed jobs remain available. Each native render verifies that its
source board's bytes remain unchanged.

## Options

- All kinds: `name`, optional `board` override, optional `output` filename.
- `layers`: `layers`, `side` (`top` or mirrored `bottom`), `mirror`, `width`.
- `3d`: `side` (`top`, `bottom`, `left`, `right`, `front`, `back`),
  `rotate`, `zoom`, `pan`, `pivot`, `width`, `height`.
- `model`: `origin` as `[x, y]` in millimeters.

Rotation vectors are `[x, y, z]` in degrees. Camera vectors are passed through to
KiCad; its pivot is relative to the board center in centimeters. Zoom defaults to
1. The framework's existing native render defaults remain in effect for unspecified
options. Use ordinary TypeScript constants/spreads to share settings across views.
