import { describe, it, expect, afterAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

describe("Schematic Renderer (PDF)", () => {
    const SCHEMATIC_DIR = path.resolve(__dirname, "../schematics/renderer_test");
    const PDF_PATH = path.join(SCHEMATIC_DIR, "renderer_test.pdf");
    const CLI_PATH = path.resolve(__dirname, "../cli/cli.ts");

    afterAll(() => {
        // Clean up PDF after test (optional, keeping it might be useful for inspection)
        if (fs.existsSync(PDF_PATH)) {
            fs.unlinkSync(PDF_PATH);
        }
    });

    it("should generate a PDF schematic using the print command", () => {
        // Ensure schematic exists
        expect(fs.existsSync(path.join(SCHEMATIC_DIR, "index.ts"))).toBe(true);

        // Run the print command
        // We use --root to point to our source root so it finds the schematics folder correctly
        // Assuming project root is cwd
        const cmd = `npx ts-node ${CLI_PATH} print renderer_test --root src`;

        try {
            execSync(cmd, { stdio: "pipe" });
        } catch (error: any) {
            console.error("Print command failed:", error.stdout?.toString(), error.stderr?.toString());
            throw error;
        }

        // Check if PDF exists
        expect(fs.existsSync(PDF_PATH)).toBe(true);

        // Check if PDF has content (non-zero size)
        const stats = fs.statSync(PDF_PATH);
        expect(stats.size).toBeGreaterThan(1000); // Basic check that it's not empty

        console.log(`Generated PDF size: ${stats.size} bytes`);
    }, 30000); // Increase timeout for rendering
});
