import * as fs from "fs";
import * as path from "path";

export type SExpr = string | SExpr[];

/**
 * Tokenize and parse a KiCad S-expression string into nested arrays.
 */
export function parseSExpr(input: string): SExpr[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < input.length) {
        const c = input[i];
        if (c === '(' || c === ')') {
            tokens.push(c);
            i++;
        } else if (c === '"') {
            let str = '"';
            i++;
            while (i < input.length && input[i] !== '"') {
                if (input[i] === '\\') {
                    str += input[i] + input[i + 1];
                    i += 2;
                } else {
                    str += input[i];
                    i++;
                }
            }
            str += '"';
            tokens.push(str);
            i++;
        } else if (c.trim() === '') {
            i++;
        } else {
            let sym = '';
            while (i < input.length && input[i].trim() !== '' && input[i] !== '(' && input[i] !== ')' && input[i] !== '"') {
                sym += input[i];
                i++;
            }
            tokens.push(sym);
        }
    }

    let tIdx = 0;
    function parseList(): SExpr[] {
        const list: SExpr[] = [];
        tIdx++; // skip '('
        while (tIdx < tokens.length && tokens[tIdx] !== ')') {
            if (tokens[tIdx] === '(') {
                list.push(parseList());
            } else {
                list.push(tokens[tIdx]);
                tIdx++;
            }
        }
        tIdx++; // skip ')'
        return list;
    }

    const ast: SExpr[] = [];
    while (tIdx < tokens.length) {
        if (tokens[tIdx] === '(') {
            ast.push(parseList());
        } else {
            tIdx++; // Skip top level stray tokens
        }
    }
    return ast;
}

export interface KicadSymbolShape {
    type: "rectangle" | "circle" | "polyline" | "arc" | "pin";
    data: any;
}

export interface KicadSymbolData {
    name: string;
    shapes: KicadSymbolShape[];
    pins: Map<string, any>; // pin number -> pin pos/length
}

const astCache = new Map<string, SExpr[]>();

function getAstForLibrary(libName: string, cwd: string): SExpr[] | null {
    if (astCache.has(libName)) return astCache.get(libName)!;

    const KICAD_PATH = "/Applications/KiCad/KiCad.app/Contents/SharedSupport";
    const SYMBOLS_DIR = path.join(KICAD_PATH, "symbols");
    const PROJECT_LIB_DIR = path.join(cwd, ".kicad");

    let libPath = "";
    if (libName === "Project_Symbols") {
        libPath = path.join(PROJECT_LIB_DIR, "Project_Symbols.kicad_sym");
    } else {
        libPath = path.join(SYMBOLS_DIR, `${libName}.kicad_sym`);
    }

    if (!fs.existsSync(libPath)) {
        return null;
    }

    const content = fs.readFileSync(libPath, "utf-8");
    const ast = parseSExpr(content);
    astCache.set(libName, ast);
    return ast;
}

/** Given a full Library symbol name like 'Device:R', locate the .kicad_sym and extract its AST */
export function extractSymbol(libraryRef: string, cwd: string): KicadSymbolData | null {
    if (!libraryRef.includes(":")) return null;
    const [libName, symName] = libraryRef.split(":");

    const astLib = getAstForLibrary(libName, cwd);
    if (!astLib) return null;

    // Search for the symbol matching our exact name
    // AST is a list of top-level expressions: (kicad_symbol_lib (version X) (symbol "Name" ... ) )
    const root = astLib[0];
    if (!Array.isArray(root) || root[0] !== "kicad_symbol_lib") return null;

    // We must find the exact symbol, OR an alias alias.
    // In KiCad format, multiple symbols are listed at the root.
    for (let i = 1; i < root.length; i++) {
        const node = root[i];
        if (Array.isArray(node) && node[0] === "symbol" && node[1] === `"${symName}"`) {
            return parseSymbolNode(node);
        }
    }
    return null;
}

function parseSymbolNode(node: SExpr[]): KicadSymbolData {
    const symName = (node[1] as string).replace(/"/g, '');
    const data: KicadSymbolData = {
        name: symName,
        shapes: [],
        pins: new Map()
    };

    // Symbols often contain nested (symbol "R_0_1" (rectangle ... ))
    // We should flatten all graphic items from all nested 'symbol' units
    function traverse(n: SExpr[]) {
        if (!Array.isArray(n) || n.length === 0) return;

        const type = n[0] as string;
        if (type === "symbol") {
            const subSymName = (n[1] as string).replace(/"/g, '');
            const isRoot = n === node;
            const isUnit0Or1Style1 = subSymName.endsWith("_0_1") || subSymName.endsWith("_1_1");

            if (isRoot || isUnit0Or1Style1) {
                for (let i = 2; i < n.length; i++) {
                    traverse(n[i] as SExpr[]);
                }
            }
        } else if (type === "rectangle" || type === "circle" || type === "polyline" || type === "arc") {
            data.shapes.push({ type, data: n });
        } else if (type === "pin") {
            // Find pin number
            let pinNum = "";
            for (let i = 1; i < n.length; i++) {
                const child = n[i];
                if (Array.isArray(child) && child[0] === "number") {
                    pinNum = (child[1] as string).replace(/"/g, '');
                }
            }
            if (pinNum) {
                data.pins.set(pinNum, n);
            }
            // Add pin to shapes list to draw it too
            data.shapes.push({ type: "pin", data: n });
        }
    }

    traverse(node);
    return data;
}
