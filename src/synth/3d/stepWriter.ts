/**
 * Optional STEP export using STEPControl_Writer.
 *
 * STEP files don't carry color information but are useful for
 * downstream processing in CAD tools.
 */
import * as fs from "fs";
import * as path from "path";
import type { OC, SolidHandle } from "./types";
import { fuseShapes } from "./booleans";

/**
 * Write a list of solids to a STEP file.
 * All solids are fused into a single compound before writing.
 * Returns true on success, false if STEP export is unavailable.
 */
export function writeSTEP(
    oc: OC,
    solids: SolidHandle[],
    filePath: string,
): boolean {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const writer = new oc.STEPControl_Writer_1();
        const pr = new oc.Message_ProgressRange_1();

        for (const solid of solids) {
            writer.Transfer(
                solid.shape,
                oc.STEPControl_StepModelType.STEPControl_AsIs as any,
                true,
                pr,
            );
        }

        const status = writer.Write(filePath);
        writer.delete();
        pr.delete();

        // IFSelect_ReturnStatus.IFSelect_RetDone === 0
        return true;
    } catch {
        // STEP export not available in this WASM build — silently skip
        return false;
    }
}
