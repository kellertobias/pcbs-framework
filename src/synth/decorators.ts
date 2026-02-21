import { Component } from "./Component";
import { Composable } from "./Composable";

/**
 * Marks a method such that all Components or Composables instantiated within it
 * are assigned to the specified group layout group.
 * 
 * @param options Object containing the name of the group
 */
export function group(options: { name: string }) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;

        descriptor.value = function (...args: any[]) {
            const prevGroup = Component.activeGroup;
            Component.activeGroup = options.name;

            try {
                return originalMethod.apply(this, args);
            } finally {
                Component.activeGroup = prevGroup;
            }
        };

        return descriptor;
    };
}

/**
 * Marks a method such that all Components or Composables instantiated within it
 * are assigned to the specified subschematic.
 * 
 * @param options Object containing the name of the subschematic
 */
export function subschematic(options: { name: string }) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;

        descriptor.value = function (...args: any[]) {
            const prevSubschematic = Component.activeSubschematic;
            Component.activeSubschematic = options.name;

            try {
                return originalMethod.apply(this, args);
            } finally {
                Component.activeSubschematic = prevSubschematic;
            }
        };

        return descriptor;
    };
}
