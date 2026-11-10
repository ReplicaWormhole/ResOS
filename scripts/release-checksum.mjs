import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

const { version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const name = 'resos_' + version + '_amd64.deb';
const release = new URL('../release/', import.meta.url);
const hash = createHash('sha256');
for await (const chunk of createReadStream(new URL(name, release)))
  hash.update(chunk);
await writeFile(
  new URL(name + '.sha256', release),
  hash.digest('hex') + '  ' + name + '\n',
);
