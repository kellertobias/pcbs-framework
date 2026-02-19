import * as path from "path";
import * as fs from "fs";

export interface Config {
    projectRoot: string;
    sourceRoot: string;
    schematicsDir: string;
    scriptsDir: string;
    pythonPath: string;
    kicadCliPath: string;
}

let configCache: Config | null = null;

export function getConfig(): Config {
    if (configCache) return configCache;

    const cwd = process.env.INIT_CWD || process.cwd();
    let sourceRoot = cwd;

    // 1. Env var
    if (process.env.SCHEMATICS_ROOT) {
        sourceRoot = path.resolve(cwd, process.env.SCHEMATICS_ROOT);
    }
    // 2. Default: check if src exists in cwd
    else if (fs.existsSync(path.join(cwd, "src"))) {
        sourceRoot = path.join(cwd, "src");
    }
    // 3. Fallback: cwd is sourceRoot

    // Determine project root (if sourceRoot ends with src, projectRoot is parent)
    let projectRoot = sourceRoot;
    if (path.basename(sourceRoot) === "src") {
        projectRoot = path.dirname(sourceRoot);
    }

    // Schematics dir: look for "schematics" in sourceRoot
    const schematicsDir = path.join(sourceRoot, "schematics");

    // Scripts dir: stored in the library package
    const scriptsDir = path.resolve(__dirname, "../../scripts");

    // Python path: look in projectRoot/.venv
    let pythonPath = path.join(projectRoot, ".venv", "bin", "python");
    if (!fs.existsSync(pythonPath)) {
        // If not found, try system python
        pythonPath = "python3";
    }

    const kicadCliPath = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli";

    configCache = {
        projectRoot,
        sourceRoot,
        schematicsDir,
        scriptsDir,
        pythonPath,
        kicadCliPath,
    };

    return configCache;
}
