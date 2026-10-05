import { describe, expect, it } from 'vitest';
import { Kicad3DModel } from '../synth/3d/Kicad3DModel';

describe('solid contour lofts', () => {
    it('builds a valid tapered solid with the expected frustum volume', async () => {
        const m = new Kicad3DModel({ unit: 'mm' });
        await m.init();
        const contour = (half: number, z: number) => [
            { x: -half, y: -half, z },
            { x: half, y: -half, z },
            { x: half, y: half, z },
            { x: -half, y: half, z },
        ];
        const solid = m
            .loft({ sections: [contour(9, 0), contour(7, 8)] })
            .color({ r: 0.8, g: 0.9, b: 1, a: 0.4 })
            .name('cap');
        const oc: any = m.oc;
        const props = new oc.GProp_GProps_1();
        oc.BRepGProp.VolumeProperties_1(solid._handle.shape, props, true, false, false);
        expect(props.Mass()).toBeCloseTo((8 / 3) * (18 * 18 + 14 * 14 + 18 * 14), 5);
        props.delete();
        expect(m.solids).toHaveLength(1);
        expect(m.solids[0].color?.a).toBe(0.4);
    }, 30000);
    it('rejects insufficient, mismatched and non-finite profiles', async () => {
        const m = new Kicad3DModel();
        await m.init();
        const triangle = [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
        ];
        expect(() => m.loft({ sections: [triangle] })).toThrow();
        expect(() => m.loft({ sections: [triangle, triangle.slice(1)] })).toThrow();
        expect(() =>
            m.loft({ sections: [triangle, triangle.map((p) => ({ ...p, z: NaN }))] }),
        ).toThrow();
    });
});
