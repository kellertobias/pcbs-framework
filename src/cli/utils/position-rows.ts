/** KiCad CSV positions preserve quoted values, commas, spaces and embedded quotes. */
export function positionRows(content: string): string[][] {
    const first = content.trimStart().split(/\r?\n/, 1)[0];
    if (first.startsWith('#')) {
        return content
            .split(/\r?\n/)
            .filter((line) => line.trim() && !line.trim().startsWith('#'))
            .map((line) => {
                const match = line
                    .trim()
                    .match(/^(\S+)\s+(\S+)\s+(\S+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+(\S+)$/);
                if (!match)
                    throw new Error(
                        `Ambiguous legacy ASCII position row; export KiCad CSV instead: ${line}`,
                    );
                return match.slice(1);
            });
    }
    // Accept legacy simple ASCII input for callers using the existing converter API.
    if (!first.includes(',')) return positionRows(`# legacy\n${content}`);
    const rows: string[][] = [];
    let row: string[] = [],
        cell = '',
        quoted = false;
    for (let i = 0; i < content.length; i++) {
        const character = content[i];
        if (character === '"') {
            if (quoted && content[i + 1] === '"') {
                cell += '"';
                i++;
            } else quoted = !quoted;
        } else if (!quoted && character === ',') {
            row.push(cell);
            cell = '';
        } else if (!quoted && character === '\n') {
            row.push(cell.replace(/\r$/, ''));
            rows.push(row);
            row = [];
            cell = '';
        } else cell += character;
    }
    if (quoted) throw new Error('Unterminated quote in KiCad position CSV');
    if (cell || row.length) {
        row.push(cell.replace(/\r$/, ''));
        rows.push(row);
    }
    const header = rows.shift();
    if (!header || header.join(',') !== 'Ref,Val,Package,PosX,PosY,Rot,Side')
        throw new Error('Unexpected KiCad position CSV columns');
    return rows
        .filter((row) => row.length > 1)
        .map((row) => {
            if (row.length !== 7) throw new Error('Invalid KiCad position CSV row');
            return row;
        });
}
