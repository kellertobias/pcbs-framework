import { describe, it, expect } from 'vitest';
import { foldedChannel } from '../synth/3d/FoldedSheetMetal';
import type { Kicad3DModel } from '@tobisk/pcbs';
const parameters = {
    length: 100,
    width: 15,
    depth: 3.5,
    thickness: 0.6,
    bendRadius: 1,
    baseZ: 8.1,
    direction: -1 as const,
};
function section(direction: 1 | -1) {
    let captured: any;
    foldedChannel(
        {
            loft: (p: any) => {
                captured = p;
            },
        } as unknown as Kicad3DModel,
        { ...parameters, direction },
    );
    return captured.sections;
}
describe('folded metal channels', () => {
    it('sweeps a constant-gauge section with distinct inner and outer bend radii', () => {
        const [left, right] = section(-1);
        expect(left.every((p: any) => p.x === -50)).toBe(true);
        expect(right.every((p: any) => p.x === 50)).toBe(true);
        expect(Math.min(...left.map((p: any) => p.z))).toBeCloseTo(4.6);
        expect(Math.max(...left.map((p: any) => p.z))).toBeCloseTo(8.1);
        expect(left.some((p: any) => Math.abs(p.y - 7.5) < 1e-6)).toBe(true);
        expect(left.some((p: any) => Math.abs(p.y - 6.9) < 1e-6)).toBe(true);
        expect(left.length).toBeGreaterThan(40);
    });
    it('mirrors upper and lower folds around the web datum', () => {
        const up = section(1)[0],
            down = section(-1)[0];
        up.forEach((p: any, i: number) => {
            expect(p.y).toBe(down[i].y);
            expect(p.z + down[i].z).toBeCloseTo(16.2);
        });
    });
    it('rejects a radius smaller than the metal gauge', () => {
        expect(() => foldedChannel({} as Kicad3DModel, { ...parameters, bendRadius: 0.5 })).toThrow(
            'Invalid folded',
        );
    });
});
