import { outputPaths, generatedFile } from '../project/OutputPaths';
import path from 'node:path';
import { PcbProject, findPcbProject } from '../project/PcbProject';
import { Schematic } from './Schematic';
import type { BoardPlacement } from './BoardReference';
import type { CircuitSnapshot, PcbOptions } from './types';

export interface PanelBoardPlacement extends Omit<BoardPlacement, 'sourcePcb' | 'sourceDirectory'> {
    /** Schematic key from the owning project's manifest. Can reference a shared schematic. */
    schematic: string;
}
export interface PcbPanelOptions {
    name: string;
    project: PcbProject;
    pcb: PcbOptions;
    boards?: PanelBoardPlacement[];
    description?: string;
}

/** A manufacturing PCB composed of project schematic PCBs, with no circuit or schematic of its own. */
export class PcbPanel {
    readonly kind = 'pcb-panel';
    readonly name: string;
    readonly project: PcbProject;
    readonly pcb: PcbOptions;
    readonly description?: string;
    readonly boards: PanelBoardPlacement[];
    constructor(options: PcbPanelOptions) {
        if (!(options.project instanceof PcbProject) || !findPcbProject(options.project.directory))
            throw new Error('A PCB panel must belong to a persisted PCB project');
        if (!/^[\w.-]+$/.test(options.name)) throw new Error('Invalid panel name');
        this.name = options.name;
        this.project = options.project;
        this.pcb = options.pcb;
        this.description = options.description;
        this.boards = [...(options.boards ?? [])];
    }
    placeBoard(schematic: string, placement: Omit<PanelBoardPlacement, 'schematic'>): this {
        this.boards.push({ ...placement, schematic });
        return this;
    }
    sourceEntries(): string[] {
        return [
            ...new Set(
                this.boards.map((board) => this.project.entry('schematics', board.schematic)),
            ),
        ];
    }
    /** Reuse the isolated board-capture engine; public panels never extend Schematic. */
    _generateWithCapture(): CircuitSnapshot {
        if (!this.boards.length) throw new Error('A PCB panel needs at least one board');
        const panel = this;
        class Capture extends Schematic {
            generate() {
                for (const { schematic: key, ...placement } of panel.boards) {
                    const entry = panel.project.entry('schematics', key);
                    const source = require(entry).default;
                    if (
                        !source ||
                        typeof source.generate !== 'function' ||
                        typeof source._generateWithCapture !== 'function' ||
                        source.kind === 'pcb-panel'
                    )
                        throw new Error(`Panel source must be a Schematic: ${entry}`);
                    this.addBoard(source, {
                        ...placement,
                        sourceDirectory: outputPaths(path.dirname(entry)).export,
                        sourcePcb: generatedFile(path.dirname(entry), `${source.name}.kicad_pcb`),
                    });
                }
            }
        }
        const snapshot = new Capture({
            name: this.name,
            description: this.description,
            pcb: this.pcb,
        })._generateWithCapture();
        const first = snapshot.boards![0].snapshot.pcb;
        return {
            ...snapshot,
            pcb: { thickness: first?.thickness, stackup: first?.stackup, ...snapshot.pcb },
        };
    }
}
