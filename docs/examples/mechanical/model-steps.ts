import { Kicad3DModel } from '@tobisk/pcbs';

// #region box
export async function solidPlate() {
    const model = await new Kicad3DModel({ unit: 'mm' }).init();
    model.box({ x: 30, y: 22, z: 3, center: true }).color('#22798b');
    return model;
}
// #endregion box

// #region cylinder
export async function cylinder() {
    const model = await new Kicad3DModel({ unit: 'mm' }).init();
    model.cylinder({ r: 8, h: 12, center: true }).color('#b05a3b');
    return model;
}
// #endregion cylinder

// #region boolean
export async function boredPlate() {
    const model = await new Kicad3DModel({ unit: 'mm' }).init();
    const plate = model.box({ x: 30, y: 22, z: 3, center: true }).color('#22798b');
    model.subtract(plate, model.cylinder({ r: 5, h: 6, center: true }));
    return model;
}
// #endregion boolean
