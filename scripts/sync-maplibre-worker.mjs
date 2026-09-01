/* ---------------------------------------------------------------------------
 * Copying the MapLibre worker into public/.
 *
 * MapLibre resolves its worker URL from its own module's `import.meta.url`.
 * Once the package is bundled by Vite that URL points at
 * `/_next/static/chunks/maplibre-gl-worker.mjs`, a file the bundler does not
 * emit: the worker answers 404, no GeoJSON source loads, and no vector layer
 * is rendered at all (the fire disappears, only the DOM markers stay visible).
 *
 * So the official worker is served from public/, and the application calls
 * `setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')`. The worker is an ES
 * module importing `./maplibre-gl-shared.mjs`: the two files have to stay side
 * by side, hence copying the pair.
 * ------------------------------------------------------------------------- */
import { createRequire } from 'node:module';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'maplibre');
const source = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const { version } = JSON.parse(await readFile(join(source, '..', 'package.json'), 'utf8'));
const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

await mkdir(target, { recursive: true });
for (const file of files) await copyFile(join(source, file), join(target, file));
await writeFile(join(target, 'VERSION'), version + '\n');
console.log(`maplibre-gl worker ${version} copied into public/maplibre (${files.join(', ')}).`);
