/**
 * PCB Design Framework
 * 
 * Type-safe TypeScript framework for PCB design with circuit-synth.
 */

// Core types
export { Pin, NetClass, NetOptions, ComponentOptions, ComposableOptions, ModuleOptions, SchematicOptions, PinProxy, PinAssignable, PinMapFn, SymbolName, FootprintName, SchematicPosition, PcbPosition } from "@tobisk-pcb/framework/types";
export { Registry } from "@tobisk-pcb/framework/Registry";

// Classes
export { Schematic } from "@tobisk-pcb/framework/Schematic";
export { Net } from "@tobisk-pcb/framework/Net";
export { Component } from "@tobisk-pcb/framework/Component";
export { Composable } from "@tobisk-pcb/framework/Composable";
export { Module } from "@tobisk-pcb/framework/Module";
export { DNC, TP } from "@tobisk-pcb/framework/Markers";
export { KicadFootprint } from "@tobisk-pcb/framework/KicadFootprint";
export { KicadSymbol } from "@tobisk-pcb/framework/KicadSymbol";
export { KicadLibrary } from "@tobisk-pcb/framework/KicadLibrary";
export { HBoxLayout, VBoxLayout, Layout } from "@tobisk-pcb/framework/Layout";
export { generatePython, CircuitSnapshot } from "@tobisk-pcb/cli/codegen";
export { runSynthesis } from "@tobisk-pcb/cli/synthesis";

// 3D model pipeline
export { Kicad3DModel, SolidBuilder } from "@tobisk-pcb/framework/3d";
export type { Model3DLink, ExportOptions, ExportResult, Vec3, ColorRGBA } from "@tobisk-pcb/framework/3d";

