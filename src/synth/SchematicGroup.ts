import type { SchematicGroup as GroupDefinition } from './types';

/** A method's newly created components are captured automatically; nodes add existing drawing units. */
export interface SchematicGroupOptions extends Omit<GroupDefinition, 'components'> {
    nodes?: string[];
}

/** Co-locate functional schematic boxes and notes with their circuit construction. */
export function schematicGroup(options: SchematicGroupOptions): MethodDecorator {
    if (!options.id?.trim() || !options.title?.trim())
        throw new Error('schematicGroup requires a non-empty id and title');
    return (_target, _key, descriptor: PropertyDescriptor) => {
        const original = descriptor.value;
        if (typeof original !== 'function')
            throw new Error('schematicGroup decorates methods only');
        descriptor.value = function (
            this: {
                _captureSchematicGroup?: (
                    options: SchematicGroupOptions,
                    build: () => unknown,
                ) => unknown;
            },
            ...args: unknown[]
        ) {
            if (typeof this._captureSchematicGroup !== 'function')
                throw new Error('schematicGroup methods must belong to a Schematic');
            return this._captureSchematicGroup(options, () => original.apply(this, args));
        };
    };
}
