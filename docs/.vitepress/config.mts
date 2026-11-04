import { defineConfig } from 'vitepress';
import examples from '../examples/catalog.json';

export const sidebar = [
    {
        text: 'Start here',
        items: [
            { text: 'Overview', link: '/Home' },
            { text: 'Quick start', link: '/QuickStart' },
            { text: 'Code and generated results', link: '/Examples' },
            { text: 'CLI reference', link: '/CLI' },
            { text: 'Source files and outputs', link: '/OutputWorkflow' },
        ],
    },
    {
        text: 'Circuits and schematics',
        items: [
            { text: 'Schematic', link: '/Schematic' },
            { text: 'Component', link: '/Component' },
            { text: 'Net', link: '/Net' },
            { text: 'Composable circuits', link: '/Composable' },
            { text: 'Decorators', link: '/Decorators' },
            { text: 'Automatic schematic layout', link: '/AutomaticSchematicLayout' },
            { text: 'Schematic readability', link: '/SchematicReadability' },
        ],
    },
    {
        text: 'Boards and fabrication',
        items: [
            { text: 'PCB placement and routing', link: '/PCB' },
            { text: 'Autorouting', link: '/Autorouting' },
            { text: 'Board composition', link: '/BoardComposition' },
            { text: 'Projects and panels', link: '/ProjectsAndPanels' },
            { text: 'Front panels', link: '/FrontPanel' },
            { text: 'Rendering', link: '/Rendering' },
            { text: 'Physical assemblies', link: '/Assembly' },
        ],
    },
    {
        text: 'Component libraries',
        items: [
            { text: 'Module', link: '/Module' },
            { text: 'Symbols', link: '/KicadSymbol' },
            { text: 'Footprints', link: '/KicadFootprint' },
            { text: '3D models', link: '/Kicad3DModel' },
            { text: 'Datasheets', link: '/Datasheets' },
            { text: 'Component cost', link: '/ComponentCost' },
        ],
    },
    {
        text: 'Contributing',
        items: [
            { text: 'Framework and project boundary', link: '/ProjectBoundary' },
            { text: 'Documentation site', link: '/Documentation' },
        ],
    },
];

export default defineConfig({
    title: '@tobisk/pcbs',
    description:
        'Design circuits in TypeScript. Generate native KiCad schematics, PCBs, libraries and mechanical exports.',
    base: '/pcbs-framework/',
    srcExclude: ['_Sidebar.md'],
    lastUpdated: false,
    transformPageData(page) {
        const visualPages = ['Home', 'index', ...examples.flatMap((example) => example.guides)];
        if (visualPages.some((name) => page.relativePath === `${name}.md`)) {
            page.frontmatter.aside = false;
        }
        if (['Home.md', 'index.md'].includes(page.relativePath)) {
            page.frontmatter.pageClass = 'visual-home';
        }
    },
    sitemap: { hostname: 'https://kellertobias.github.io/pcbs-framework/' },
    themeConfig: {
        nav: [
            { text: 'Guide', link: '/QuickStart' },
            { text: 'CLI', link: '/CLI' },
            { text: 'GitHub', link: 'https://github.com/kellertobias/pcbs-framework' },
        ],
        sidebar,
        search: { provider: 'local' },
        outline: { level: [2, 3] },
        editLink: {
            pattern: 'https://github.com/kellertobias/pcbs-framework/edit/main/docs/:path',
        },
        footer: { message: 'Released under the MIT License.' },
    },
});
