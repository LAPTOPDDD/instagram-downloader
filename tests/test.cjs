'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const M = require('../media.js');
let tests = 0;
function test(name, fn) { fn(); tests++; console.log('✓', name); }
const photo = { media_type: 1, image_versions2: { candidates: [
  { url: 'https://scontent.cdninstagram.com/small.jpg', width: 100, height: 100 },
  { url: 'https://scontent.cdninstagram.com/large.jpg', width: 1080, height: 1350 }
] } };
const video = { media_type: 2, ...{ video_versions: [
  { url: 'https://video.xx.fbcdn.net/small.mp4', width: 360, height: 640 },
  { url: 'https://video.xx.fbcdn.net/large.mp4', width: 1080, height: 1920 }
] }, image_versions2: photo.image_versions2 };
test('Shortcode preserves large integer precision', () => {
  assert.equal(M.shortcodeToId('B'), '1');
  assert.equal(M.shortcodeToId('BA'), '64');
  assert.equal(M.shortcodeToId('___________'), ((64n ** 11n) - 1n).toString());
  assert.equal(M.shortcodeToId('../x'), null);
});
test('URL allowlist rejects misleading hosts, blob and credentials', () => {
  for (const u of ['javascript:alert(1)', 'blob:https://instagram.com/a', 'https://cdninstagram.com.evil.test/x', 'https://user:password@instagram.com/x', 'http://instagram.com/a', 'https://instagram.com:444/a']) assert.equal(M.safeUrl(u), null);
  assert.ok(M.safeUrl('https://scontent.cdninstagram.com/a.jpg?x=1'));
});
test('Highest-resolution photo and video, original slide order', () => {
  const r = M.extract({ carousel_media: [photo, video], carousel_media_count: 2 });
  assert.equal(r.media.length, 2); assert.equal(r.expected, 2);
  assert.equal(r.media[0].url, 'https://scontent.cdninstagram.com/large.jpg');
  assert.equal(r.media[1].url, 'https://video.xx.fbcdn.net/large.mp4');
  assert.equal(r.media[1].index, 2);
});
test('Video poster is not reported as a photo', () => {
  assert.equal(M.extract({ media_type: 2, image_versions2: photo.image_versions2 }).media.length, 0);
});
test('GraphQL sidecars supported', () => {
  const r = M.extract({ edge_sidecar_to_children: { edges: [{ node: { display_url: 'https://a.cdninstagram.com/a.jpg' } }, { node: { is_video: true, video_url: 'https://a.fbcdn.net/a.mp4' } }] } });
  assert.deepEqual(r.media.map(x => x.kind), ['image', 'video']);
});
test('Missing carousel slide is detectable and keeps original numbering', () => {
  const r = M.extract({ carousel_media: [photo, { media_type: 2 }, video] });
  assert.equal(r.expected, 3); assert.deepEqual(r.media.map(x => x.index), [1, 3]);
});
test('Find only current post in nested and stringified data', () => {
  const target = { ...video, code: 'ABC' };
  assert.equal(M.findItem({ data: [{ ...photo, code: 'OTHER' }, target] }, 'ABC'), target);
  assert.equal(M.findItem({ payload: JSON.stringify(target) }, 'ABC').code, 'ABC');
  assert.equal(M.findItem({ unrelated: photo }, 'ABC'), null);
});
async function feedTest() {
  function element() {
    return { children: [], style: {}, attrs: {}, textContent: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      append(...children) { this.children.push(...children); },
      addEventListener(type, fn) { this[type] = fn; } };
  }
  function article(code) {
    const link = { href: `https://www.instagram.com/p/${code}/` };
    return { isConnected: true, bar: null,
      querySelector(q) {
        if (q === 'time') return { closest: () => link };
        if (q === '[data-instasave-select]') return this.bar;
        return null;
      },
      querySelectorAll(q) { return q === 'a[href]' ? [link] : []; },
      append(bar) { this.bar = bar; }
    };
  }
  const articles = [article('OTHER'), article('ABC')];
  let listener, requests = 0;
  const context = {
    InstaMedia: M, URL, AbortController, setTimeout, clearTimeout,
    location: { pathname: '/', href: 'https://www.instagram.com/' },
    MutationObserver: class { observe() {} },
    document: { documentElement: {}, querySelector: () => null,
      querySelectorAll(q) {
        if (q === 'article') return articles;
        if (q.includes('[role="status"]')) return articles.map(a => a.bar?.children[1]).filter(Boolean);
        return [];
      }, createElement: element },
    browser: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } },
    fetch: async url => { requests++; assert.equal(url, `/api/v1/media/${M.shortcodeToId('ABC')}/info/`); return { ok: true, json: async () => ({ items: [{ code: 'ABC', carousel_media: [photo, video] }] }) }; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8'), context);
  assert.equal(requests, 0);
  assert.equal((await listener({ type: 'SCAN_POST' })).ok, false);
  assert.equal(requests, 0);
  assert.ok(articles[0].bar && articles[1].bar);
  articles[1].bar.children[0].click({ preventDefault() {}, stopPropagation() {} });
  const result = await listener({ type: 'SCAN_POST' });
  assert.equal(result.ok, true); assert.equal(result.data.code, 'ABC'); assert.equal(result.data.media.length, 2);
  assert.equal(context.location.pathname, '/');
  console.log('✓ Feed button selects correct carousel without navigation or automatic API requests'); tests++;
  articles[1].isConnected = false;
  assert.equal((await listener({ type: 'SCAN_POST' })).ok, false);
  console.log('✓ Removed feed post cannot remain silently selected'); tests++;
}
async function integration() {
  let listener;
  const context = { InstaMedia: M, location: { pathname: '/p/ABC/', href: 'https://www.instagram.com/p/ABC/' }, document: { querySelectorAll: () => [], querySelector: () => null },
    browser: { runtime: { onMessage: { addListener: fn => { listener = fn; } } } },
    fetch: async () => ({ ok: true, json: async () => ({ items: [{ code: 'ABC', carousel_media: [photo, video] }] }) }),
    URL, AbortController, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8'), context);
  const result = await listener({ type: 'SCAN_POST' });
  assert.equal(result.ok, true); assert.equal(result.data.complete, true); assert.equal(result.data.media.length, 2);
  console.log('✓ Content script: API response → complete mixed carousel'); tests++;
  context.location.pathname = '/some-profile/';
  assert.equal((await listener({ type: 'SCAN_POST' })).ok, false);
  console.log('✓ Content script rejects unselected profile page'); tests++;
  const pasted = await listener({ type: 'SCAN_POST', code: 'ABC' });
  assert.equal(pasted.ok, true); assert.equal(pasted.data.media.length, 2);
  console.log('✓ Pasted permalink downloads carousel without opening a new tab'); tests++;
  await feedTest();
  let bgListener; const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), {
    URL, browser: { runtime: { id: 'test', onMessage: { addListener: fn => { bgListener = fn; } } }, downloads: { download: async o => { calls.push(o); return calls.length; } } }
  });
  const r = await bgListener({ type: 'DOWNLOAD_MEDIA', code: 'ABC', media: M.extract({ carousel_media: [photo, video] }).media }, { id: 'test' });
  assert.equal(r.accepted.length, 2);
  assert.equal(calls[0].filename, 'Instagram/ABC/ABC_01.jpg');
  assert.equal(calls[1].filename, 'Instagram/ABC/ABC_02.mp4');
  const bad = await bgListener({ type: 'DOWNLOAD_MEDIA', code: 'ABC', media: [{ url: 'https://evil.test/x', kind: 'image', index: 1 }] }, { id: 'test' });
  assert.equal(bad.ok, false); assert.equal(calls.length, 2);
  console.log('✓ Background validates hosts and download filenames'); tests++;
  console.log(`\n${tests} tests passed. Live Instagram not tested.`);
}
integration().catch(e => { console.error(e); process.exitCode = 1; });
