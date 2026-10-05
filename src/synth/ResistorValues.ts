/**
 * Parses a resistor value string (e.g., "1k", "2k2", "10", "1M") into a number in Ohms.
 */
export function parseResistorValue(val: string): number {
    const clean = val.toLowerCase().replace(/Ω/g, '').trim();
    if (clean.endsWith('k')) {
        return parseFloat(clean.slice(0, -1)) * 1000;
    }
    if (clean.includes('k')) {
        const [k, rest] = clean.split('k');
        return parseFloat(k) * 1000 + (parseFloat(rest) || 0) * Math.pow(10, 3 - rest.length);
    }
    if (clean.endsWith('m')) {
        return parseFloat(clean.slice(0, -1)) * 1000000;
    }
    if (clean.includes('m')) {
        const [m, rest] = clean.split('m');
        return parseFloat(m) * 1000000 + (parseFloat(rest) || 0) * Math.pow(10, 6 - rest.length);
    }
    if (clean.endsWith('r')) {
        return parseFloat(clean.slice(0, -1));
    }
    return parseFloat(clean);
}

// Special case for formats like 2k2
export function parseResistorValueBetter(val: string): number {
    let clean = val.toLowerCase().replace(/ω/g, '').replace(/r/g, '').trim();

    // Handle units
    if (clean.includes('k')) {
        const parts = clean.split('k');
        const whole = parseFloat(parts[0] || '0');
        const fraction = parts[1] ? parseFloat('0.' + parts[1]) : 0;
        return (whole + fraction) * 1000;
    }
    if (clean.includes('m')) {
        const parts = clean.split('m');
        const whole = parseFloat(parts[0] || '0');
        const fraction = parts[1] ? parseFloat('0.' + parts[1]) : 0;
        return (whole + fraction) * 1000000;
    }

    return parseFloat(clean);
}

export function getClosestResistor(
    target: number,
    resistors: Readonly<Record<string, string>>,
): { value: number; label: string; lcsc: string } {
    let bestMatch: { value: number; label: string; lcsc: string } | null = null;
    let minDiff = Infinity;

    for (const [label, lcsc] of Object.entries(resistors)) {
        const val = parseResistorValueBetter(label);
        const diff = Math.abs(val - target);
        if (diff < minDiff) {
            minDiff = diff;
            bestMatch = { value: val, label, lcsc };
        }
    }

    if (!bestMatch) {
        throw new Error('No resistors found in the supplied catalog');
    }

    return bestMatch;
}
