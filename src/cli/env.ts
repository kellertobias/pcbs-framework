import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { getConfig } from "./config";
import { die } from "./utils";

/**
 * Ensures the Python virtual environment exists and required packages are installed.
 */
export function ensurePythonEnv(): void {
  const { projectRoot, pythonPath } = getConfig();
  const venvDir = path.join(projectRoot, ".venv");

  // 1. Check if .venv exists
  if (!fs.existsSync(venvDir)) {
    console.log("🐍  Python virtual environment not found. Creating one...");
    try {
      execSync("python3 -m venv .venv", { cwd: projectRoot, stdio: "inherit" });
      console.log("  ✅ Virtual environment created.");
    } catch (err) {
      die(`Failed to create virtual environment: ${err}`);
    }
  }

  // 2. Check for required packages
  const packages = ["circuit-synth", "reportlab"];
  const pip = path.join(projectRoot, ".venv", "bin", "pip");

  console.log("🔍  Checking Python dependencies...");
  const missing: string[] = [];

  for (const pkg of packages) {
    try {
      // Use pip show for reliability.
      execSync(`${pip} show ${pkg}`, { stdio: "ignore" });
    } catch {
      missing.push(pkg);
    }
  }

  if (missing.length > 0) {
    console.log(`📦  Installing missing Python packages: ${missing.join(", ")}...`);
    try {
      execSync(`${pip} install ${missing.join(" ")}`, {
        cwd: projectRoot,
        stdio: "inherit",
      });
      console.log("  ✅ Packages installed successfully.");

      // Patch circuit-synth if it was just installed
      patchCircuitSynth();
    } catch (err) {
      die(`Failed to install Python packages: ${err}`);
    }
  } else {
    console.log("  ✅ All Python dependencies are up to date.");
  }
}

/**
 * Patches circuit-synth's main_generator.py to ensure stable root UUIDs.
 * This prevents KiCad from resetting footprint positions between synthesis runs.
 */
function patchCircuitSynth(): void {
  const { pythonPath: python } = getConfig();
  let generatorPath: string;

  try {
    generatorPath = execSync(
      `${python} -c "import circuit_synth, os; print(os.path.join(os.path.dirname(circuit_synth.__file__), 'kicad', 'sch_gen', 'main_generator.py'))"`,
      { encoding: "utf-8" }
    ).trim().split('\n').pop() || "";
  } catch (err) {
    console.log("⚠️  Could not locate circuit-synth for patching.");
    return;
  }

  if (!generatorPath || !fs.existsSync(generatorPath)) {
    return;
  }

  const content = fs.readFileSync(generatorPath, "utf-8");

  // Check if patch is already applied
  if (content.includes("BUGFIX: Reuse existing root UUID")) {
    console.log("  ✅ circuit-synth is already patched.");
    return;
  }

  console.log("🩹  Patching circuit-synth for UUID stability...");

  const targetCode = `        # 5) NATURAL HIERARCHY: Top circuit goes on root schematic, subcircuits become child sheets
        logger.info(
            "🔧 NATURAL HIERARCHY: Top circuit on root, subcircuits as child sheets"
        )
        root_uuid = str(
            uuid.uuid4()
        )  # UUID for root schematic (project_name.kicad_sch)
        hierarchical_path = [root_uuid]  # Top circuit gets just root level path

        logger.info(f"Root schematic UUID: {root_uuid}")`;

  const replacementCode = `        # 5) NATURAL HIERARCHY: Top circuit goes on root schematic, subcircuits become child sheets
        logger.info(
            "🔧 NATURAL HIERARCHY: Top circuit on root, subcircuits as child sheets"
        )

        # BUGFIX: Reuse existing root UUID from the schematic file if it exists.
        # This prevents hierarchy_path and root_uuid from changing between synthesis
        # runs, which would cause KiCad to treat all footprints as new components
        # and reset their positions in the PCB view.
        existing_sch = self.project_dir / f"{self.project_name}.kicad_sch"
        root_uuid = None
        if existing_sch.exists():
            import re as _re
            try:
                with open(existing_sch, "r", encoding="utf-8") as _f:
                    # Read only the first 1KB — the UUID is near the top of the file
                    header = _f.read(1024)
                match = _re.search(r'\\(uuid\\s+"([0-9a-f-]+)"\\)', header)
                if match:
                    root_uuid = match.group(1)
                    logger.info(f"Reusing existing root UUID from schematic: {root_uuid}")
            except Exception as e:
                logger.warning(f"Failed to read existing schematic UUID: {e}")

        if not root_uuid:
            root_uuid = str(uuid.uuid4())
            logger.info(f"Generated new root UUID: {root_uuid}")

        hierarchical_path = [root_uuid]  # Top circuit gets just root level path

        logger.info(f"Root schematic UUID: {root_uuid}")`;

  if (content.includes(targetCode)) {
    const newContent = content.replace(targetCode, replacementCode);
    fs.writeFileSync(generatorPath, newContent, "utf-8");
    console.log("  ✅ circuit-synth patched successfully.");
  } else {
    console.log("⚠️  Could not find target code in main_generator.py to patch. Maybe the version changed?");
  }
}
