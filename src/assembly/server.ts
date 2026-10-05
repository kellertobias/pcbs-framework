import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { assemblyPage } from './page';

export function resolveViewerAsset(root: string, url: string): string | undefined {
    let pathname: string;
    try {
        pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
    } catch {
        return undefined;
    }
    if (!pathname.startsWith('/assets/')) return undefined;
    const file = path.resolve(root, `.${pathname}`);
    const assets = path.join(path.resolve(root), 'assets');
    if (!file.startsWith(assets + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
        return undefined;
    const real = fs.realpathSync(file);
    if (!real.startsWith(fs.realpathSync(assets) + path.sep)) return undefined;
    return file;
}
export async function serveAssembly(
    directory: string,
    port = 0,
    refresh?: () => Promise<void>,
    bundleFile = path.join(__dirname, 'viewer-browser.js'),
) {
    let revision = 1;
    const snapshots = new Map([[revision, directory]]);
    let refreshing = false,
        refreshError: string | undefined;
    const revisionState = () => ({ revision, refreshing, error: refreshError });
    if (!fs.existsSync(bundleFile))
        throw new Error('Viewer bundle missing. Build the framework first.');
    const mime: Record<string, string> = {
        '.gltf': 'model/gltf+json',
        '.glb': 'model/gltf-binary',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.wrl': 'model/vrml',
    };
    const server = http.createServer(async (request, response) => {
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cache-Control', 'no-store');
        const pathname = request.url?.split('?')[0];
        if (pathname === '/refresh' && request.method === 'POST' && refresh) {
            const origin = request.headers.origin;
            if (
                (origin && origin !== `http://${request.headers.host}`) ||
                request.headers['content-type'] !== 'application/json'
            ) {
                response.writeHead(403);
                response.end();
                return;
            }
            response.setHeader('Content-Type', 'application/json');
            try {
                await refresh();
                response.end(JSON.stringify(revisionState()));
            } catch (error) {
                response.writeHead(500);
                response.end(JSON.stringify({ ...revisionState(), error: String(error) }));
            }
            return;
        }
        if (request.method !== 'GET') {
            response.writeHead(405);
            response.end();
            return;
        }
        if (pathname === '/revision.json') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(revisionState()));
            return;
        }
        if (pathname === '/') {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(assemblyPage);
            return;
        }
        if (pathname === '/viewer.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end(fs.readFileSync(bundleFile));
            return;
        }
        if (pathname === '/assembly.json') {
            response.setHeader('Content-Type', 'application/json');
            const manifest = JSON.parse(
                fs.readFileSync(path.join(directory, 'assembly.json'), 'utf8'),
            );
            for (const part of manifest.parts)
                if (part.url) part.url = `/revisions/${revision}${part.url}`;
            manifest.revision = revision;
            response.end(JSON.stringify(manifest));
            return;
        }
        const versioned = pathname?.match(/^\/revisions\/(\d+)(\/assets\/.*)$/);
        const snapshot = versioned ? snapshots.get(Number(versioned[1])) : directory;
        const file =
            snapshot &&
            resolveViewerAsset(snapshot, versioned ? versioned[2] : (request.url ?? ''));
        if (!file) {
            response.writeHead(404);
            response.end('Not found');
            return;
        }
        response.setHeader(
            'Content-Type',
            mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        );
        const stream = fs.createReadStream(file);
        stream.on('error', () => {
            if (!response.headersSent) response.writeHead(500);
            response.end();
        });
        stream.pipe(response);
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address() as { port: number };
    return {
        server,
        url: `http://127.0.0.1:${address.port}`,
        replaceDirectory(next: string) {
            directory = next;
            snapshots.set(++revision, next);
            refreshError = undefined;
        },
        setRefreshState(busy: boolean, error?: string) {
            refreshing = busy;
            refreshError = error;
        },
    };
}
