import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStaticServer, PROJECT_ROOT } from '../tools/serve.mjs';

let srv;
let fixtureDir;
let url;
const contents = Buffer.from('0123456789');

before(async () => {
  fixtureDir = await fs.mkdtemp(path.join(PROJECT_ROOT, '.range-test-'));
  await fs.writeFile(path.join(fixtureDir, 'sample.mp4'), contents);
  await fs.writeFile(path.join(fixtureDir, 'empty.mp4'), '');
  await fs.writeFile(path.join(fixtureDir, 'sample.txt'), contents);
  srv = await startStaticServer();
  url = `${srv.baseUrl}/${path.basename(fixtureDir)}/sample.mp4`;
});

after(async () => {
  if (srv) await srv.close();
  if (fixtureDir) await fs.rm(fixtureDir, { recursive: true, force: true });
});

for (const [range, expected, contentRange] of [
  ['bytes=2-5', '2345', 'bytes 2-5/10'],
  ['bytes=7-', '789', 'bytes 7-9/10'],
  ['bytes=7-99', '789', 'bytes 7-9/10'],
  ['bytes=-4', '6789', 'bytes 6-9/10'],
  ['bytes=-20', '0123456789', 'bytes 0-9/10'],
]) {
  test(`serves ${range}`, async () => {
    const res = await fetch(url, { headers: { Range: range } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), contentRange);
    assert.equal(res.headers.get('content-length'), String(expected.length));
    assert.equal(await res.text(), expected);
  });
}

for (const range of ['bytes=10-', 'bytes=8-2', 'bytes=-0']) {
  test(`rejects unsatisfiable ${range}`, async () => {
    const res = await fetch(url, { headers: { Range: range } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */10');
    assert.equal(await res.text(), '');
  });
}

for (const range of [null, 'bytes=garbage', 'bytes=-', 'items=2-4', 'bytes=0-1,4-5']) {
  test(`serves the whole file for ${range ?? 'no Range header'}`, async () => {
    const res = await fetch(url, range ? { headers: { Range: range } } : {});
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-range'), null);
    assert.equal(await res.text(), contents.toString());
  });
}

for (const range of ['bytes=0-', 'bytes=-4']) {
  test(`rejects ${range} for an empty MP4`, async () => {
    const res = await fetch(url.replace('sample.mp4', 'empty.mp4'), {
      headers: { Range: range },
    });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */0');
    assert.equal(await res.text(), '');
  });
}

test('leaves non-MP4 responses unchanged', async () => {
  const res = await fetch(url.replace('sample.mp4', 'sample.txt'), {
    headers: { Range: 'bytes=-4' },
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), contents.toString());
});
