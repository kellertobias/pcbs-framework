import { Kicad3DModel } from '@tobisk/pcbs';

export async function makeModel() {
    const model = await new Kicad3DModel({ unit: 'mm' }).init();
    const plate = model.box({ x: 30, y: 22, z: 3, center: true }).color('#22798b');
    plate.name('Mounting plate');
    model.subtract(plate, model.cylinder({ r: 5, h: 6, center: true }));
    for (const x of [-11, 11]) {
        for (const y of [-7, 7]) {
            const hole = model.cylinder({ r: 1.6, h: 6, center: true });
            hole.translate({ x, y, z: 0 });
            model.subtract(plate, hole);
        }
    }
    return model;
}
