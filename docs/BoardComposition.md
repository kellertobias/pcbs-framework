# Referenced boards and PCB modules

A `Schematic` can place independent source schematics on a panel. A `BoardModule`
can use a source schematic as one assembled component on a carrier. Both regenerate
from framework source; generated KiCad files are outputs.

## Arrange boards on a panel

Call `addBoard()` inside `generate()`. Place and rotate boards in PCB millimetres.
Each unique instance ID namespaces its component references, nets and UUIDs.
Child circuits stay independent, including when the same schematic is used twice.

```ts
class FaderPanel extends Schematic {
    generate() {
        this.addBoard(singleFader, {
            id: 'fader1', x: 10, y: 10,
            origin: { x: 53, y: 8.5 },
            sourceDirectory: singleFaderProjectDirectory,
        });
        this.addBoard(singleFader, {
            id: 'fader2', x: 10, y: 35,
            origin: { x: 53, y: 8.5 },
            sourceDirectory: singleFaderProjectDirectory,
        });
    }
}
export default new FaderPanel({ name: 'FaderPanel' });
```

`origin` identifies the point in the source PCB mapped to the instance's `x/y`.
Rotation follows the existing clockwise PCB convention. `sourceDirectory` is
optional; provide it to resolve a source project's footprint table and load its
captured `routing.json` (or declared `pcb.routingFile`). Otherwise placement uses
the containing project's footprint libraries and source-declared routes.

A panel automatically inherits the first board's thickness and physical stackup
unless it declares its own `pcb` options. Every board must match that stackup.
The child outlines, footprints, copper tracks, vias, zones and drawings are copied;
zone fills need native KiCad refill. Net classes are copied with namespaced nets.
The parent can declare additional contours, tooling holes and explicit routes in
its usual PCB routing file. Arrange boards with sufficient clearance, then run
DRC with `--refill-zones` on the generated panel.

Generation also writes each child schematic/project into `boards/<id>/`. The
parent schematic/netlist contains only its own circuit; child circuits remain in
those separate schematics. Panel schematic-parity checking against only the parent
netlist therefore does not describe the full panel.

This API places boards; it does not automatically design breakaway tabs, mouse
bites, V-scores, rails or an array packing strategy. Put those manufacturing
choices in the panel's handwritten PCB routing definitions.

## Use a finished board as a module

Declare the source schematic's physical interface in its constructor options.
Each entry maps a symbol pad number to a source component's physical pad number.
Internal components and copper never become carrier-board circuit elements.

```ts
super({
    name: 'SingleFaderController',
    pcb: faderPcbRouting,
    moduleInterface: {
        origin: { x: 53, y: 8.5 },
        pads: [
            { number: '1', ref: 'J1', pad: '1' },
            { number: '2', ref: 'J1', pad: '3' },
            { number: '3', ref: 'J2', pad: '1' },
            { number: '4', ref: 'J2', pad: '3' },
        ],
    },
});
```

This abbreviated example exposes VM, GND, SDA and SCL from the single-fader
controller. Expose all contacts required by your actual mating connector and
symbol. Multiple source pads may share the same exported symbol pad number.
You can override `interface` per module variant and set an optional `contact`
object on a selected pad to change its carrier pad type, drill, dimensions or
layers while retaining its generated position and orientation. This is useful
when the carrier uses a different mating contact from the fitted source socket.

Extend `BoardModule`, which extends the existing `Module` class:

```ts
class SingleFaderModule extends BoardModule<'VM' | 'GND' | 'SDA' | 'SCL'> {
    constructor(ref: string, pcbPosition: PcbPosition) {
        super({
            name: 'SingleFaderModule',
            ref,
            symbol: 'Project_Symbols:SingleFaderModule',
            schematic: singleFader,
            sourceDirectory: singleFaderProjectDirectory,
            pcbPosition,
            standoff: 13,
            pins: pin => ({ VM: pin(1), GND: pin(2), SDA: pin(3), SCL: pin(4) }),
        });
    }
    // Define makeSymbol() using your usual KicadSymbol builder.
}

// Inside the carrier's generate():
const fader = new SingleFaderModule('U1', { x: 50, y: 40 });
fader.pins.VM.tie(motorSupply);
fader.pins.GND.tie(ground);
fader.pins.SDA.tie(sda);
fader.pins.SCL.tie(scl);
```

Generate the carrier using the existing explicit PCB mode, e.g. `synth ... --pcb
rebuild` or `--pcb sync`. The source must have a complete explicit PCB placement
and resolvable footprints. The framework generates its board, selected-pad
footprint and native KiCad assembled VRML model, then places one module footprint
on the carrier. The source board perimeter is `F.Fab` artwork on that footprint,
not carrier `Edge.Cuts`. Your symbol remains independently defined.

Outputs live in `board-modules/<name>/` and `Board_Modules.pretty/`, with a managed
`Board_Modules` footprint-library entry. Models use an absolute generated asset
path, so regenerate after moving a project. Use a distinct module name for each
physical variant. `standoff` measures from carrier top to source PCB underside;
the model offset also accounts for the source board thickness. Check actual
connector mating and populated-module clearances for your assembly.

Native model export requires `kicad-cli`; `KICAD_CLI` can select its executable.
The framework uses the PCB's component model links, so fitted components need
valid 3D models to appear. A missing source board, pad, footprint, cyclic
reference or failed model export stops generation. Model export alone does not
validate electrical routing: refill zones and run native DRC on source and carrier
before fabrication.
