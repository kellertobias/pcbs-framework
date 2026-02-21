import * as fs from "fs";
import * as path from "path";
import { SExpressionParser, SExpr } from "./SExpressionParser";

export interface SymbolDefinition {
  name: string;
  definition: SExpr;
  dependencies: SExpr[];
}

export class SymbolLibrary {
  private loadedLibraries = new Map<string, Map<string, SExpr>>();
  private libraryPaths: string[] = [];

  constructor(libraryPaths: string[] = []) {
    this.libraryPaths = libraryPaths;
  }

  /**
   * Set the search paths for symbol libraries.
   */
  setLibraryPaths(paths: string[]) {
    this.libraryPaths = paths;
  }

  /**
   * Find and load a symbol definition along with any dependencies (extended symbols).
   * @param qualifiedName "Library:Symbol" format
   */
  getSymbol(qualifiedName: string): SymbolDefinition | null {
    const [libName, symName] = qualifiedName.split(":");
    if (!libName || !symName) return null;

    if (!this.ensureLibraryLoaded(libName)) return null;

    const lib = this.loadedLibraries.get(libName)!;
    const symbol = lib.get(symName);
    if (!symbol) return null;

    const dependencies: SExpr[] = [];
    this.collectDependencies(lib, symbol, dependencies);

    return {
      name: symName,
      definition: symbol,
      dependencies,
    };
  }

  private ensureLibraryLoaded(libName: string): boolean {
    if (this.loadedLibraries.has(libName)) return true;

    for (const searchPath of this.libraryPaths) {
      const filePath = path.join(searchPath, `${libName}.kicad_sym`);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const ast = SExpressionParser.parse(content);

          if (ast.length > 0 && Array.isArray(ast[0]) && ast[0][0] === "kicad_symbol_lib") {
            const libContent = ast[0] as SExpr[];
            const symbolMap = new Map<string, SExpr>();

            for (const item of libContent) {
              if (Array.isArray(item) && item[0] === "symbol") {
                const rawName = item[1];
                if (typeof rawName === "string") {
                  const name = SExpressionParser.unquote(rawName);
                  symbolMap.set(name, item);
                }
              }
            }

            this.loadedLibraries.set(libName, symbolMap);
            return true;
          }
        } catch (e) {
          console.warn(`Failed to parse library ${filePath}:`, e);
        }
      }
    }
    return false;
  }

  private collectDependencies(lib: Map<string, SExpr>, symbol: SExpr, dependencies: SExpr[]) {
    // Check for (extends "Parent")
    if (Array.isArray(symbol)) {
      for (const item of symbol) {
        if (Array.isArray(item) && item[0] === "extends") {
          const rawParentName = item[1];
          if (typeof rawParentName === "string") {
             const parentName = SExpressionParser.unquote(rawParentName);
             const parent = lib.get(parentName);
             if (parent) {
                // Check if already in dependencies to avoid duplicates/cycles
                if (!dependencies.includes(parent)) {
                   // Recursively collect parent's dependencies first (post-order traversal / topological sort)
                   this.collectDependencies(lib, parent, dependencies);
                   dependencies.push(parent);
                }
             } else {
                 console.warn(`Dependent symbol "${parentName}" (extended by symbol) not found in library.`);
             }
          }
        }
      }
    }
  }
}
