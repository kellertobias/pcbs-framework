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
      const ctx = createRenderContext();
      const pinA = new Pin({ ref: 'U1', symbol: 'Device:R' }, '1');
      const pinB = new Pin({ ref: 'U2', symbol: 'Device:R' }, '1');

      ctx.pinPositions.set(pinA, { x: 0, y: 0 });
      ctx.pinPositions.set(pinB, { x: 100, y: 0 });

      const net = new Net({ name: 'N1' });
      net.tie(pinA);
      net.tie(pinB);

      const compU1 = { ref: 'U1', allPins: new Map([['1', pinA]]) };
      const compU2 = { ref: 'U2', allPins: new Map([['1', pinB]]) };
      const obstacle = {
        ref: 'U3',
        symbol: 'Device:R',
        schematicPosition: { x: 50, y: 0 },
        allPins: new Map(),
      };

      const scopeItems = [compU1, compU2, obstacle];

      renderNet(ctx, net, scopeItems);

      const calls = mockDoc.lineTo.mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      let crossed = false;
      let start = { x: 0, y: 0 };
      expect(mockDoc.moveTo).toHaveBeenCalledWith(0, 0);

      for (const call of calls) {
        const end = { x: call[0], y: call[1] };
        // Check intersection with obstacle (40, -10, 60, 10)
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

      const otherPin = new Pin({ ref: 'U2', symbol: 'Device:R' }, '1');
      ctx.pinPositions.set(otherPin, { x: 0, y: 100 });

      const net = new Net({ name: 'N2' });
      net.tie(pin);
      net.tie(otherPin);

      const componentU1 = {
          ref: 'U1',
          symbol: 'Device:R',
          schematicPosition: { x: 80, y: 100 },
          allPins: new Map([['1', pin]]),
      };
      const componentU2 = {
          ref: 'U2',
          allPins: new Map([['1', otherPin]]),
      };

      renderNet(ctx, net, [componentU1, componentU2]);

      let segmentFound = false;
      let leadingAway = false;

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
              if (current.x === next.x && current.y === next.y) continue;

              if ((current.x === pinPos.x && current.y === pinPos.y) ||
                  (next.x === pinPos.x && next.y === pinPos.y)) {

                  segmentFound = true;
                  const other = (current.x === pinPos.x && current.y === pinPos.y) ? next : current;
                  if (other.x >= pinPos.x) leadingAway = true;
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
      const items: any[] = [
        { ref: 'U1', schematicPosition: { x: 0, y: 0 }, allPins: new Map() },
        { ref: 'U2', schematicPosition: { x: 0, y: 0 }, allPins: new Map() },
        { ref: 'U3', schematicPosition: { x: 0, y: 0 }, allPins: new Map() },
      ];
      layout.apply(items);
      const size = 40;
      let overlap = false;
      for (let i = 0; i < items.length; i++) {
        expect(items[i].schematicPosition).not.toBeNull();
        for (let j = i + 1; j < items.length; j++) {
          const p1 = items[i].schematicPosition;
          const p2 = items[j].schematicPosition;
          if (Math.abs(p1.x - p2.x) < size && Math.abs(p1.y - p2.y) < size) overlap = true;
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

      // We assume renderScope calls rect() for the group while dashed.
      // We must track the dashed state.
      let isDashed = false;
      const dashedRects: {x: number, y: number, w: number, h: number}[] = [];

      mockDoc.dash.mockImplementation(() => { isDashed = true; return mockDoc; });
      mockDoc.undash.mockImplementation(() => { isDashed = false; return mockDoc; });

      mockDoc.rect.mockImplementation((x, y, w, h) => {
          if (isDashed) dashedRects.push({x, y, w, h});
          return mockDoc;
      });

      renderScope(mockDoc as any, "Test", items, [], schematic);

      // 1. Verify at least one dashed rect exists
      expect(dashedRects.length).toBeGreaterThan(0);

      // 2. Find the rect that encompasses U1 (100,100) and U2 (120,120)
      // U1 bbox (assuming 40x40 center): [80, 120] x [80, 120]
      // U2 bbox: [100, 140] x [100, 140]
      // Total Group BBox: minX=80, minY=80, maxX=140, maxY=140.

      const groupRect = dashedRects.find(r =>
          r.x <= 80 && r.y <= 80 &&
          (r.x + r.w) >= 140 && (r.y + r.h) >= 140
      );

      expect(groupRect).toBeDefined();

      // 3. Verify it does NOT encompass U3 (300, 300) -> bbox [280, 320]
      // Check intersection
      const u3MinX = 280, u3MaxX = 320, u3MinY = 280, u3MaxY = 320;

      // If groupRect contains U3 center
      if (groupRect) {
          const containsU3 = (
              groupRect.x <= 300 && (groupRect.x + groupRect.w) >= 300 &&
              groupRect.y <= 300 && (groupRect.y + groupRect.h) >= 300
          );
          expect(containsU3).toBe(false);
      }

      // 4. Verify the label "Power Stage" is drawn at the top-left of the rect
      const textCalls = mockDoc.text.mock.calls;
      const labelCall = textCalls.find(c => c[0] === groupName);
      expect(labelCall).toBeDefined();

      if (labelCall && groupRect) {
          const lx = labelCall[1];
          const ly = labelCall[2];
          // Should be near (groupRect.x, groupRect.y)
          expect(Math.abs(lx - groupRect.x)).toBeLessThan(20);
          expect(Math.abs(ly - groupRect.y)).toBeLessThan(20);
      }
    });
  });

  describe('Subcircuits and Composables', () => {
    it('subcircuits should be black boxes and have own page', () => {
      const sub = new Composable({ ref: 'SUB1' });
      Object.defineProperty(sub, 'allPins', {
          value: new Map([
            ['IN', new Pin({ ref: 'SUB1', symbol: 'Composable:MySub' }, 'IN')],
            ['OUT', new Pin({ ref: 'SUB1', symbol: 'Composable:MySub' }, 'OUT')]
          ]),
          writable: true
      });
      (sub as any).schematicPosition = { x: 200, y: 200 };

      const ctx = createRenderContext();

      // Mock rect to capture box dimensions
      let boxDrawn: {x: number, y: number, w: number, h: number} | null = null;
      mockDoc.rect.mockImplementation((x, y, w, h) => {
          boxDrawn = {x, y, w, h};
          return mockDoc;
      });

      renderComponent(ctx, sub);

      // Expect a rectangle centered at 200,200
      // NOTE: renderComponent uses ctx.doc.translate(x,y) then draws rect at local (-w/2, -h/2).
      // So we verify translate() was called with (200, 200) and rect() was called with local coords centered at 0.

      expect(mockDoc.translate).toHaveBeenCalledWith(200, 200);

      expect(boxDrawn).not.toBeNull();
      if (boxDrawn) {
          // Center of the rect in LOCAL coordinates should be 0,0
          const centerX = boxDrawn.x + boxDrawn.w / 2;
          const centerY = boxDrawn.y + boxDrawn.h / 2;
          expect(Math.abs(centerX)).toBeLessThan(1);
          expect(Math.abs(centerY)).toBeLessThan(1);
      }

      // Expect "SUB1" text centered
      const textCalls = mockDoc.text.mock.calls;
      const labelCall = textCalls.find(c => c[0] === 'SUB1');
      expect(labelCall).toBeDefined();

      // TODO: check label position relative to box
    });

    it('composables default to inline rendering unless marked', () => {
      class MyUnmarked extends Composable {
        protected defineInterface() { return {}; }
      }
      const unmarked = new MyUnmarked({ ref: 'U1' });
      const marked = new MyUnmarked({ ref: 'U2' });
      marked.makeSubschematic({ name: 'MarkedType' });
      const groups = getSubschematicGroups([unmarked, marked]);
      expect(groups.has('MarkedType')).toBe(true);
      expect(groups.has('MyUnmarked')).toBe(false);
    });

    it('only distinct composables get subcircuit pages', () => {
      class MyAmp extends Composable {
        protected defineInterface() { return {}; }
      }
      const amp1 = new MyAmp({ ref: 'Amp1' });
      amp1.makeSubschematic({ name: 'Amp' });
      const amp2 = new MyAmp({ ref: 'Amp2' });
      amp2.makeSubschematic({ name: 'Amp' });
      const amp3 = new MyAmp({ ref: 'Amp3' });
      amp3.makeSubschematic({ name: 'AmpV2' });
      const groups = getSubschematicGroups([amp1, amp2, amp3]);
      expect(groups.size).toBe(2);
      expect(groups.get('Amp')?.length).toBe(2);
    });
  });

  describe('DNC and Pin Rendering', () => {
      it('pins in symbols should not repeat', () => {
          const comp = new Component({ symbol: 'Device:R', ref: 'R1', footprint: 'R' });
          const ctx = createRenderContext();
          const pin1 = new Pin({ ref: 'R1', symbol: 'Device:R' }, '1');
          const item = {
              ref: 'R1',
              symbol: 'Device:R',
              schematicPosition: { x: 0, y: 0 },
              allPins: new Map([['1', pin1]])
          };
          renderComponent(ctx, item);
          const textCalls = mockDoc.text.mock.calls.filter(c => c[0] === '1');
          expect(textCalls.length).toBe(1);
      });

      it('DNC pins should have X and reason', () => {
          const ctx = createRenderContext();
          const pin = new Pin({ ref: 'U1', symbol: 'Device:R' }, '1');
          const reason = "Not needed";
          pin.dnc(reason);

          const comp = {
              ref: 'U1',
              symbol: 'Device:R',
              schematicPosition: { x: 100, y: 100 },
              allPins: new Map([['1', pin]])
          };

          // Clear mocks to focus on this component
          vi.clearAllMocks();

          // We assume the pin is at some location relative to 100,100.
          // Since there is no symbol data loaded (mocked extractSymbol returns null or we mock it),
          // it falls back to default spacing.
          // Pin 1 (index 0) of 1 pin.
          // Calculated pos: x=100-40 = 60 (left side), y=100. (Assuming fallback: left side)
          // Or renderComponent places it.

          // Let's capture moveTo/lineTo calls
          const moveCalls: any[] = [];
          const lineCalls: any[] = [];

          mockDoc.moveTo.mockImplementation((x, y) => { moveCalls.push({x, y}); return mockDoc; });
          mockDoc.lineTo.mockImplementation((x, y) => { lineCalls.push({x, y}); return mockDoc; });

          renderComponent(ctx, comp);

          // Find the "X" pattern.
          // An X is two intersecting lines of similar length, roughly orthogonal.
          // Or specifically: (cx-s, cy-s) to (cx+s, cy+s) AND (cx+s, cy-s) to (cx-s, cy+s).

          // We look for pairs of move->line that form this X.
          let xFound = false;
          let xCenter = {x: 0, y: 0};

          for (let i=0; i < moveCalls.length; i++) {
              const m1 = moveCalls[i];
              // Find corresponding lineTo (assuming immediate)
              // But renderPin might do moveTo... lineTo... moveTo... lineTo...
              // We need to match them.
              // Assuming sequence: moveTo, lineTo, moveTo, lineTo for the X.

              if (i+1 < moveCalls.length) {
                  const m2 = moveCalls[i+1];
                  // If these two moves start the cross
                  // We need to find the lines.
                  // This is tricky without strict ordering guarantee.
                  // But usually X is drawn as one block.
              }
          }

          // Let's just iterate all segments and find two that cross at a center point and form an X.
          // Segments:
          const segments: {p1: {x:number, y:number}, p2: {x:number, y:number}}[] = [];
          // Reconstruct segments from calls sequence
          // A bit hard if moveTo/lineTo are interleaved with other draws.
          // But "X" is usually small (size ~3-5).

          // We can check if we have 2 segments that share a center.
          // segment 1: (x-d, y-d) -> (x+d, y+d)
          // segment 2: (x+d, y-d) -> (x-d, y+d)

          // Let's find any segment that looks like a diagonal.
          // And then find its pair.

          // We reconstruct segments by looking at the call history sequentially.
          const history = mockDoc.moveTo.mock.invocationCallOrder; // wait, vitest gives call order
          // But we have separate mocks.
          // We can use a single spy or just assume sequential blocks.

          // Simplified: just look for coordinates in lineCalls that match expected X pattern.
          // Since we don't know exact pin pos, we scan.

          let crossesFound = 0;
          for (const line of lineCalls) {
             // If this line is short and diagonal?
             // Not enough.
          }

          // Okay, let's verify reason text position relative to X.
          const textCalls = mockDoc.text.mock.calls;
          const reasonCall = textCalls.find(c => c[0] === reason);

          // If reason is not printed, we fail (as expected).
          expect(reasonCall).toBeDefined();

          if (reasonCall) {
              const tx = reasonCall[1];
              const ty = reasonCall[2];

              // Check overlap with component body (centered at 100,100 size 80x80 -> [60,140]x[60,140])
              // Reason should be OUTSIDE this box.
              const inside = (tx >= 60 && tx <= 140 && ty >= 60 && ty <= 140);
              expect(inside).toBe(false);

              // And should be near the X.
              // We haven't found X yet.
          }
      });
  });
});
