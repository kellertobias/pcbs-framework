/** Paths are relative to the file declaring the series. Outputs default to NAME.png/NAME.wrl. */
export type RenderSide = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';
export type RenderVector = readonly [number, number, number];
interface RenderBase {
    name: string;
    board?: string;
    output?: string;
}
export interface LayerRender extends RenderBase {
    kind: 'layers';
    layers?: readonly string[];
    side?: 'top' | 'bottom';
    mirror?: boolean;
    width?: number;
}
export interface AssemblyRender extends RenderBase {
    kind: '3d';
    side?: RenderSide;
    rotate?: RenderVector;
    zoom?: number;
    pan?: RenderVector;
    /** KiCad pivot is relative to the board center, in centimeters. */
    pivot?: RenderVector;
    width?: number;
    height?: number;
}
export interface ModelRender extends RenderBase {
    kind: 'model';
    origin?: readonly [number, number];
}
export type BoardRender = LayerRender | AssemblyRender | ModelRender;
export interface RenderSeries {
    board?: string;
    outputDirectory?: string;
    /** Executed in declaration order, so model exports can precede views that use them. */
    renders: readonly BoardRender[];
}
export function defineRenderSeries(series: RenderSeries): RenderSeries {
    return series;
}
