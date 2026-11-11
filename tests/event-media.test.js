import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validPoster} from '../lib/event-media.js';
test('poster accepts bounded raster data and rejects SVG, external URLs and forged types',()=>{
 assert.equal(validPoster(''),true);
 assert.equal(validPoster('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvZkAAAAASUVORK5CYII='),true);
 for(const bad of ['https://example.test/a.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,'+Buffer.from('not an image here').toString('base64'),'x'.repeat(1100001)])assert.equal(validPoster(bad),false);
});
