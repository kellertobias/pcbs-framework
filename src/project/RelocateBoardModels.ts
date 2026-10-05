import fs from 'node:fs';
import path from 'node:path';
import { SExpressionParser as Parser, type SExpr } from '../kicad/SExpressionParser';

export interface AssetDirectoryMove {
    from: string;
    to: string;
}
/** Rebase generated native board model links after a project move; copper/pad geometry is untouched. */
export function relocateBoardModels(
    board: string,
    previousDirectory: string,
    moves: AssetDirectoryMove[],
): number {
    const ast = Parser.parse(fs.readFileSync(board, 'utf8'));
    let count = 0;
    const ordered = [...moves].sort((a, b) => b.from.length - a.from.length);
    const walk = (node: SExpr): void => {
        if (!Array.isArray(node)) return;
        if (node[0] === 'model' && typeof node[1] === 'string') {
            const original = Parser.unquote(node[1]);
            let resolved = original;
            if (original.startsWith('${KIPRJMOD}/'))
                resolved = path.resolve(previousDirectory, original.slice(12));
            else if (!original.startsWith('$') && !path.isAbsolute(original))
                resolved = path.resolve(previousDirectory, original);
            for (const move of ordered) {
                const from = path.resolve(move.from);
                if (resolved === from || resolved.startsWith(from + path.sep)) {
                    resolved = path.resolve(move.to, path.relative(from, resolved));
                    break;
                }
            }
            if (resolved !== original) {
                node[1] = JSON.stringify(resolved);
                count++;
            }
        }
        for (const child of node.slice(1)) walk(child);
    };
    for (const node of ast) walk(node);
    if (count) {
        const temporary = `${board}.tmp-${process.pid}`;
        fs.writeFileSync(temporary, ast.map((node) => Parser.serialize(node)).join('\n') + '\n');
        fs.renameSync(temporary, board);
    }
    return count;
}
