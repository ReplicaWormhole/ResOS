import { copyFile } from 'node:fs/promises';
import { URL } from 'node:url';

for (const name of ['index.html', 'styles.css']) {
  await copyFile(
    new URL(`../src/renderer/${name}`, import.meta.url),
    new URL(`../dist/renderer/${name}`, import.meta.url),
  );
}
