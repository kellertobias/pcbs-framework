import { unzipSync, strFromU8 } from 'fflate';
/** ThreeMFLoader retains raw coordinates. Convert the archive's declared units
 * explicitly so display bounds and point distances remain millimetres.
 */
export function threeMFMillimetreScale(data: Uint8Array): number {
    const archive = unzipSync(data);
    const scales: Record<string, number> = {
        micron: 0.001,
        millimeter: 1,
        centimeter: 10,
        inch: 25.4,
        foot: 304.8,
        meter: 1000,
    };
    const units = Object.entries(archive)
        .filter(([name]) => /\.model$/i.test(name))
        .map(([, data]) => {
            const xml = strFromU8(data);
            return (
                /<(?:\w+:)?model\b[^>]*\bunit\s*=\s*["']([^"']+)["']/i.exec(xml)?.[1] ??
                'millimeter'
            );
        });
    if (!units.length || units.some((unit) => scales[unit] === undefined))
        throw new Error('Unsupported or missing 3MF model unit');
    if (new Set(units).size !== 1) throw new Error('3MF models with mixed units are unsupported');
    return scales[units[0]];
}
