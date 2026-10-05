import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('export_pcb_dxf', Path(__file__).with_name('export-pcb-dxf.py'))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportPcbDxfTests(unittest.TestCase):
    def test_aliases_resolve_to_distinct_library_layers(self):
        definitions = exporter.layer_definitions()
        self.assertEqual(exporter.select_layers('User.Eco1,Eco2.User,User.Drawings', definitions),
                         ['FrontpanelCutout', 'MountingLayerCutout', 'UserInteractionArea'])
        with self.assertRaises(ValueError):
            exporter.select_layers('unknown-layer', definitions)

    def test_export_is_read_only_and_uses_mm_one_to_one_for_paths_with_spaces(self):
        with tempfile.TemporaryDirectory() as temp:
            pcb = Path(temp) / 'board with spaces.kicad_pcb'
            source = '(kicad_pcb (version 20241229))'
            pcb.write_text(source)
            commands = []

            def fake_run(command, **kwargs):
                commands.append(command)
                Path(command[command.index('--output') + 1]).write_text(
                    '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nFRAME\n0\nENDSEC\n0\nEOF\n')
                class Result:
                    returncode = 0
                return Result()

            with patch.object(exporter.shutil, 'which', return_value='/path with spaces/kicad-cli'), \
                    patch.object(exporter.subprocess, 'run', side_effect=fake_run):
                self.assertEqual(exporter.main([str(pcb), '-o', str(Path(temp) / 'out'), '--layers', 'mounting']), 0)
            self.assertEqual(pcb.read_text(), source)
            self.assertEqual(len(commands), 1)
            command = commands[0]
            self.assertIn(str(pcb.resolve()), command)
            self.assertEqual(command[command.index('--output-units') + 1], 'mm')
            self.assertEqual(command[command.index('--scale') + 1], '1')
            self.assertEqual(command[command.index('--drill-shape-opt') + 1], '0')
            self.assertEqual(command[command.index('--layers') + 1], 'Eco2.User')
            self.assertIn('--mode-single', command)
            self.assertIn('--exclude-value', command)
            self.assertTrue((Path(temp) / 'out' / 'manifest.json').is_file())


if __name__ == '__main__':
    unittest.main()
