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
