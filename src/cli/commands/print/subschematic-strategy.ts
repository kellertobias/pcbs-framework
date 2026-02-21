import { Composable } from "../../../synth/Composable";

/**
 * Groups composables into subschematic pages based on their configuration.
 *
 * Composables are only grouped into subschematic pages if they are explicitly marked
 * via `makeSubschematic()`.
 */
export function getSubschematicGroups(composables: Composable<any>[]): Map<string, Composable<any>[]> {
  const groups = new Map<string, Composable<any>[]>();

  for (const c of composables) {
    // Only use the explicitly set subschematic name.
    // This is set by makeSubschematic(). If not set, it won't be rendered as a subcircuit.
    const name = c._subschematicName;

    if (name) {
      if (!groups.has(name)) {
        groups.set(name, []);
      }
      groups.get(name)!.push(c);
    }
  }
  return groups;
}
