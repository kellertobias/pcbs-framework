import { Assembly, Kicad3DModel } from '@tobisk/pcbs';

const assembly = new Assembly({
    name: 'Indicator above a tray',
    views: [
        {
            id: 'assembly-isometric',
            position: [100, -95, 100],
            target: [25, 22, 6],
            projection: 'orthographic',
            span: 92,
        },
        {
            id: 'assembly-top',
            position: [25, 22, 200],
            target: [25, 22, 0],
            up: [0, 1, 0],
            projection: 'orthographic',
            span: 68,
        },
        {
            id: 'assembly-tray',
            position: [100, -95, 100],
            target: [25, 22, 0],
            projection: 'orthographic',
            span: 92,
            visibleParts: ['tray'],
        },
    ],
});

// #region parts
assembly.addBoard({
    id: 'indicator',
    file: '../../../.cache/docs-examples/Indicator.kicad_pcb',
    origin: [50, 42],
    position: [0, 44, 8.8],
});
assembly.addGenerated({
    id: 'tray',
    model: async () => {
        const model = await new Kicad3DModel({ unit: 'mm' }).init();
        model
            .box({ x: 60, y: 54, z: 3, center: true })
            .translate({ x: 25, y: 22, z: -1.5 })
            .color('#89949e');
        for (const x of [-4, 54]) {
            model
                .box({ x: 2, y: 54, z: 10, center: true })
                .translate({ x, y: 22, z: 2 })
                .color('#89949e');
        }
        return model;
    },
});
// #endregion parts
export default assembly;
