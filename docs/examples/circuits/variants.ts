import divider from './Divider';
import grouped from './GroupedIndicator';

// #region labels
export function labelledCircuit() {
    const snapshot = divider._generateWithCapture();
    snapshot.name = 'LabelledDivider';
    snapshot.connectionStyle = 'direct-labels';
    snapshot.schematicRouting = undefined;
    return snapshot;
}
// #endregion labels

// #region automatic
export function automaticCircuit() {
    const snapshot = grouped._generateWithCapture();
    snapshot.name = 'AutomaticIndicator';
    snapshot.schematicRouting!.autoLayout!.algorithm = 'grid';
    return snapshot;
}
// #endregion automatic

// #region pages
export function pagedCircuit() {
    const snapshot = grouped._generateWithCapture();
    snapshot.name = 'PagedIndicator';
    snapshot.schematicRouting!.autoLayout!.pages = true;
    return snapshot;
}
// #endregion pages
