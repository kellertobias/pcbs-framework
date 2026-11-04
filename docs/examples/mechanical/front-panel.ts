import { defineFrontPanel, type FrontPanels } from '@tobisk/pcbs';
import type { PanelFixture } from './PanelFixture';

export const frontPanels: FrontPanels<PanelFixture> = {
    indicator: (schematic) =>
        defineFrontPanel({
            edge: 'bottom',
            extends: { left: 3, right: 3, top: 25, bottom: 5 },
            textStyle: { bold: true },
            components: [
                {
                    component: schematic.getComponent('MP1'),
                    name: 'INDICATOR',
                    namePlacement: 'above',
                },
            ],
        }),
};
