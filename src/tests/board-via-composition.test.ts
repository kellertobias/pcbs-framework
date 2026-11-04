import { expect, it } from 'vitest';
import { boardRoot, appendBoard, child } from '../kicad/BoardComposition';
import { UuidManager } from '../kicad/UuidManager';
import type { SExpr } from '../kicad/SExpressionParser';

it('transforms copied vias without adding an unsupported rotation coordinate', () => {
    const header =
        '(version 20260206) (general (thickness 1)) (layers (0 "F.Cu" signal) (2 "B.Cu" signal))';
    const parent = boardRoot(`(kicad_pcb ${header})`);
    const source = boardRoot(
        `(kicad_pcb ${header} (via (at 3 4) (size 0.5) (drill 0.2) (layers "F.Cu" "B.Cu") (net "GND") (uuid "old-via")))`,
    );
    appendBoard(parent, source, { id: 'part', x: 10, y: 20, rotation: 90 }, new UuidManager());
    const via = parent.find((n) => Array.isArray(n) && n[0] === 'via') as SExpr[];
    const at = child(via, 'at')!;
    expect(at).toHaveLength(3);
    expect(Number(at[1])).toBeCloseTo(14);
    expect(Number(at[2])).toBeCloseTo(17);
});

it('preserves native footprint point coordinate arity while rotating pad orientations', () => {
    const header =
        '(version 20260206) (general (thickness 1)) (layers (0 "F.Cu" signal) (2 "B.Cu" signal))';
    const parent = boardRoot(`(kicad_pcb ${header})`);
    const source = boardRoot(
        `(kicad_pcb ${header} (footprint "part" (at 3 4) (point (at 1.27 0) (size 2) (layer "F.Fab")) (pad "1" thru_hole circle (at 0 0) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask"))))`,
    );
    appendBoard(parent, source, { id: 'part', x: 10, y: 20, rotation: 90 }, new UuidManager());
    const footprint = child(parent, 'footprint')!;
    expect(child(child(footprint, 'point')!, 'at')).toEqual(['at', '1.27', '0']);
    expect(child(child(footprint, 'pad')!, 'at')).toEqual(['at', '0', '0', '90']);
});
