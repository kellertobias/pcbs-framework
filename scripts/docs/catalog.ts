import fs from 'node:fs';
import path from 'node:path';
import examples from '../../docs/examples/catalog.json';

const root = path.resolve(__dirname, '../..');
const start = '<!-- generated-examples:start -->';
const end = '<!-- generated-examples:end -->';

function pair(example: (typeof examples)[number], level: number) {
    const source = `./examples/${example.source}${example.region ? `#${example.region}` : ''}`;
    const images = example.images
        .map((image) => {
            const asset = `./public/examples/${image.file}`;
            return `[![${image.alt}](${asset})](/examples/${image.file})\n\n<figcaption>${image.caption}</figcaption>`;
        })
        .join('\n\n');
    const anchors: Record<string, string> = {
        circuit: 'circuit-to-schematic',
        copper: 'placement-to-copper',
        board3d: 'saved-board-to-3d-view',
        smd: 'code-to-footprint',
        model: 'code-to-mechanical-model',
    };
    const anchor =
        level === 2 && anchors[example.id] ? `<span id="${anchors[example.id]}"></span>\n\n` : '';
    return `${anchor}${'#'.repeat(level)} ${example.title}\n\n<div class="example-pair" data-example="${example.id}"><div>\n\n<<< ${source}\n\n</div><figure>\n\n${images}\n\n</figure></div>`;
}

/** Keep every teaching example's source and result together on each documentation surface. */
export function syncExampleDocumentation(check: boolean) {
    const home = [
        'board3d',
        'circuit',
        'groups',
        'copper',
        'front-panel',
        'smd',
        'model',
        'assembly',
        'datasheet',
    ];
    const pages = new Map<string, typeof examples>();
    pages.set('Examples', examples);
    pages.set(
        'Home',
        examples
            .filter((example) => home.includes(example.id))
            .sort((a, b) => home.indexOf(a.id) - home.indexOf(b.id)),
    );
    for (const example of examples)
        for (const guide of example.guides) {
            const selected = pages.get(guide) ?? [];
            selected.push(example);
            pages.set(guide, selected);
        }
    for (const [page, selected] of pages) {
        const file = path.join(root, 'docs', `${page}.md`);
        const before = fs.readFileSync(file, 'utf8');
        if (!before.includes(start) || !before.includes(end))
            throw new Error(`${page}: missing visual example section`);
        const body = selected
            .map((example) => pair(example, page === 'Examples' || page === 'Home' ? 2 : 3))
            .join('\n\n');
        const after =
            before.slice(0, before.indexOf(start)) +
            start +
            '\n\n' +
            body +
            '\n\n' +
            before.slice(before.indexOf(end));
        if (check && before !== after)
            throw new Error(`${page}: code/image pairs drifted. Run npm run docs:examples.`);
        if (!check && before !== after) fs.writeFileSync(file, after);
    }
    for (const example of examples) {
        const source = fs.readFileSync(path.join(root, 'docs/examples', example.source), 'utf8');
        if (
            example.region &&
            (!source.includes(`#region ${example.region}`) ||
                !source.includes(`#endregion ${example.region}`))
        )
            throw new Error(`Missing source region: ${example.id}`);
        if (!example.images.length) throw new Error(`Missing result image: ${example.id}`);
        for (const image of example.images)
            if (!fs.existsSync(path.join(root, 'docs/public/examples', image.file)))
                throw new Error(`Missing image: ${example.id}/${image.file}`);
    }
    return {
        examples: examples.length,
        guides: pages.size - 2,
        images: new Set(examples.flatMap((example) => example.images.map((image) => image.file)))
            .size,
    };
}
