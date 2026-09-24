const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const distMain = path.join(root, 'dist/main');
const distPreload = path.join(root, 'dist/preload');
const distShared = path.join(root, 'dist/shared');

const externals = [
  'electron',
  'dictionary-en',
  'dictionary-en-gb',
  'dictionary-fr',
  'dictionary-de',
  'dictionary-es',
  'dictionary-it',
  'dictionary-nl',
  'dictionary-pt',
  'dictionary-sv',
  'dictionary-da',
  'dictionary-nb',
  'dictionary-cs',
  'dictionary-pl',
  'dictionary-hu',
  'dictionary-ro',
  'dictionary-tr',
  'dictionary-ru',
  'dictionary-uk',
  'playwright',
];

async function build() {
  fs.rmSync(distMain, { recursive: true, force: true });
  fs.rmSync(distPreload, { recursive: true, force: true });
  fs.mkdirSync(distMain, { recursive: true });
  fs.mkdirSync(distPreload, { recursive: true });
  fs.mkdirSync(distShared, { recursive: true });

  fs.copyFileSync(
    path.join(root, 'src/shared/common-places.json'),
    path.join(distShared, 'common-places.json'),
  );

  const common = {
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    bundle: true,
    sourcemap: true,
    external: externals,
    logLevel: 'info',
  };

  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src/main/index.js')],
    outfile: path.join(distMain, 'index.js'),
  });

  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src/preload/preload.js')],
    outfile: path.join(distPreload, 'preload.js'),
  });

  console.log('Bundled main and preload');
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
