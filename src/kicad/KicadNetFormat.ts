import { SExpr, SExpressionParser as Parser } from './SExpressionParser';

/** Normalize native KiCad name-based nets into the numbered interchange used by the routing engine. */
export function normalizeBoardNets(board: SExpr[]): void {
    const tables = board.filter(
        (node): node is SExpr[] => Array.isArray(node) && node[0] === 'net' && node.length >= 3,
    );
    const codes = new Map(tables.map((node) => [Parser.unquote(String(node[2])), String(node[1])]));
    const names = new Set<string>();
    const collect = (node: SExpr): void => {
        if (!Array.isArray(node)) return;
        if (node[0] === 'net' && node.length === 2 && String(node[1]).startsWith('"'))
            names.add(Parser.unquote(String(node[1])));
        else node.forEach(collect);
    };
    collect(board);
    let next = Math.max(0, ...[...codes.values()].map(Number)) + 1;
    for (const name of [...names].sort())
        if (name && !codes.has(name)) codes.set(name, String(next++));
    const convert = (node: SExpr[]): void => {
        for (const item of node) {
            if (!Array.isArray(item)) continue;
            if (item[0] === 'net' && item.length === 2 && String(item[1]).startsWith('"')) {
                const name = Parser.unquote(String(item[1]));
                item.splice(1, item.length - 1, codes.get(name) ?? '0');
                if (node[0] === 'pad') item.push(JSON.stringify(name));
                if (
                    node[0] === 'zone' &&
                    !node.some((entry) => Array.isArray(entry) && entry[0] === 'net_name')
                )
                    node.push(['net_name', JSON.stringify(name)]);
            } else convert(item);
        }
    };
    convert(board);
    const known = new Set(tables.map((node) => String(node[1])));
    if (!known.has('0')) board.push(['net', '0', '""']);
    for (const [name, code] of codes)
        if (!known.has(code)) board.push(['net', code, JSON.stringify(name)]);
}

/** Emit the native net syntax for the target board version without changing the routing engine's interchange. */
export function serializeNativeBoard(content: string): string {
    const ast = Parser.parse(content);
    const root = ast.find(
        (node): node is SExpr[] => Array.isArray(node) && node[0] === 'kicad_pcb',
    );
    if (!root) throw new Error('Cannot serialize invalid PCB');
    const version = root.find(
        (node): node is SExpr[] => Array.isArray(node) && node[0] === 'version',
    );
    if (Number(version?.[1]) < 20260206) return content;
    normalizeBoardNets(root);
    const names = new Map(
        root
            .filter((node): node is SExpr[] => Array.isArray(node) && node[0] === 'net')
            .map((node) => [String(node[1]), Parser.unquote(String(node[2]))]),
    );
    const convert = (node: SExpr[]): void => {
        for (let index = node.length - 1; index >= 0; index--) {
            const item = node[index];
            if (!Array.isArray(item)) continue;
            if (item[0] === 'net_name') {
                node.splice(index, 1);
                continue;
            }
            if (item[0] === 'net') {
                if (node[0] === 'kicad_pcb') {
                    node.splice(index, 1);
                    continue;
                }
                const name =
                    item.length >= 3 ? Parser.unquote(String(item[2])) : names.get(String(item[1]));
                if (name === undefined) throw new Error(`Cannot resolve native PCB net ${item[1]}`);
                item.splice(1, item.length - 1, JSON.stringify(name));
            } else convert(item);
        }
    };
    convert(root);
    return ast.map((node) => Parser.serialize(node)).join('\n') + '\n';
}
