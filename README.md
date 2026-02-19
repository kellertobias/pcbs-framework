# @tobisk/pcb

A strict, type-safe TypeScript framework for designing PCBs, powered by [circuit-synth](https://github.com/circuit-synth/circuit-synth).

## Features

- **Type-Safe Design**: leveraging TypeScript to ensure correct connectivity and component logic.
- **Circuit-Synth Integration**: Uses `circuit-synth` internally for the heavy lifting of netlisting and PCB generation.
- **Programmatic Layout**: Define schematic and PCB positions in code.
- **Modular Components**: Reusable `Composable` blocks (e.g., Buck Converters, LED Indicators).

## Usage

```bash
npm install @tobisk/pcb
```

### CLI

```bash
npx @tobisk/pcb synth <schematic-name>
npx @tobisk/pcb export <schematic-name>
npx @tobisk/pcb lib <schematic-name>
```
