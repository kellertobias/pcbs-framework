import { expect, it } from 'vitest';
import { normalizeBoardNets, serializeNativeBoard } from '../kicad/KicadNetFormat';
import { SExpressionParser as Parser, type SExpr } from '../kicad/SExpressionParser';
import { synchronizePcb } from '../kicad/PcbSynchronizer';

it('normalizes mixed name/number nets and writes KiCad 10 name-based pad and copper nets', () => {
    const native =
        '(kicad_pcb (version 20260206) (net 3 "GND") (footprint "pad" (pad "1" smd rect (net "GND"))) (segment (net "SIGNAL")))';
    const root = Parser.parse(native)[0] as SExpr[];
    normalizeBoardNets(root);
    expect(Parser.serialize(root)).toContain('(net 4 "SIGNAL")');
    const emitted = serializeNativeBoard(Parser.serialize(root));
    expect(emitted).toContain('(net "GND")');
    expect(emitted).toContain('(net "SIGNAL")');
    expect(emitted).not.toContain('(net 3');
    expect(emitted).not.toContain('(net 4');
    expect(serializeNativeBoard(emitted)).toBe(emitted);
});
it('synchronizes a native name-only PCB without losing existing copper net identity', () => {
    const existing =
        '(kicad_pcb (version 20260206) (segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net "KEEP") (uuid "saved")))';
    const generated = '(kicad_pcb (version 20260206) (net 1 "NEW") (net 2 "KEEP"))';
    const { content } = synchronizePcb(existing, generated);
    const native = serializeNativeBoard(content);
    expect(native).toContain('(net "KEEP")');
    expect(native).toContain('(uuid "saved")');
});
