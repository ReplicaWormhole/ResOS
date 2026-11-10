import { copyFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

for (const name of ['index.html', 'styles.css']) {
  await copyFile(
    new URL('../src/renderer/' + name, import.meta.url),
    new URL('../dist/renderer/' + name, import.meta.url),
  );
}

await build({
  entryPoints: [
    fileURLToPath(new URL('../src/renderer/renderer.ts', import.meta.url)),
  ],
  outfile: fileURLToPath(
    new URL('../dist/renderer/renderer.js', import.meta.url),
  ),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
});
