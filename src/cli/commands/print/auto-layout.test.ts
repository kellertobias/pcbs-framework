import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Schematic } from '../../../synth/Schematic';
import { Component } from '../../../synth/Component';
import { Composable } from '../../../synth/Composable';
import { Net } from '../../../synth/Net';
import { GravityLayout } from '../../../synth/Layout';
import { renderNet } from './nets';
import { renderComponent } from './components';
import { renderScope } from './scope';
import { RenderContext, COLORS } from './types';
import { Pin } from '../../../synth/types';
import { getSubschematicGroups } from './subschematic-strategy';

// Mock PDFDocument
const mockDoc = {
  moveTo: vi.fn().mockReturnThis(),
  lineTo: vi.fn().mockReturnThis(),
  stroke: vi.fn().mockReturnThis(),
  lineWidth: vi.fn().mockReturnThis(),
  strokeColor: vi.fn().mockReturnThis(),
  fillColor: vi.fn().mockReturnThis(),
  rect: vi.fn().mockReturnThis(),
  circle: vi.fn().mockReturnThis(),
  text: vi.fn().mockReturnThis(),
  fontSize: vi.fn().mockReturnThis(),
  save: vi.fn().mockReturnThis(),
  restore: vi.fn().mockReturnThis(),
  translate: vi.fn().mockReturnThis(),
  rotate: vi.fn().mockReturnThis(),
  addPage: vi.fn().mockReturnThis(),
  quadraticCurveTo: vi.fn().mockReturnThis(),
  dash: vi.fn().mockReturnThis(),
  undash: vi.fn().mockReturnThis(),
  page: { width: 1000, height: 1000 },
};

// Helper to create a render context
function createRenderContext(): RenderContext {
  return {
    doc: mockDoc as any,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    width: 1000,
    height: 1000,
    marginX: 0,
    marginY: 0,
    pinPositions: new Map(),
    portPositions: new Map(),
  };
}

// Helper for intersection
function checkLineRectIntersection(p1: {x: number, y: number}, p2: {x: number, y: number}, minX: number, minY: number, maxX: number, maxY: number) {
    // Basic implementation for axis-aligned check
    // If line is horizontal/vertical, it's easier.

    // Check if both points are on same side of rect -> no intersection
    if (Math.max(p1.x, p2.x) < minX) return false;
    if (Math.min(p1.x, p2.x) > maxX) return false;
    if (Math.max(p1.y, p2.y) < minY) return false;
    if (Math.min(p1.y, p2.y) > maxY) return false;

    return true;
}

