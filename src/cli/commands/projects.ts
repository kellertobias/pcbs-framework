import path from 'node:path';
import { discoverPcbProjects } from '../../project/PcbProject';
import { getConfig } from '../config';
export function cmdProjects(args: string[]): void {
    const projects = discoverPcbProjects(getConfig().schematicsDir);
    for (const project of projects.filter(
        (project) => !args[0] || args[0] === path.basename(project.directory),
    )) {
        const key = path.basename(project.directory);
        console.log(`${project.name}: ${project.directory}`);
        for (const kind of ['schematics', 'panels', 'assemblies'] as const)
            for (const name of Object.keys(project.definition[kind] ?? {}))
                console.log(`  ${kind}: ${key}/${name}`);
    }
    if (args[0] && !projects.some((project) => path.basename(project.directory) === args[0]))
        throw new Error(`PCB project not found: ${args[0]}`);
}
