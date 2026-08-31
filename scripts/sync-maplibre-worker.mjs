/* ---------------------------------------------------------------------------
 * Copie du worker MapLibre dans public/.
 *
 * MapLibre resout l'URL de son worker a partir de `import.meta.url` de son
 * propre module. Une fois le paquet bundle par Vite, cette URL pointe vers
 * `/_next/static/chunks/maplibre-gl-worker.mjs`, un fichier que le bundler
 * n'emet pas : le worker repond 404, aucune source GeoJSON ne se charge et
 * plus aucune couche vectorielle n'est rendue (le feu disparait, seuls les
 * marqueurs DOM restent visibles).
 *
 * On sert donc le worker officiel depuis public/, et l'application appelle
 * `setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')`. Le worker est un module
 * ES qui importe `./maplibre-gl-shared.mjs` : les deux fichiers doivent rester
 * cote a cote, d'ou la copie du couple.
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
console.log(`maplibre-gl worker ${version} copie dans public/maplibre (${files.join(', ')}).`);
