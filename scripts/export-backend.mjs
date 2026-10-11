/** Export an independent backend and the exact model contracts used by this frontend. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const target = resolve(process.argv[2] ?? join(root, '../gym-studio-backend'));
if (target === root) throw Error('Backend must have its own folder.');
const seen = new Set();
const location = path => path.startsWith('server/') ? 'src/' + path.slice(7) : 'shared/' + path;
async function copy(path) {
  if (seen.has(path)) return;
  seen.add(path);
  let text = await readFile(join(root, path), 'utf8');
  const imports = [...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)];
  for (const item of imports) {
    const source = relative(root, resolve(root, dirname(path), item[1])).replaceAll('\\', '/');
    if (!source.endsWith('.ts')) continue;
    await copy(source);
    let replacement = relative(dirname(join(target, location(path))), join(target, location(source))).replaceAll('\\', '/');
    if (!replacement.startsWith('.')) replacement = './' + replacement;
    text = text.replaceAll(`'${item[1]}'`, `'${replacement}'`).replaceAll(`"${item[1]}"`, `"${replacement}"`);
  }
  const output = join(target, location(path));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, text);
}
await copy('server/backend-main.ts');
await copy('server/studio.test.ts');
await copy('server/server.test.ts');
await copy('server/parts-api.test.ts');
await copy('server/backend-modules.test.ts');
await copy('server/backend-config.test.ts');
await mkdir(join(target, 'src/migrations'), { recursive: true });
await copyFile(join(root, 'server/migrations/001-studio.sql'), join(target, 'src/migrations/001-studio.sql'));
await writeFile(join(target, 'LICENSE'), 'Shared gym-equipment model code: MIT, Wes Bos (https://wesbos.com/). Backend integration follows the same MIT license. See the source project for original attribution.\n');
await writeFile(join(target, 'shared/README.md'), 'Model contracts exported from gym-equipment. These validate gym documents and equipment templates on the server. No frontend runtime or sibling checkout is required. Refresh with npm run backend:export in the frontend after changing model contracts.\n');
const frontend = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const pick = names => Object.fromEntries(names.map(name => [name, frontend.dependencies[name] ?? frontend.devDependencies[name]]));
await writeFile(join(target, 'package.json'), JSON.stringify({ name: 'gym-studio-backend', version: '0.1.0', private: true, type: 'module', engines: { node: '>=22' }, scripts: {
  dev: 'node --watch --watch-preserve-output --env-file-if-exists=.env --import tsx src/backend-main.ts',
  build: 'npm run typecheck && esbuild src/backend-main.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/backend-main.mjs && node scripts/copy-migrations.mjs',
  start: 'node --env-file-if-exists=.env dist/backend-main.mjs',
  typecheck: 'tsc --noEmit', test: 'tsx --test src/*.test.ts',
}, dependencies: { ...pick(['express','pg','nodemailer','three','manifold-3d']), '@nestjs/common': '^11.1.0', '@nestjs/core': '^11.1.0', '@nestjs/platform-express': '^11.1.0', 'reflect-metadata': '^0.2.2', rxjs: '^7.8.2' }, devDependencies: { ...pick(['@electric-sql/pglite','tsx','typescript','@types/node','@types/express','@types/pg','@types/nodemailer','@types/three']), esbuild: '^0.28.2' } }, null, 2));
await writeFile(join(target, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, lib: ['ES2023','DOM'], types: ['node'] }, include: ['src/**/*.ts','shared/**/*.ts'] }, null, 2));
await mkdir(join(target, 'scripts'), { recursive: true });
await writeFile(join(target,'scripts/copy-migrations.mjs'), "import {cp} from 'node:fs/promises'; await cp('src/migrations','dist/migrations',{recursive:true});\n");
await writeFile(join(target,'.gitignore'), 'node_modules/\ndist/\n.data/\n.env\n*.log\n');
await writeFile(join(target,'.dockerignore'), 'node_modules\ndist\n.data\n.env\n.git\n');
await writeFile(join(target,'.env.example'), `SITE_URL=http://127.0.0.1:5173\nPORT=8788\nNODE_ENV=development\n# Leave blank to use persistent embedded PostgreSQL locally.\nDATABASE_URL=\nDATA_DIR=.data\nREQUIRE_EMAIL_VERIFICATION=false\n# Blank locally selects demo only when no real provider key is present.\nAI_PROVIDER=\nOPENROUTER_API_KEY=\nANTHROPIC_API_KEY=\nAI_MODEL=\nAI_USER_DAILY_LIMIT=20\nDAILY_LIMIT=100\nAI_CONCURRENCY=2\nSMTP_HOST=\nSMTP_PORT=587\nSMTP_SECURE=false\nSMTP_USER=\nSMTP_PASSWORD=\nSMTP_FROM=\nTRUST_PROXY=0\n`);
await writeFile(join(target,'Dockerfile'), `FROM node:24-bookworm-slim AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\nFROM node:24-bookworm-slim\nWORKDIR /app\nENV NODE_ENV=production PORT=8788\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY --from=build /app/dist ./dist\nUSER node\nEXPOSE 8788\nHEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:8788/api/studio/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"\nCMD ["node","dist/backend-main.mjs"]\n`);
console.log(`Independent backend exported to ${target} (${seen.size} source files, including shared model validators).`);
