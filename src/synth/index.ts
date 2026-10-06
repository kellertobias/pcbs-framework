/**
 * PCB Design Framework
 *
 * Type-safe TypeScript framework for PCB design.
 */

// Core types
export {
    Pin,
    NetClass,
    NetOptions,
    ComponentCost,
    ComponentOptions,
    ComposableOptions,
    ModuleOptions,
    SchematicOptions,
    PinProxy,
    PinAssignable,
    PinMapFn,
    SymbolName,
    FootprintName,
    SchematicPosition,
    PcbPosition,
    PcbPoint,
    PcbLineEdge,
    PcbArcEdge,
    PcbEdge,
    PcbContour,
    PcbRoutedSlot,
    PcbMountingHole,
    PcbFiducial,
    PcbMechanicalKeepout,
    PcbStackup,
    PcbLengthTarget,
    PcbNetClass,
    PcbCopperZone,
    PcbPadReference,
    PcbRoutePoint,
    PcbRouteHint,
    PcbExactSegment,
    PcbExactArc,
    PcbExactVia,
    PcbExactRoute,
    PcbOptions,
    CircuitSnapshot,
} from '@tobisk/pcbs/types';
export { Registry } from '@tobisk/pcbs/Registry';

// Classes
export { Schematic } from '@tobisk/pcbs/Schematic';
export { Net } from '@tobisk/pcbs/Net';
export { Component } from '@tobisk/pcbs/Component';
export { Composable } from '@tobisk/pcbs/Composable';
export { Module } from '@tobisk/pcbs/Module';
export { DNC, TP } from '@tobisk/pcbs/Markers';
export { group, subschematic } from '@tobisk/pcbs/decorators';
export { KicadFootprint } from '@tobisk/pcbs/KicadFootprint';
export { KicadSymbol } from '@tobisk/pcbs/KicadSymbol';
export { KicadLibrary } from '@tobisk/pcbs/KicadLibrary';
export type {
    FrontPanelCutout,
    FrontPanelLabelAnchor,
    FrontPanelExportResult,
    FrontPanelEdge,
    VerticalFrontPanelInterface,
    VerticalFrontPanelOptions,
    VerticalFrontPanelExportResult,
} from '../frontpanel/types';
export {
    exportFrontPanel,
    exportVerticalFrontPanel,
} from '../frontpanel/FrontPanelExporter';
export {
    HBoxLayout,
    VBoxLayout,
    GravityLayout,
    Layout,
} from '@tobisk/pcbs/Layout';
// export { generatePython } from "@tobisk/pcbs/cli/codegen"; // Removed
export { runSynthesis } from '@tobisk/pcbs/cli/synthesis';
export type {
    PcbMode,
    PcbSyncReport,
    RoutedFootprintMove,
} from '../kicad/PcbSynchronizer';
export { synchronizePcb } from '../kicad/PcbSynchronizer';
export * from '../router';

// 3D model pipeline
export { Kicad3DModel, SolidBuilder } from '@tobisk/pcbs/3d';
export type {
    Model3DLink,
    ExportOptions,
    ExportResult,
    Vec3,
    ColorRGBA,
} from '@tobisk/pcbs/3d';

export { FootprintLayers, canonicalFootprintLayer } from './FootprintLayers';
export type { SemanticFootprintLayer } from './FootprintLayers';

export { RoutedComposable } from './RoutedComposable';
export type { ModuleRoute, ModuleRouting } from './RoutedComposable';
export type { PcbHandoffReference, PcbHandoff } from './types';
export { transformPcbPoint } from './PcbPosition';

export {
    captureRouting,
    loadRoutingFile,
    saveRoutingFile,
} from '../kicad/RoutingFile';
export type { RoutingFile } from '../kicad/RoutingFile';

export type { SchematicRouteHint, SchematicRoutingOptions } from './types';
export * from '../datasheet/FootprintRenderer';
export * from '../datasheet/ModelRenderer';
export * from '../datasheet/Datasheet';

export { componentCostFields, componentUnitCost } from './ComponentCost';

export * from '../datasheet/LibraryDatasheets';

export type {
    FrontPanelInterface,
    FrontPanelDefinition,
    FrontPanelComponentSelection,
    FrontPanels,
    SchematicFrontPanelExportOptions,
    SchematicFrontPanelExportResult,
} from '../frontpanel/types';
export {
    defineFrontPanel,
    exportSchematicFrontPanel,
} from '../frontpanel/SchematicFrontPanel';

export { BoardModule } from './BoardModule';
export type { BoardModuleOptions, BoardModuleInterface } from './BoardModule';
export type { BoardPlacement, BoardReference } from './BoardReference';

export { barrelPolaritySymbol } from '../frontpanel/FrontPanelArtwork';
export type {
    FrontPanelDrawing,
    FrontPanelDrawingGroup,
    FrontPanelDrawingAnchor,
    FrontPanelLayer,
    FrontPanelPoint,
} from '../frontpanel/types';

export type { FrontPanelTextStyle } from '../frontpanel/types';

export { defineRenderSeries } from './RenderSeries';
export type {
    RenderSeries,
    BoardRender,
    LayerRender,
    AssemblyRender,
    ModelRender,
    RenderSide,
    RenderVector,
} from './RenderSeries';

export { Assembly } from './Assembly';
export type {
    AssemblyOptions,
    AssemblyFrontPanel,
    AssemblyGroup,
    AssemblyView,
    AssemblyPlacements,
    AssemblyPart,
    AssemblyBoard,
    AssemblyFileModel,
    AssemblyGeneratedModel,
    AssemblyPlacement,
    AssemblyVector,
} from './Assembly';

export { bentSheetMesh, bentSheetProfile } from './3d/bentSheet';
export type { BentSheetOptions } from './3d/bentSheet';

// Reusable circuit, geometry and fabrication helpers.
export { foldedChannel } from './3d/FoldedSheetMetal';
export { routedSlotContour } from './RoutedSlot';
export { resistor, capacitor, offsetPosition } from './CircuitParts';
export { parseResistorValue, parseResistorValueBetter, getClosestResistor } from './ResistorValues';
export * from '../kicad/FootprintGeometry';

export { ReviewPlacement } from './ReviewPlacement';

export { roundedContour, capsulePoints, profileSolid } from './3d/Profiles';
export type { ProfilePoint, ProfileMap } from './3d/Profiles';

export { PcbProject, findPcbProject, discoverPcbProjects } from '../project/PcbProject';
export type { PcbProjectDefinition, ProjectEntryKind } from '../project/PcbProject';
export { PcbPanel } from './PcbPanel';
export type { PcbPanelOptions, PanelBoardPlacement } from './PcbPanel';

export { relocateBoardModels } from '../project/RelocateBoardModels';
export type { AssetDirectoryMove } from '../project/RelocateBoardModels';

export { outputPaths, generatedFile, resolveGeneratedInput } from '../project/OutputPaths';

export { placePcbComponents } from './PcbPlacement';
export { packPcbComponents, type PcbPackingOptions } from './PcbPacking';
export type { SchematicGroup } from './types';
export { planOutputMigration, applyOutputMigration } from '../project/OutputMigration';

export { defineNetClass } from './NetClasses';
export type { NetClassDefinition } from './types';
export { joinPcbOutlines } from './PcbOutlineUnion';

export { schematicGroup } from './SchematicGroup';
export type { SchematicGroupOptions } from './SchematicGroup';
export type { SchematicNote } from './types';
