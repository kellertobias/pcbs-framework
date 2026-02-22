import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { SExpressionParser, SExpr } from '../src/kicad/SExpressionParser';

/**
 * Normalizes an S-Expression AST.
 *
 * Sorting rules:
 * 1. The first element of an array is usually its type keyword (e.g. 'symbol', 'pin'). Keep it first.
 * 2. Certain primitive tokens at the start (e.g. ("some_string" ...)) should stay in order up to the first structured node.
 * 3. Arrays representing nested scopes like (property ...) or (pin ...) can be reordered relative to each other safely.
 * 4. The `(pts ...)` block contains points `(xy x y)`. The order of these points matters and MUST be preserved.
 */

function getSortKey(expr: SExpr): string {
    if (typeof expr === 'string') return expr;
    if (expr.length === 0) return '';

    const keyword = expr[0];
    if (typeof keyword !== 'string') return SExpressionParser.serialize(expr);

    let identifier = '';

    if (keyword === 'comp') {
        const refChild = expr.find(c => Array.isArray(c) && c[0] === 'ref') as string[] | undefined;
        if (refChild && typeof refChild[1] === 'string') identifier = refChild[1];
    } else if (keyword === 'libpart') {
        const libChild = expr.find(c => Array.isArray(c) && c[0] === 'lib') as string[] | undefined;
        const partChild = expr.find(c => Array.isArray(c) && c[0] === 'part') as string[] | undefined;
        if (libChild && typeof libChild[1] === 'string' && partChild && typeof partChild[1] === 'string') {
            identifier = `${libChild[1]}:${partChild[1]}`;
        }
    } else if (keyword === 'net') {
        const nameChild = expr.find(c => Array.isArray(c) && c[0] === 'name') as string[] | undefined;
        const codeChild = expr.find(c => Array.isArray(c) && c[0] === 'code') as string[] | undefined;
        if (nameChild && typeof nameChild[1] === 'string') identifier = nameChild[1];
        else if (codeChild && typeof codeChild[1] === 'string') identifier = codeChild[1];
    } else if (keyword === 'pin') {
        const numChild = expr.find(c => Array.isArray(c) && c[0] === 'num') as string[] | undefined;
        if (numChild && typeof numChild[1] === 'string') identifier = numChild[1];
    } else if (keyword === 'node') {
        const refChild = expr.find(c => Array.isArray(c) && c[0] === 'ref') as string[] | undefined;
        const pinChild = expr.find(c => Array.isArray(c) && c[0] === 'pin') as string[] | undefined;
        if (refChild && typeof refChild[1] === 'string' && pinChild && typeof pinChild[1] === 'string') {
            identifier = `${refChild[1]}:${pinChild[1]}`;
        }
    } else if (keyword === 'property' || keyword === 'field') {
        const nameChild = expr.find(c => Array.isArray(c) && c[0] === 'name') as string[] | undefined;
        if (nameChild && typeof nameChild[1] === 'string') identifier = nameChild[1];
        else if (expr.length > 1 && typeof expr[1] === 'string') identifier = expr[1];
    } else if (keyword === 'symbol' || keyword === 'sheet') {
        if (expr.length > 1 && typeof expr[1] === 'string') identifier = expr[1];
    }

    const baseStr = SExpressionParser.serialize(expr);
    if (identifier) {
        return `${keyword}:${identifier}::${baseStr}`;
    }

    return `${keyword}::${baseStr}`;
}

