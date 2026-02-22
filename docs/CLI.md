# CLI Documentation

The `@tobisk/pcbs` framework provides a powerful CLI to manage your project.

## Commands

Run commands using `npx pcbs <command> [args]`.

### `synth`

Synthesizes a TypeScript schematic into KiCad files (`.kicad_sch` and `.net`).

```bash
npx pcbs synth src/schematics/MyBoard.ts
```

**Options:**
*   `--no-wires`: Skip wire generation (symbols only). **For debugging purposes.**
*   `--no-symbols`: Skip symbol generation (wires only). **For debugging purposes.**
*   `--experimental-routing`: Enable experimental auto-routing algorithm.

### `parts`

Search for components in the JLCPCB parts library.

**Interactive Mode:**
Run without arguments to enter an interactive search shell.

```bash
npx pcbs parts
```

**Direct Search:**
Use flags to search directly.

```bash
npx pcbs parts --footprint "SOIC-8" --value "10k"
```

**Options:**
*   `--footprint`: Filter by footprint.
*   `--value`: Filter by component value.
*   `--basic-only`: Search only for "Basic" parts (cheaper/no setup fee).
*   `--json`: Output results in JSON format.

*Note: This command requires Python and the `search_lib.py` script to be set up correctly.*

### `lib`

Generates project-specific KiCad libraries (`.kicad_sym` and `.pretty`) from your **[Module](Module.md)** definitions in `src/module/`.

```bash
npx pcbs lib
```

This command scans `src/module/*.ts`, executes the static `makeSymbol()` and `makeFootprint()` methods, and optionally generates 3D models via `make3DModel()`.

### `export`

Generates manufacturing files for JLCPCB.

```bash
npx pcbs export src/schematics/MyBoard.ts
```

**Outputs:**
*   Gerber files
*   Drill files
*   BOM (Bill of Materials) in JLCPCB CSV format
*   CPL (Component Placement List) in JLCPCB CSV format
*   3D Renders (Top, Bottom, Angled)
*   A ZIP archive containing all necessary files for upload.

### `validate`

Validates the generated KiCad libraries to ensure they are parsable by KiCad.

```bash
npx pcbs validate
```

This command attempts to export symbols and footprints to SVG using `kicad-cli` as a validity check.
