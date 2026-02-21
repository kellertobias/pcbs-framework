/**
 * PCB Design Framework
 * 
 * Type-safe TypeScript framework for PCB design with circuit-synth.
 */

// Core types
export { Pin, NetClass, NetOptions, ComponentOptions, ComposableOptions, ModuleOptions, SchematicOptions, PinProxy, PinAssignable, PinMapFn, SymbolName, FootprintName, SchematicPosition, PcbPosition } from "@tobisk/pcbs/types";
export { Registry } from "@tobisk/pcbs/Registry";

// Classes
export { Schematic } from "@tobisk/pcbs/Schematic";
export { Net } from "@tobisk/pcbs/Net";
export { Component } from "@tobisk/pcbs/Component";
export { Composable } from "@tobisk/pcbs/Composable";
export { Module } from "@tobisk/pcbs/Module";
export { DNC, TP } from "@tobisk/pcbs/Markers";
export { group, subschematic } from "@tobisk/pcbs/decorators";
export { KicadFootprint } from "@tobisk/pcbs/KicadFootprint";
export { KicadSymbol } from "@tobisk/pcbs/KicadSymbol";
export { KicadLibrary } from "@tobisk/pcbs/KicadLibrary";
export { HBoxLayout, VBoxLayout, GravityLayout, Layout } from "@tobisk/pcbs/Layout";
export { generatePython, CircuitSnapshot } from "@tobisk/pcbs/cli/codegen";
export { runSynthesis } from "@tobisk/pcbs/cli/synthesis";

// 3D model pipeline
export { Kicad3DModel, SolidBuilder } from "@tobisk/pcbs/3d";
export type { Model3DLink, ExportOptions, ExportResult, Vec3, ColorRGBA } from "@tobisk/pcbs/3d";