describe('Auto-layout and Print Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Wire Routing', () => {
    it('wires should avoid crossing symbols', () => {
      // Setup: Pin A at (0, 0), Pin B at (100, 0)
      // Obstacle Component at (50, 0) with size 20x20 -> bbox (40, -10) to (60, 10)
      const ctx = createRenderContext();

      const pinA = new Pin({ ref: 'U1', symbol: 'Device:R' }, '1');
      const pinB = new Pin({ ref: 'U2', symbol: 'Device:R' }, '1');

      ctx.pinPositions.set(pinA, { x: 0, y: 0 });
      ctx.pinPositions.set(pinB, { x: 100, y: 0 });

      const net = new Net({ name: 'N1' });
      net.tie(pinA);
      net.tie(pinB);

      // Define components that own the pins
      const compU1 = { ref: 'U1', allPins: new Map([['1', pinA]]) };
      const compU2 = { ref: 'U2', allPins: new Map([['1', pinB]]) };

      // Define an obstacle (component) in the scope
      const obstacle = {
        ref: 'U3',
        symbol: 'Device:R',
        schematicPosition: { x: 50, y: 0 },
        allPins: new Map(), // needed for type safety usually
        // Component size is typically assumed or calculated. Let's say 20x20 (half-width 10).
      };

      // We pass the obstacle to renderNet via scopeItems
      const scopeItems = [compU1, compU2, obstacle];

      renderNet(ctx, net, scopeItems);

      const calls = mockDoc.lineTo.mock.calls;
      // Should have at least one call
      expect(calls.length).toBeGreaterThan(0);

      // Check if any segment intersects the box (40, -10) to (60, 10)
      let crossed = false;
      let start = { x: 0, y: 0 }; // Starting point from moveTo

      // Assuming moveTo was called first
      expect(mockDoc.moveTo).toHaveBeenCalledWith(0, 0);

      for (const call of calls) {
        const end = { x: call[0], y: call[1] };

        // Check intersection with rectangle (40, -10, 60, 10)
        // We assume obstacle size 20x20 centered at 50,0.
        // x: [40, 60], y: [-10, 10]

        if (checkLineRectIntersection(start, end, 40, -10, 60, 10)) {
          crossed = true;
        }
        start = end;
      }

      expect(crossed).toBe(false);
    });

    it('wires should lead away from pin', () => {
      const ctx = createRenderContext();
      const pin = new Pin({ ref: 'U1', symbol: 'Device:R' }, '1');
      const pinPos = { x: 100, y: 100 };
      ctx.pinPositions.set(pin, pinPos);

      // Assume we can tell renderNet about pin orientation.
      // For now, if we cannot, this test just checks basic pathing behavior.
      // If we setup the OTHER pin such that a direct path goes INTO the symbol,
      // it should route around.

      // Say Pin is on Right side of U1. U1 is at (80, 100) size 40x40 -> x range [60, 100].
      // Pin is at (100, 100).
      // Other pin is at (0, 100) (Left side).
      // Direct path: (100,100) -> (0,100) goes through U1 body (x=60..100).

      const otherPin = new Pin({ ref: 'U2', symbol: 'Device:R' }, '1');
      ctx.pinPositions.set(otherPin, { x: 0, y: 100 });

      const net = new Net({ name: 'N2' });
      net.tie(pin);
      net.tie(otherPin);

      // Mock the component U1 to exist so renderNet knows to avoid it (if it supported obstacle avoidance)
      const componentU1 = {
          ref: 'U1',
          symbol: 'Device:R',
          schematicPosition: { x: 80, y: 100 },
          allPins: new Map([['1', pin]]),
          // bbox would be roughly (60, 80) to (100, 120)
      };
      const componentU2 = {
          ref: 'U2',
          allPins: new Map([['1', otherPin]]),
      };

      renderNet(ctx, net, [componentU1, componentU2]);

      // Analyze all segments to find the one connected to pinPos (100, 100)
      let segmentFound = false;
      let leadingAway = false;

      // Reconstruct path from moveTo/lineTo
      // Assuming one continuous path for simple net
      // Mock doesn't store state perfectly so we rely on call order
      // But renderNet might do multiple moveTo.

      // Let's iterate calls and rebuild segments
      const ops: {type: 'move'|'line', x: number, y: number}[] = [];
      if (mockDoc.moveTo.mock.calls.length > 0) {
          ops.push({ type: 'move', x: mockDoc.moveTo.mock.calls[0][0], y: mockDoc.moveTo.mock.calls[0][1] });
      }
      for (const call of mockDoc.lineTo.mock.calls) {
          ops.push({ type: 'line', x: call[0], y: call[1] });
      }

      let current = { x: 0, y: 0 };
      for (const op of ops) {
          if (op.type === 'move') {
              current = { x: op.x, y: op.y };
          } else {
              const next = { x: op.x, y: op.y };
              // Ignore zero-length segments
              if (current.x === next.x && current.y === next.y) {
                  continue;
              }

              // Check if this segment connects to pinPos
              if ((current.x === pinPos.x && current.y === pinPos.y) ||
                  (next.x === pinPos.x && next.y === pinPos.y)) {

                  segmentFound = true;
                  const other = (current.x === pinPos.x && current.y === pinPos.y) ? next : current;

                  // For a pin on the Right (facing Right), the wire should exist in X >= 100 area.
                  // So the other point should have x >= 100.
                  if (other.x >= pinPos.x) {
                      leadingAway = true;
                  }
              }
              current = next;
          }
      }

      expect(segmentFound).toBe(true);
      expect(leadingAway).toBe(true);
    });
  });

  describe('Symbol Placement', () => {
    it('symbols should not overlap', () => {
      const layout = new GravityLayout({ spacing: 50, iterations: 10 });
      // GravityLayout currently ignores items with null schematicPosition.
      // This test might fail if GravityLayout isn't designed to initialize positions.
      // But assuming it should:
      const items: any[] = [
        { ref: 'U1', schematicPosition: { x: 0, y: 0 }, allPins: new Map() },
        { ref: 'U2', schematicPosition: { x: 0, y: 0 }, allPins: new Map() },
        { ref: 'U3', schematicPosition: { x: 0, y: 0 }, allPins: new Map() },
      ];

      layout.apply(items);

      // Check for overlaps assuming 40x40 size
      const size = 40;
      let overlap = false;
      for (let i = 0; i < items.length; i++) {
        expect(items[i].schematicPosition).not.toBeNull();

        for (let j = i + 1; j < items.length; j++) {
          const p1 = items[i].schematicPosition;
          const p2 = items[j].schematicPosition;

          if (Math.abs(p1.x - p2.x) < size && Math.abs(p1.y - p2.y) < size) {
            overlap = true;
          }
        }
      }

      expect(overlap).toBe(false);
    });

    it('groups should be grouped with outline and name', () => {
      const groupName = "Power Stage";
      const items: any[] = [
          { ref: 'U1', group: groupName, schematicPosition: { x: 100, y: 100 }, allPins: new Map() },
          { ref: 'U2', group: groupName, schematicPosition: { x: 120, y: 120 }, allPins: new Map() },
          { ref: 'U3', group: "Control", schematicPosition: { x: 300, y: 300 }, allPins: new Map() }
      ];

      const schematic = {
          name: "Test",
          size: "A4",
          author: "Me",
          revision: "v1",
      } as Schematic;

      renderScope(mockDoc as any, "Test", items, [], schematic);

      // Check for dashed rectangle
      // We expect at least one dashed rectangle drawn for "Power Stage".
      // We expect text "Power Stage" to be drawn.

      // Check dash calls
      const dashCalls = mockDoc.dash.mock.calls;
      expect(dashCalls.length).toBeGreaterThan(0);

      // Check rect calls while dashed
      // This is hard to correlate without order.
      // But we can check if `text` was called with "Power Stage".

      const textCalls = mockDoc.text.mock.calls;
      const groupNameDrawn = textCalls.some(call => call[0] === groupName);
      expect(groupNameDrawn).toBe(true);

      // Check rect existence
      const rectCalls = mockDoc.rect.mock.calls;
      // We expect a rect covering U1 and U2 (approx 100,100 to 120,120 plus margins)
      // U1: 100,100. U2: 120,120.
      // Group BBox roughly: minX 100, minY 100, maxX 120, maxY 120.
      // The rect should be roughly around there.

      // Since we don't know exact padding, just checking if ANY rect is drawn is a start,
      // but simpler to rely on text and dash for now as "group" indicators.
    });
  });

  describe('Subcircuits and Composables', () => {
    it('subcircuits should be black boxes and have own page', () => {
      // Create a composable
      const sub = new Composable({ ref: 'SUB1' });
      // Ensure it has pins to be rendered as ports
      Object.defineProperty(sub, 'allPins', {
          value: new Map([
            ['IN', new Pin({ ref: 'SUB1', symbol: 'Composable:MySub' }, 'IN')],
            ['OUT', new Pin({ ref: 'SUB1', symbol: 'Composable:MySub' }, 'OUT')]
          ]),
          writable: true
      });
      (sub as any).schematicPosition = { x: 200, y: 200 };

      // Render it via renderComponent
      const ctx = createRenderContext();
      renderComponent(ctx, sub);

      // Expect a rectangle (black box)
      // Composable usually doesn't have a symbol, so it hits the fallback path.
      // Fallback path draws a rect.
      expect(mockDoc.rect).toHaveBeenCalled();

      // We also expect "SUB1" text
      const textCalls = mockDoc.text.mock.calls;
      expect(textCalls.some(c => c[0] === 'SUB1')).toBe(true);

      // To test "have own page", we would need to run the full print command or renderScope iteration.
      // But we can check if renderScope calls addPage when iterating subschematics.
      // Since we can't easily invoke the full loop here without mocking registry and everything,
      // we'll focus on the "black box" rendering part for now, which is what the layouter handles.
    });

    it('composables default to inline rendering unless marked', () => {
      // Logic uses getSubschematicGroups

      class MyUnmarked extends Composable {
        protected defineInterface() { return {}; }
      }

      const unmarked = new MyUnmarked({ ref: 'U1' });
      const marked = new MyUnmarked({ ref: 'U2' });
      marked.makeSubschematic({ name: 'MarkedType' });

      const groups = getSubschematicGroups([unmarked, marked]);

      expect(groups.has('MarkedType')).toBe(true);
      expect(groups.has('MyUnmarked')).toBe(false); // Default name NOT used
      expect(groups.get('MarkedType')?.length).toBe(1);
      expect(groups.get('MarkedType')?.[0]).toBe(marked);
    });

    it('only distinct composables get subcircuit pages', () => {
      class MyAmp extends Composable {
        protected defineInterface() { return {}; }
      }

      // Two instances share the same "type" name -> grouped
      const amp1 = new MyAmp({ ref: 'Amp1' });
      amp1.makeSubschematic({ name: 'Amp' });

      const amp2 = new MyAmp({ ref: 'Amp2' });
      amp2.makeSubschematic({ name: 'Amp' }); // Same group name

      // One instance has different name -> separate
      const amp3 = new MyAmp({ ref: 'Amp3' });
      amp3.makeSubschematic({ name: 'AmpV2' }); // Different name

      const groups = getSubschematicGroups([amp1, amp2, amp3]);

      expect(groups.size).toBe(2);
      expect(groups.has('Amp')).toBe(true);
      expect(groups.has('AmpV2')).toBe(true);

      expect(groups.get('Amp')?.length).toBe(2);
      expect(groups.get('AmpV2')?.length).toBe(1);
    });
  });

  describe('DNC and Pin Rendering', () => {
      it('pins in symbols should not repeat', () => {
          // Verify that Component enforces unique pins via Map
          const comp = new Component({ symbol: 'Device:R', ref: 'R1', footprint: 'R' });

          // Try to add duplicate pins manually to the internal store if possible,
          // or just verify that standard usage results in unique pins.

          // Since allPins is a Map<string, Pin>, keys are unique.
          // Let's verify renderComponent iterates the Map.

          const ctx = createRenderContext();
          const pin1 = new Pin({ ref: 'R1', symbol: 'Device:R' }, '1');

          // Mock item with duplicate pins in array form if it were possible,
          // but input to renderComponent is expected to have allPins as Map.

          const item = {
              ref: 'R1',
              symbol: 'Device:R',
              schematicPosition: { x: 0, y: 0 },
              allPins: new Map([['1', pin1]])
          };

          // If we somehow had duplicates in values? Map iterates unique keys.
          // What if '1' and '1_dup' point to same pin?
          // renderPin would be called twice.

          // The requirement "pins in symbols should not repeat" likely means:
          // Don't draw the same pin twice on the symbol.

          renderComponent(ctx, item);

          // Count text calls for pin name "1"
          const textCalls = mockDoc.text.mock.calls.filter(c => c[0] === '1');
          expect(textCalls.length).toBe(1);
      });

      it('DNC pins should have X and reason', () => {
          const ctx = createRenderContext();
          const pin = new Pin({ ref: 'U1', symbol: 'Device:R' }, '1');

          // Mark DNC with reason
          const reason = "Not needed";
          pin.dnc(reason);

          // Render component with this pin
          // We need a component that owns this pin
          const comp = {
              ref: 'U1',
              symbol: 'Device:R',
              schematicPosition: { x: 100, y: 100 },
              allPins: new Map([['1', pin]])
          };

          renderComponent(ctx, comp);

          // Check for X (red stroke)
          // renderPin draws X with explicit lineTo/stroke calls using red color.
          // Or renderPin implementation uses "#ff0000".

          // Check for Reason text
          // Currently implementation DOES NOT print reason.
          // We expect this to fail.

          const textCalls = mockDoc.text.mock.calls;
          const reasonPrinted = textCalls.some(c => c[0] === reason);
          expect(reasonPrinted).toBe(true);
      });
  });

});
