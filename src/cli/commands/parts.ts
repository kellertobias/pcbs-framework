import * as path from "path";
import * as readline from "readline";
import { execSync } from "child_process";
import { getConfig } from "../config";
import { die } from "../utils";

/**
 * parts: Search JLC Parts for components
 */
export async function cmdParts(args: string[]): Promise<void> {
  const { projectRoot, pythonPath, scriptsDir } = getConfig();
  let footprint: string | undefined;
  let value: string | undefined;

  // Parse --footprint and --value flags
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--footprint" && args[i + 1]) {
      footprint = args[++i];
    } else if (args[i] === "--value" && args[i + 1]) {
      value = args[++i];
    }
  }

  if (footprint || value) {
    // Direct search mode
    console.log(`\n🔍  Searching JLC Parts...`);
    if (footprint) console.log(`    Footprint: ${footprint}`);
    if (value) console.log(`    Value: ${value}`);
    console.log();

    // Delegate to existing search script
    const searchArgs = [footprint, value].filter(Boolean).join(" ");
    try {
      execSync(`${pythonPath} ${path.join(scriptsDir, "search_lib.py")} --jlc "${searchArgs}"`, {
        cwd: projectRoot,
        stdio: "inherit",
      });
    } catch {
      die("Parts search failed.");
    }
  } else {
    // Interactive TUI mode
    console.log("\n🔍  JLC Parts Search (Interactive)\n" + "─".repeat(40));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const askAndSearch = async (): Promise<void> => {
      return new Promise((resolve) => {
        rl.question("Search query (or 'q' to quit): ", async (query) => {
          if (query.trim().toLowerCase() === "q") {
            rl.close();
            resolve();
            return;
          }

          try {
            execSync(
              `${pythonPath} ${path.join(scriptsDir, "search_lib.py")} --jlc "${query.trim()}"`,
              { cwd: projectRoot, stdio: "inherit" }
            );
          } catch {
            console.log("  (search returned no results or errored)");
          }

          console.log();
          resolve(askAndSearch());
        });
      });
    };

    await askAndSearch();
  }
}
