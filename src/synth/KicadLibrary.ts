import * as fs from "fs";
import * as path from "path";
import { KicadSymbol } from "@tobisk-pcb/framework/KicadSymbol";
import { KicadFootprint } from "@tobisk-pcb/framework/KicadFootprint";

/**
 * Merges multiple KicadSymbol and KicadFootprint instances into
 * the project's KiCad library files.
 *
 * - Symbols → single `.kicad_sym` file
 * - Footprints → individual `.kicad_mod` files inside a `.pretty` directory
 *
 * @example
 * ```ts
 * const lib = new KicadLibrary();
 * lib.addSymbol(mySymbol);
 * lib.addFootprint(myFootprint);
 * lib.writeSymbols("lib/Project_Symbols.kicad_sym");
 * lib.writeFootprints("lib/Project_Footprints.pretty");
 * ```
 */
export class KicadLibrary {
  private _symbols: KicadSymbol[] = [];
  private _footprints: KicadFootprint[] = [];

  public addSymbol(symbol: KicadSymbol): this {
    this._symbols.push(symbol);
    return this;
  }

  public addFootprint(footprint: KicadFootprint): this {
    this._footprints.push(footprint);
    return this;
  }

  public get symbols(): ReadonlyArray<KicadSymbol> {
    return this._symbols;
  }

  public get footprints(): ReadonlyArray<KicadFootprint> {
    return this._footprints;
  }

  // ── Symbol library file ────────────────────────────────────────────

  /**
   * Serialize all symbols into a complete `.kicad_sym` library file.
   */
  public serializeSymbols(): string {
    const parts: string[] = [];

    parts.push(`(kicad_symbol_lib`);
    parts.push(`\t(version 20241209)`);
    parts.push(`\t(generator "pcb_framework")`);
    parts.push(`\t(generator_version "9.0")`);

    for (const sym of this._symbols) {
      parts.push(sym.serialize());
    }

    parts.push(`)`);

    return parts.join("\n") + "\n";
  }

  /**
   * Write all symbols into a single `.kicad_sym` file.
   * Creates parent directories if needed.
   * @returns The full path to the written file.
   */
  public writeSymbols(filePath: string): string {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, this.serializeSymbols(), "utf-8");
    return filePath;
  }

  // ── Footprint library directory ────────────────────────────────────

  /**
   * Write all footprints into a `.pretty` directory.
   * Creates the directory if it doesn't exist.
   * @returns Array of written file paths.
   */
  public writeFootprints(prettyDir: string): string[] {
    if (!fs.existsSync(prettyDir)) {
      fs.mkdirSync(prettyDir, { recursive: true });
    }
    return this._footprints.map(fp => fp.writeFile(prettyDir));
  }

  /**
   * Write both symbols and footprints to the given library directory.
   * Convenience method combining `writeSymbols` and `writeFootprints`.
   *
   * @param libDir - The library directory (e.g. "lib")
   * @param symFilename - Symbol library filename (default: "Project_Symbols.kicad_sym")
   * @param fpDirname - Footprint directory name (default: "Project_Footprints.pretty")
   */
  public writeAll(
    libDir: string,
    symFilename = "Project_Symbols.kicad_sym",
    fpDirname = "Project_Footprints.pretty"
  ): { symbolsPath: string; footprintPaths: string[] } {
    const symbolsPath = this.writeSymbols(path.join(libDir, symFilename));
    const footprintPaths = this.writeFootprints(path.join(libDir, fpDirname));
    return { symbolsPath, footprintPaths };
  }

  /**
   * Generate the content for a KiCad fp-lib-table file.
   * @param relativePathToLibDir - Path from project dir to the directory containing .pretty
   * @param libName - The name of the library (default: "Project_Footprints")
   */
  public static generateFpLibTable(relativePathToLibDir: string, libName = "Project_Footprints"): string {
    // Do NOT use path.join here — it normalizes away ${KIPRJMOD}
    const uri = `\${KIPRJMOD}/${relativePathToLibDir}/${libName}.pretty`;
    return [
      `(fp_lib_table`,
      `  (version 7)`,
      `  (lib (name ${JSON.stringify(libName)})(type "KiCad")(uri ${JSON.stringify(uri)})(options "")(descr "Local Project Footprints"))`,
      `)`,
      ""
    ].join("\n");
  }

  /**
   * Generate the content for a KiCad sym-lib-table file.
   * @param relativePathToLibDir - Path from project dir to the directory containing .kicad_sym
   * @param libName - The name of the library (default: "Project_Symbols")
   */
  public static generateSymLibTable(relativePathToLibDir: string, libName = "Project_Symbols"): string {
    // Do NOT use path.join here — it normalizes away ${KIPRJMOD}
    const uri = `\${KIPRJMOD}/${relativePathToLibDir}/${libName}.kicad_sym`;
    return [
      `(sym_lib_table`,
      `  (version 7)`,
      `  (lib (name ${JSON.stringify(libName)})(type "KiCad")(uri ${JSON.stringify(uri)})(options "")(descr "Local Project Symbols"))`,
      `)`,
      ""
    ].join("\n");
  }
}
