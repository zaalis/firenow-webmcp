import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // public/maplibre : copie du worker officiel MapLibre (voir scripts/sync-maplibre-worker.mjs),
  // un artefact minifie tiers qu'on ne lint pas.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'public/maplibre/**']),
]);

export default eslintConfig;
