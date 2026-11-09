// Copia os motores e o Bootstrap de node_modules para comprimir/ e registra os hashes.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = join(ROOT, 'node_modules');
const TOOL = join(ROOT, 'comprimir');

const PACKAGES = [
  {
    name: '@okathira/ghostpdl-wasm',
    license: 'AGPL-3.0-or-later',
    files: [['dist/gs.js', 'gs/gs.js'], ['dist/gs.wasm', 'gs/gs.wasm']],
  },
  {
    name: '@neslinesli93/qpdf-wasm',
    license: 'ISC (wrapper); qpdf: Apache-2.0',
    files: [['dist/qpdf.js', 'qpdf/qpdf.js'], ['dist/qpdf.wasm', 'qpdf/qpdf.wasm']],
  },
];

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

const lines = ['# Gerado por tools/vendor.mjs. Não edite.', ''];
for (const pkg of PACKAGES) {
  const base = join(MODULES, pkg.name);
  const { version } = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'));
  lines.push(`${pkg.name}@${version} | ${pkg.license}`);
  for (const [from, to] of pkg.files) {
    const target = join(TOOL, 'vendor', to);
    copy(join(base, from), target);
    lines.push(`  ${to}  sha256:${createHash('sha256').update(readFileSync(target)).digest('hex')}`);
  }
  lines.push('');
}
writeFileSync(join(TOOL, 'vendor', 'VERSIONS.txt'), lines.join('\n'));

copy(join(MODULES, 'bootstrap/LICENSE'), join(TOOL, 'LICENSES', 'Bootstrap-MIT.txt'));
copy(join(MODULES, '@okathira/ghostpdl-wasm/LICENSE'), join(TOOL, 'LICENSES', 'AGPL-3.0.txt'));
copy(join(MODULES, 'bootstrap/dist/css/bootstrap.min.css'), join(TOOL, 'assets', 'bootstrap.min.css'));

console.log('vendor pronto');
