import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';

const walk = dir => readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):[`${dir}/${e.name}`]);
const endpoints = walk('api').filter(f=>f.endsWith('.js')).sort();
assert.deepEqual(endpoints,['api/admin.js','api/auth.js','api/auth/bootstrap.js','api/member.js','api/ops.js','api/public.js']);
assert(endpoints.length<=12, 'Serverless function limit');
for (const file of [...endpoints,...walk('lib'),...walk('assets'),'service-worker.js'].filter(f=>f.endsWith('.js'))) {
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
}
for (const file of ['index.html','my-soc.html','athlete-app.html','academy-app.html','region-app.html','referee-app.html','ceo-app.html','tournament-ops.html','service-worker.js','manifest.webmanifest']) assert(existsSync(file),file);
for (const file of ['vercel.json','manifest.webmanifest','package.json','package-lock.json']) JSON.parse(readFileSync(file,'utf8'));
const pages = readdirSync('.').filter(f=>f.endsWith('.html'));
for (const file of pages) {
  const html = readFileSync(file,'utf8');
  const library = html.indexOf('<script src="/assets/soc.js"');
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    new Script(match[1], {filename:file});
    if (/SOC\./.test(match[1])) assert(library>=0&&library<match.index,`${file}: SOC must load before inline code`);
  }
}
console.log(`Validated ${endpoints.length} API functions and ${pages.length} HTML pages.`);
