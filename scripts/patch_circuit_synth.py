import sys
import os
from pathlib import Path

def patch():
    try:
        import circuit_synth
    except ImportError:
        print("circuit-synth not found in the current environment.")
        return

    cs_path = Path(circuit_synth.__file__).parent
    
    # Patch 1: circuit_synth/core/component.py
    # Fix pin number key mismatch in netlist exporter
    comp_py = cs_path / "core" / "component.py"
    if comp_py.exists():
        content = comp_py.read_text()
        if '"pin_id": pin_num,' in content:
            print(f"Patching {comp_py}...")
            content = content.replace('"pin_id": pin_num,', '"number": pin_num,')
            comp_py.write_text(content)
        else:
            print(f"Patch 1 (component.py): Already patched or target content not found.")

    # Patch 2: circuit_synth/kicad/sch_gen/circuit_loader.py
    # Prioritize pin numbers over names to prevent collisions (e.g., multiple GND pins)
    loader_py = cs_path / "kicad" / "sch_gen" / "circuit_loader.py"
    if loader_py.exists():
        content = loader_py.read_text()
        
        # We look for the identification block to swap priority
        old_block = """            # Enhanced pin identification - store the most specific identifier available
            pin_identifier = None

            # First check if name is available (most specific)
            if "name" in pin_data and pin_data["name"] != "~":
                pin_identifier = pin_data["name"]
                logger.debug(
                    f"Using pin name '{pin_identifier}' for {comp_ref} in net {net_name}"
                )
            # Then check for number
            elif "number" in pin_data:
                pin_identifier = str(pin_data["number"])
                logger.debug(
                    f"Using pin number '{pin_identifier}' for {comp_ref} in net {net_name}"
                )"""
        
        new_block = """            # Enhanced pin identification - prioritize number for uniqueness
            pin_identifier = None

            # First check for number (most unique/specific)
            if "number" in pin_data:
                pin_identifier = str(pin_data["number"])
                logger.debug(
                    f"Using pin number '{pin_identifier}' for {comp_ref} in net {net_name}"
                )
            # Then check if name is available
            elif "name" in pin_data and pin_data["name"] != "~":
                pin_identifier = pin_data["name"]
                logger.debug(
                    f"Using pin name '{pin_identifier}' for {comp_ref} in net {net_name}"
                )"""
        
        if old_block in content:
            print(f"Patching {loader_py}...")
            content = content.replace(old_block, new_block)
            loader_py.write_text(content)
        elif new_block in content:
            print(f"Patch 2 (circuit_loader.py): Already patched.")
        else:
            print(f"Patch 2 (circuit_loader.py): Content mismatch, could not patch.")

if __name__ == "__main__":
    patch()
