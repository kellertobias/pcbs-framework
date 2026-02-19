
import { describe, it, expect } from 'vitest';
import { initOCC } from '../synth/3d/occ';

describe('OpenCascade Minimal', () => {
    it('should initialize OpenCascade', async () => {
        console.log('Test: Calling initOCC...');
        const OC = await initOCC();
        console.log('Test: initOCC finished');
        expect(OC).toBeDefined();
        expect(OC.gp_Pnt).toBeDefined();
    }, 30000);
});
