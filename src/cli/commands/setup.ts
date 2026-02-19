import * as fs from "fs";
import * as path from "path";
import { getConfig } from "../config";

/**
 * Commands to automate configuration of the project's environment.
 */
export async function cmdSetup(args: string[]): Promise<void> {
    console.log("🚀  Setting up project environment...\n");

    const { projectRoot } = getConfig();
    const tsconfigPath = path.join(projectRoot, "tsconfig.json");

    if (!fs.existsSync(tsconfigPath)) {
        console.warn("⚠️  Could not find tsconfig.json in project root. Skipping path mapping setup.");
        return;
    }

    try {
        const tsconfigRaw = fs.readFileSync(tsconfigPath, "utf-8");
        const tsconfig = JSON.parse(tsconfigRaw);

        // Don't update tsconfig if we are in the framework repo itself
        const packageJsonPath = path.join(projectRoot, "package.json");
        if (fs.existsSync(packageJsonPath)) {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
            if (pkg.name === "@tobisk/pcbs") {
                console.log("  ℹ️  Framework repository detected. Skipping tsconfig.json path mapping setup.");
                return;
            }
        }

        if (!tsconfig.compilerOptions) {
            tsconfig.compilerOptions = {};
        }

        if (!tsconfig.compilerOptions.paths) {
            tsconfig.compilerOptions.paths = {};
        }

        const virtualPath = "@tobisk/pcbs/kicad-types";
        const localPath = ["./src/kicad-library.ts"];

        // Check if mapping already exists and is correct
        const currentMapping = tsconfig.compilerOptions.paths[virtualPath];
        if (JSON.stringify(currentMapping) === JSON.stringify(localPath)) {
            console.log("  ✅ tsconfig.json path mapping is already correct.");
        } else {
            tsconfig.compilerOptions.paths[virtualPath] = localPath;
            fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf-8");
            console.log(`  ✅ Added path mapping to tsconfig.json: ${virtualPath} → ${localPath}`);
        }

    } catch (err: any) {
        console.warn(`  ⚠️  Failed to update tsconfig.json: ${err.message}`);
    }
}
