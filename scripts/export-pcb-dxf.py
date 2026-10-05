#!/usr/bin/env python3
"""Export named mechanical layers from an existing .kicad_pcb at 1:1 in mm.

Usage: python3 scripts/export-pcb-dxf.py board.kicad_pcb --output-dir output/dxf
       npm run dxf -- board.kicad_pcb --layers frontpanel,mounting,interaction,board

Reads the shared layer registry from the installed @tobisk/pcbs library.
Does not synthesize a board, change footprints, refill zones or edit the input.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def layer_definitions():
    root = Path(__file__).resolve().parents[1]
    registry = root / 'dist/src/synth/FootprintLayers.json'
    if not registry.is_file():
        registry = root / 'src/synth/FootprintLayers.json'
    if not registry.is_file():
        raise RuntimeError('Layer registry missing; rebuild the local @tobisk/pcbs library first.')
    result = json.loads(registry.read_text())
    result['BoardOutline'] = {'layer': 'Edge.Cuts', 'uiName': 'BoardOutline', 'aliases': ['board']}
    return result


def select_layers(request, definitions):
    names = list(definitions) if request.lower() == 'all' else request.split(',')
    selected = []
    for name in names:
        match = next((key for key, d in definitions.items()
                      if name.strip().lower() in [s.lower() for s in [key, d['layer'], *d['aliases']]]), None)
        if match is None:
            raise ValueError(f'Unknown layer {name!r}. Use semantic names, KiCad IDs, UI aliases or --layers all.')
        if match not in selected:
            selected.append(match)
    return selected


def dxf_entities(file):
    """Count drawing entities without depending on a CAD Python package."""
    lines = file.read_text(errors='strict').splitlines()
    pairs = [(int(lines[i].strip()), lines[i + 1].strip()) for i in range(0, len(lines) - 1, 2)]
    in_entities = False
    counts = {}
    for code, value in pairs:
        if code == 2 and value == 'ENTITIES':
            in_entities = True
        elif code == 0 and value == 'ENDSEC':
            in_entities = False
        elif in_entities and code == 0:
            counts[value] = counts.get(value, 0) + 1
    return counts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('pcb', type=Path, help='Existing pcbnew .kicad_pcb file')
    parser.add_argument('-o', '--output-dir', type=Path, help='Default: <PCB directory>/<PCB name>-dxf')
    parser.add_argument('--layers', default='frontpanel,mounting,interaction', help='Comma-separated selectors; all also includes F.Fab, B.Fab and Edge.Cuts')
    parser.add_argument('--include-board-outline', action='store_true', help='Add Edge.Cuts to EACH selected mechanical drawing; review whether PCB outline matches the panel')
    parser.add_argument('--kicad-cli', default='kicad-cli', help='Executable name or full path')
    args = parser.parse_args(argv)
    pcb = args.pcb.expanduser().resolve()
    if not pcb.is_file() or not pcb.read_text().lstrip().startswith('(kicad_pcb'):
        parser.error('Input must be a readable KiCad PCB file.')
    cli = shutil.which(args.kicad_cli)
    if cli is None:
        parser.error('kicad-cli was not found. Install KiCad or provide --kicad-cli /path/to/kicad-cli.')
    definitions = layer_definitions()
    selected = select_layers(args.layers, definitions)
    out = (args.output_dir or pcb.parent / f'{pcb.stem}-dxf').expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    source_hash = hashlib.sha256(pcb.read_bytes()).hexdigest()
    exported = []
    with tempfile.TemporaryDirectory(prefix='pcb-dxf-') as scratch:
        for name in selected:
            definition = definitions[name]
            target = out / f'{pcb.stem}-{name}.dxf'
            staged = Path(scratch) / target.name
            layers = [definition['layer']]
            if args.include_board_outline and 'Edge.Cuts' not in layers:
                layers.append('Edge.Cuts')
            command = [cli, 'pcb', 'export', 'dxf', str(pcb), '--mode-single',
                       '--output', str(staged), '--layers', ','.join(layers),
                       '--output-units', 'mm', '--scale', '1', '--drill-shape-opt', '0',
                       '--exclude-refdes']
            # Cutting/interaction files must contain geometry, never value/reference text.
            # Fabrication files intentionally retain actual Value text.
            if name not in ['FrontValue', 'BackValue']:
                command.append('--exclude-value')
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError(f'{name} export failed:\n{result.stderr or result.stdout}')
            if not staged.is_file():
                raise RuntimeError(f'KiCad did not create {name}; check the PCB layer table.')
            counts = dxf_entities(staged)
            # Copy into a same-filesystem temporary file, then atomically replace.
            local = target.with_suffix('.dxf.tmp')
            shutil.copyfile(staged, local)
            os.replace(local, target)
            exported.append({'name': name, 'kicadLayers': layers, 'file': str(target), 'entities': counts})
            print(f'{name}: {target} ({sum(counts.values())} entities)')
            if not counts:
                print(f'  Empty layer: update the board footprints if it predates the mechanical-layer mapping.', file=sys.stderr)
    if hashlib.sha256(pcb.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError('Input PCB changed during export; outputs may represent different revisions.')
    manifest = {'pcb': str(pcb), 'inputSha256': source_hash, 'units': 'mm', 'scale': 1,
                'includeBoardOutline': args.include_board_outline, 'exports': exported}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Error: {error}', file=sys.stderr)
        raise SystemExit(1)
