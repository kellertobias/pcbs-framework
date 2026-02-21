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

    const flattenedDefinition = this.flattenSymbol(symbol, dependencies);

    return {
      name: qualifiedName,
      definition: flattenedDefinition,
      dependencies: [], // No longer used as it's flattened
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

                  // Qualify the main symbol name in its definition with colon
                  item[1] = `"${libName}:${name}"`;

                  // Recursively qualify any nested symbols and extends references
                  this.qualifySymbol(item, libName);

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

  private qualifySymbol(expr: SExpr, libName: string) {
    if (!Array.isArray(expr)) return;

    for (const item of expr) {
      if (Array.isArray(item)) {
        if (item[0] === "symbol") {
          const name = SExpressionParser.unquote(item[1] as string);
          // CRITICAL: We DO NOT qualify nested symbol names (units).
          // Units must keep their original names relative to the parent symbol.
          // We only qualify the root symbol name, which is handled in ensureLibraryLoaded.
          // nested units are NOT qualified further.
          // this.qualifySymbol(item, libName); // Still check deep for extends but don't touch names here

          // Actually, we SHOULD recurse but the base case (this symbol) shouldn't be touched if it's a unit.
          // However, we need to qualify 'extends' inside units if they exist.
          this.qualifySymbol(item, libName);
        } else if (item[0] === "extends") {
          const parent = SExpressionParser.unquote(item[1] as string);
          if (!parent.includes(":")) {
            item[1] = `"${libName}:${parent}"`;
          }
        }
      }
    }
  }

  private flattenSymbol(symbol: SExpr, dependencies: SExpr[]): SExpr {
    if (!Array.isArray(symbol)) return symbol;

    // Start with a shallow copy to avoid mutating the original lib data
    const result: SExpr[] = [...symbol];

    // Find the 'extends' line if it exists
    const extendsIdx = result.findIndex(item => Array.isArray(item) && item[0] === "extends");
    if (extendsIdx === -1) return result; // Nothing to flatten

    // Remove the 'extends' clause
    result.splice(extendsIdx, 1);

    // Merge dependencies from top to bottom (root parent handled first)
    // dependencies list is [root_parent, middle_parent, ...]
    // Properties in child override parent.
    // Graphical symbols (units) from parents are added.

    // Helper to extract properties and units
    const getPropsAndUnits = (sexpr: SExpr[]) => {
      const props = new Map<string, SExpr[]>();
      const units: SExpr[][] = [];
      const others: SExpr[] = [];

      for (const item of sexpr) {
        if (Array.isArray(item)) {
          if (item[0] === "property") {
            const propName = SExpressionParser.unquote(item[1] as string);
            props.set(propName, item);
          } else if (item[0] === "symbol") {
            units.push(item);
          } else if (item[0] !== "extends") {
            others.push(item);
          }
        }
      }
      return { props, units, others };
    };

    // Current symbol data
    const current = getPropsAndUnits(result);
    // Get the child's short name for unit renaming
    const childShortName = SExpressionParser.unquote(result[1] as string).split(":").pop() || "";

    // We strictly want to inherit from ALL parents in the chain.
    // We iterate through parents and collect everything, with overrides.
    const mergedProps = new Map<string, SExpr[]>();
    const mergedUnits: SExpr[][] = [];
    const mergedOthers: SExpr[] = [];

    // The 'dependencies' array from collectDependencies is [Parent, GrandParent, ...] 
    // Wait, collectDependencies uses post-order: this.collectDependencies(lib, parent, dependencies); dependencies.push(parent);
    // So dependencies is [GrandParent, Parent]. This is exactly the order for merging.

    for (const dep of dependencies) {
      if (Array.isArray(dep)) {
        const d = getPropsAndUnits(dep as SExpr[]);
        // Merge properties
        for (const [name, val] of d.props) {
          mergedProps.set(name, val);
        }
        // Add units and RENAME them to match the child's short name
        for (const unit of d.units) {
          const clonedUnit = [...unit];
          const originalUnitName = SExpressionParser.unquote(clonedUnit[1] as string);
          // Original unit name often looks like "ParentName_0_1" or "ParentName_NMOS_GSD_0_1"
          // We want to extract only the numeric suffix like "_0_1" or "_1_1"
          const match = originalUnitName.match(/(_\d+_\d+)$/);
          const unitSuffix = match ? match[1] : "";
          clonedUnit[1] = `"${childShortName}${unitSuffix}"`;
          mergedUnits.push(clonedUnit);
        }
        // Merge others (exclude things that shouldn't be merged like specific header tags)
        // For now, take only graphical things or known tags if missing
      }
    }

    // Now apply current (child) overrides
    for (const [name, val] of current.props) {
      mergedProps.set(name, val);
    }
    // Child units are appended to parent units
    mergedUnits.push(...current.units);

    // Reconstruct the symbol
    const finalSymbol: SExpr[] = [result[0], result[1]]; // (symbol "Name" ...)

    // Add merged "others" (like (exclude_from_sim no) etc) from child primarily
    const excludeList = ["property", "symbol", "extends"];
    for (const item of result) {
      if (Array.isArray(item) && !excludeList.includes(item[0] as string)) {
        finalSymbol.push(item);
      }
    }

    // Add all merged properties
    for (const prop of mergedProps.values()) {
      finalSymbol.push(prop);
    }

    // Add all units
    for (const unit of mergedUnits) {
      finalSymbol.push(unit);
    }

    return finalSymbol;
  }

  private collectDependencies(lib: Map<string, SExpr>, symbol: SExpr, dependencies: SExpr[]) {
    // Check for (extends "Library:Parent")
    if (Array.isArray(symbol)) {
      for (const item of symbol) {
        if (Array.isArray(item) && item[0] === "extends") {
          const rawParentName = item[1];
          if (typeof rawParentName === "string") {
            const qualifiedParentName = SExpressionParser.unquote(rawParentName);
            // Parent short name in lib map is without library prefix.
            // Split by ':'
            const parts = qualifiedParentName.split(":");
            const parentShortName = parts.length > 1 ? parts.slice(1).join(":") : qualifiedParentName;

            const parent = lib.get(parentShortName);
            if (parent) {
              // Check if already in dependencies to avoid duplicates/cycles
              if (!dependencies.includes(parent)) {
                // Recursively collect parent's dependencies first (post-order traversal / topological sort)
                this.collectDependencies(lib, parent, dependencies);
                dependencies.push(parent);
              }
            } else {
              console.warn(`Dependent symbol "${qualifiedParentName}" (extended by symbol) not found in library.`);
            }
          }
        }
      }
    }
  }
}
