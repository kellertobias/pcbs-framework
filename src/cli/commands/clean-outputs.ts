import path from 'node:path';
import { applyOutputMigration, planOutputMigration } from '../../project/OutputMigration';
import { getConfig } from '../config';

export async function cmdCleanOutputs(args: string[]): Promise<void> {
    if (
        args.some((arg) => arg.startsWith('-') && arg !== '--apply') ||
        args.filter((arg) => !arg.startsWith('-')).length > 1
    )
        throw new Error('Usage: clean-outputs [root] [--apply]. Defaults to a dry run.');
    const root = path.resolve(args.find((arg) => !arg.startsWith('-')) ?? getConfig().projectRoot);
    const moves = planOutputMigration(root);
    for (const move of moves)
        console.log(`${path.relative(root, move.from)} → ${path.relative(root, move.to)}`);
    if (args.includes('--apply')) applyOutputMigration(moves);
    console.log(
        `${args.includes('--apply') ? 'Moved' : 'Would move'} ${moves.length} output entries. Source code and reference assets retained. Update explicit legacy file references using the listed paths.`,
    );
}