function normalize(expr: SExpr): SExpr {
    if (typeof expr === 'string') {
        return expr;
    }

    if (expr.length === 0) {
        return expr;
    }

    const keyword = typeof expr[0] === 'string' ? expr[0] : '';

    // Do not sort children of a "pts" block or "fill" block as they might be positional configs or points
    if (keyword === 'pts' || keyword === 'xy') {
        // Just normalize children but don't reorder
        return expr.map(normalize);
    }

    // We separate positional primitives from sortable objects
    const positionals: SExpr[] = [];
    const sortables: SExpr[] = [];

    // Everything up to the first Array is positional
    let isPositional = true;
    for (const child of expr) {
        if (isPositional && typeof child === 'string') {
            positionals.push(child);
        } else {
            isPositional = false;
            sortables.push(normalize(child));
        }
    }

    // Sort the nested expressions by their semantic key
    sortables.sort((a, b) => {
        const strA = getSortKey(a);
        const strB = getSortKey(b);
        return strA.localeCompare(strB);
    });

    return [...positionals, ...sortables];
}

async function main() {
    const args = process.argv.slice(2);
    let isExportMode = false;
    let files: string[] = [];

    for (const arg of args) {
        if (arg === '--export') {
            isExportMode = true;
        } else {
            files.push(arg);
        }
    }

    if (files.length !== 2) {
        console.error('Usage: npm run kicad-diff [--export] <fileA> <fileB>');
        process.exit(1);
    }

    const [fileA, fileB] = files;

    if (!(await fileExists(fileA))) {
        console.error(`Error: File A not found: ${fileA}`);
        process.exit(1);
    }

    if (!(await fileExists(fileB))) {
        console.error(`Error: File B not found: ${fileB}`);
        process.exit(1);
    }

    const contentA = await fs.readFile(fileA, 'utf-8');
    const contentB = await fs.readFile(fileB, 'utf-8');

    console.log(`Analyzing Structural Diff...`);

    const astA = SExpressionParser.parse(contentA);
    const astB = SExpressionParser.parse(contentB);

    const normA = astA.map(normalize);
    const normB = astB.map(normalize);

    const strA = normA.map(expr => SExpressionParser.serialize(expr)).join('\n');
    const strB = normB.map(expr => SExpressionParser.serialize(expr)).join('\n');

    if (isExportMode) {
        const outA = fileA + '.sorted';
        const outB = fileB + '.sorted';
        await fs.writeFile(outA, strA, 'utf-8');
        await fs.writeFile(outB, strB, 'utf-8');
        console.log(`Exported sorted files to:\n  ${outA}\n  ${outB}`);
        process.exit(0);
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kicad-diff-'));
    const tmpA = path.join(tmpDir, 'A-' + path.basename(fileA));
    const tmpB = path.join(tmpDir, 'B-' + path.basename(fileB));

    await fs.writeFile(tmpA, strA, 'utf-8');
    await fs.writeFile(tmpB, strB, 'utf-8');

    // Try VS Code diff first, then fallback to git diff
    console.log(`Opening diff...`);

    let isCodeAvailable = false;
    try {
        const codeCheck = spawnSync('code', ['--version'], { shell: true });
        isCodeAvailable = codeCheck.status === 0;
    } catch {
        // Ignored
    }

    if (isCodeAvailable) {
        spawnSync('code', ['--diff', tmpA, tmpB], {
            stdio: 'inherit',
            shell: true
        });

        // When using VS Code, we can't reliably detect if there were differences via exit code.
        // We also need to wait to prevent the temp files from being deleted before VS Code reads them.
        console.log("Diff opened in VS Code. Temporary files will be cleaned up in 10 seconds.");
        setTimeout(async () => {
            await cleanup(tmpA, tmpB, tmpDir);
            process.exit(0);
        }, 10000);
    } else {
        const result = spawnSync('git', ['diff', '--no-index', '--color=always', tmpA, tmpB], {
            stdio: 'inherit',
            shell: true
        });

        await cleanup(tmpA, tmpB, tmpDir);
        process.exit(result.status ?? 0);
    }
}

async function cleanup(tmpA: string, tmpB: string, tmpDir: string) {
    try { await fs.unlink(tmpA); } catch { }
    try { await fs.unlink(tmpB); } catch { }
    try { await fs.rmdir(tmpDir); } catch { }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
