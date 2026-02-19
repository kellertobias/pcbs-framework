
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

import { initOpenCascade } from 'opencascade.js';

async function test() {
  console.log('Starting OpenCascade initialization...');
  try {
    const OC = await initOpenCascade({
        module: {
            locateFile: (path) => {
                const res = require.resolve('opencascade.js/dist/' + path);
                console.log(`Locating ${path} -> ${res}`);
                return res;
            }
        }
    });
    console.log('SUCCESS: OpenCascade initialized');
    console.log('OC Keys:', Object.keys(OC).length);
    process.exit(0);
  } catch (err) {
    console.error('FAILURE:', err);
    process.exit(1);
  }
}

test();
