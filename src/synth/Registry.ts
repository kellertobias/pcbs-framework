/**
 * Circuit Registry
 *
 * Tracks all components and nets created during schematic generation.
 */

import type { Component } from "@tobisk-pcb/framework/Component";
import type { Net } from "@tobisk-pcb/framework/Net";

export class Registry {
    private components: Component<any>[] = [];
    private composables: any[] = [];
    private nets: Net[] = [];
    private items: any[] = [];
    private active = false;

    /** Start tracking. Clear any previous state. */
    start() {
        this.components = [];
        this.composables = [];
        this.nets = [];
        this.items = [];
        this.active = true;
    }

    /** Stop tracking. */
    stop() {
        this.active = false;
    }

    /** Register a component. */
    registerComponent(comp: Component<any>) {
        if (this.active) {
            this.components.push(comp);
            this.items.push(comp);
        }
    }

    /** Register a composable. */
    registerComposable(composable: any) {
        if (this.active) {
            this.composables.push(composable);
            this.items.push(composable);
        }
    }

    /** Register a net. */
    registerNet(net: Net) {
        if (this.active) {
            this.nets.push(net);
        }
    }

    /** Unregister a net (e.g. during merging). */
    unregisterNet(net: Net) {
        if (this.active) {
            this.nets = this.nets.filter(n => n !== net);
        }
    }

    /** Get all registered components. */
    getComponents() {
        return this.components;
    }

    /** Get all registered composables. */
    getComposables() {
        return this.composables;
    }

    /** Get all registered items in order. */
    getItems() {
        return this.items;
    }

    /** Get all registered nets. */
    getNets() {
        return this.nets;
    }
}

/** Global registry instance. */
export const registry = new Registry();
