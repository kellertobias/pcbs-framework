export type FrontPanelCutout =
    | { type: 'circle'; x?: number; y?: number; diameter: number }
    | {
          type: 'roundedRect';
          x?: number;
          y?: number;
          width: number;
          height: number;
          radius?: number;
          rotation?: number;
      }
    | {
          type: 'polygon';
          points: Array<{ x: number; y: number }>;
          rotation?: number;
      };

export interface FrontPanelTextStyle {
    bold?: boolean;
}

export interface FrontPanelLabelAnchor extends FrontPanelTextStyle {
    x: number;
    y: number;
    rotation?: number;
    fontSize?: number;
}

export interface FrontPanelExportResult {
    pcbFile: string;
    dxfFile: string;
    svgFile: string;
    outlineSegments: number;
    cutouts: number;
    labels: number;
}

export type FrontPanelEdge = 'top' | 'right' | 'bottom' | 'left';

/** A connector face perpendicular to the PCB, in footprint-local millimetres. */
export interface VerticalFrontPanelInterface {
    /** Face centre: x/y in the footprint plane; z above the PCB top surface. */
    anchor: { x: number; y: number; z: number };
    /** Outward-facing direction before the footprint's KiCad rotation. */
    facing: FrontPanelEdge;
    /** Face coordinates: x along the face, y upward, relative to anchor. */
    cutouts: FrontPanelCutout[];
    labelAnchor?: FrontPanelLabelAnchor;
    /** Named positions in the same face X/height coordinates as cutouts. */
    labelAnchors?: {
        above?: FrontPanelLabelAnchor;
        below?: FrontPanelLabelAnchor;
    };
}

export type FrontPanelInterface = VerticalFrontPanelInterface;

export interface FrontPanelComponentSelection {
    component: import('../synth/Component').Component<any>;
    name?: string;
    namePlacement?: 'above' | 'below';
    nameStyle?: FrontPanelTextStyle;
}

export interface FrontPanelDefinition {
    /** Common name centre height above the PCB top surface; keeps each interface X anchor. */
    nameHeight?: number;
    /** Defaults for all panel text, including annotations and drawing text. */
    textStyle?: FrontPanelTextStyle;
    edge: FrontPanelEdge;
    components: readonly FrontPanelComponentSelection[];
    /** Left/right extend beyond the board span; top/bottom extend above/below its top surface. */
    extends: { left: number; right: number; top: number; bottom: number };
    /** Additional vector artwork in panel X/height coordinates. */
    drawings?: readonly FrontPanelDrawing[];
}

export type FrontPanelLayer = 'OUTLINE' | 'ENGRAVING' | 'CUTOUT' | 'ANNOTATIONS';
export type FrontPanelPoint = { x: number; y: number };
export interface FrontPanelDrawingAnchor {
    component: import('../synth/Component').Component<any>;
    placement?: 'interface' | 'above' | 'below';
    /** Offset in panel X/height coordinates; artwork is not mirrored with the connector. */
    offset?: FrontPanelPoint;
}
export interface FrontPanelDrawingStyle {
    layer?: FrontPanelLayer;
    strokeWidth?: number;
}
export interface FrontPanelDrawingGroup extends FrontPanelDrawingStyle {
    type: 'group';
    at?: FrontPanelPoint;
    anchor?: FrontPanelDrawingAnchor;
    rotation?: number;
    scale?: number;
    drawings: readonly FrontPanelDrawing[];
}
export type FrontPanelDrawing = FrontPanelDrawingStyle &
    (
        | { type: 'line'; start: FrontPanelPoint; end: FrontPanelPoint }
        | { type: 'circle'; center: FrontPanelPoint; radius: number }
        | {
              type: 'arc';
              center: FrontPanelPoint;
              radius: number;
              startAngle: number;
              endAngle: number;
          }
        | { type: 'polyline'; points: readonly FrontPanelPoint[]; closed?: boolean }
        | {
              type: 'text';
              at: FrontPanelPoint;
              text: string;
              fontSize: number;
              bold?: boolean;
              rotation?: number;
          }
        | {
              type: 'svg';
              file: string;
              at: FrontPanelPoint;
              width: number;
              height?: number;
              rotation?: number;
              tolerance?: number;
          }
        | FrontPanelDrawingGroup
    );

export type FrontPanels<
    T extends import('../synth/Schematic').Schematic = import('../synth/Schematic').Schematic,
> = Record<string, (schematic: T) => FrontPanelDefinition>;

export interface SchematicFrontPanelExportOptions {
    pcbFile: string;
    outputDir?: string;
}

export interface SchematicFrontPanelExportResult extends VerticalFrontPanelExportResult {
    name: string;
    annotations: number;
    drawings: number;
}

export interface VerticalFrontPanelOptions {
    edge: FrontPanelEdge;
    /** Explicit KiCad references; unselected components are never exported. */
    components: readonly string[];
    /** Plate height; width is the selected PCB edge's bounding-box span. */
    height: number;
    /** Plate bottom height relative to the PCB top surface. Default: 0. */
    bottomZ?: number;
    outputDir?: string;
}

export interface VerticalFrontPanelExportResult extends FrontPanelExportResult {
    edge: FrontPanelEdge;
    components: string[];
}
