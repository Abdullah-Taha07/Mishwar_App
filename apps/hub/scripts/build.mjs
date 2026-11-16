import {readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {extname, join, resolve} from 'node:path';
import {createHash} from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'dist');
const types = {
  '.apk': 'application/vnd.android.package-archive', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
const textTypes = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest', '.txt']);
const generated = new Set(['sw.js', 'version.json']);
// Keep private source artifacts in the checkout, outside either published target.
const privateName = name => name.startsWith('.')
  || /(?:^|[._-])(?:backups?|bak|old|orig|save|before|env|secrets?|credentials?)(?:[._-]|$)|~(?:\.|$)/i.test(name)
  || /^node_modules$/i.test(name);
function files(directory, prefix = '') {
  const result = [];
  for (const entry of readdirSync(join(root, directory, prefix), {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (privateName(entry.name)) continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...files(directory, relative + '/'));
    else if (entry.isFile() && types[extname(entry.name).toLowerCase()]) result.push(relative);
  }
  return result;
}
const sourceFiles = files('public').filter(file => !generated.has(file));
const hash = createHash('sha256');
function fingerprint(name) {
  const bytes = readFileSync(join(root, name));
  hash.update(name.replaceAll('\\', '/') + '\0');
  hash.update(textTypes.has(extname(name).toLowerCase()) || name.endsWith('.mjs') ? bytes.toString('utf8').replaceAll('\r\n', '\n') : bytes);
  hash.update('\0');
}
for (const file of sourceFiles) fingerprint('public/' + file);
for (const file of files('worker')) fingerprint('worker/' + file);
fingerprint('scripts/sw.template.js');
fingerprint('scripts/build.mjs');
const appVersion = 'v-' + hash.digest('hex').slice(0, 12);
// Captain navigation depends on the live session, so HTML never enters the shell.
const shell = sourceFiles.filter(file => !file.startsWith('admin') && !file.startsWith('downloads/') && /\.(css|js|png|svg|webmanifest)$/.test(file)).map(file => '/' + file);
const sw = readFileSync(join(root, 'scripts/sw.template.js'), 'utf8')
  .replace("const BUILD='__MISHWAR_VERSION__'", `const BUILD='${appVersion}'`)
  .replace('const SHELL=__MISHWAR_ASSETS__', `const SHELL=${JSON.stringify(shell)}`);
if (/__MISHWAR_VERSION__|const SHELL=__MISHWAR_ASSETS__/.test(sw)) throw Error('Service worker template was not fully rendered');
const versionJson = JSON.stringify({version: appVersion});
writeFileSync(join(root, 'public/sw.js'), sw);
writeFileSync(join(root, 'public/version.json'), versionJson);

// Resolve and check the fixed build directory before removing generated output.
if (resolve(output, '..') !== root) throw Error('Build output must stay inside the app');
rmSync(output, {recursive: true, force: true});
for (const directory of ['public', 'server', '.openai']) mkdirSync(join(output, directory), {recursive: true});
const assets = {};
for (const file of [...sourceFiles, 'sw.js', 'version.json']) {
  const bytes = file === 'sw.js' ? Buffer.from(sw) : file === 'version.json' ? Buffer.from(versionJson) : readFileSync(join(root, 'public', file));
  const destination = join(output, 'public', file);
  mkdirSync(resolve(destination, '..'), {recursive: true});
  writeFileSync(destination, bytes);
  // Unlike the rider bundle, captain downloads were served by both targets.
  assets['/' + file] = {type: types[extname(file).toLowerCase()], data: bytes.toString('base64')};
}
writeFileSync(join(output, '.openai/hosting.json'), readFileSync(join(root, '.openai/hosting.json')));
const {build} = await import('esbuild');
await build({entryPoints:[join(root,'worker/index.js')],outfile:join(output,'server/index.js'),bundle:true,platform:'browser',format:'esm',target:'es2022',legalComments:'none',banner:{js:'const ASSETS='+JSON.stringify(assets)+';'}});
console.log('Built Worker and Vercel static output with ' + Object.keys(assets).length + ' safe assets (' + appVersion + ')');
