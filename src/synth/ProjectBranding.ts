import fs from 'node:fs';
import path from 'node:path';
import type { SchematicBranding } from './types';

/** Nearest project configuration wins; relative logo paths belong to that file.
 * Read on capture/construction rather than caching so live regeneration sees edits.
 */
export function loadProjectBranding(start = process.cwd()): SchematicBranding {
    let directory = path.resolve(start);
    while (true) {
        const file = path.join(directory, 'pcb.config.json');
        if (fs.existsSync(file)) {
            const configuration = JSON.parse(fs.readFileSync(file, 'utf8'));
            const branding = configuration.branding ?? {};
            if (branding.company !== undefined && typeof branding.company !== 'string')
                throw new Error(`${file}: branding.company must be a string.`);
            if (branding.logo !== undefined && typeof branding.logo !== 'string')
                throw new Error(`${file}: branding.logo must be a PNG or SVG path.`);
            return {
                company: branding.company,
                logo: branding.logo ? path.resolve(directory, branding.logo) : undefined,
            };
        }
        const parent = path.dirname(directory);
        if (parent === directory) return {};
        directory = parent;
    }
}
