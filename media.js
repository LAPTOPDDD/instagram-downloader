'use strict';
// Shared pure helpers: no page execution, eval, or external libraries.
(function (root) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function safeUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const u = new URL(value);
      const hosts = ['instagram.com', 'cdninstagram.com', 'fbcdn.net'];
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
      return hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h)) ? u.href : null;
    } catch (_) { return null; }
  }
  function shortcodeToId(code) {
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(code || '')) return null;
    let n = 0n;
    for (const c of code) n = n * 64n + BigInt(alphabet.indexOf(c));
    return n.toString();
  }
  function best(list) {
    return (Array.isArray(list) ? list : []).filter(x => x && safeUrl(x.url || x.src))
      .sort((a, b) => ((b.width || b.config_width || 0) * (b.height || b.config_height || 0)) - ((a.width || a.config_width || 0) * (a.height || a.config_height || 0)))[0];
  }
  function one(item) {
    if (!item || typeof item !== 'object') return null;
    const v = best(item.video_versions) || best(item.video_resources);
    const video = safeUrl(v?.url || v?.src || item.video_url);
    const p = best(item.image_versions2?.candidates) || best(item.display_resources);
    const image = safeUrl(p?.url || p?.src || item.display_url || item.display_src || item.thumbnail_src);
    if (video) return { kind: 'video', url: video, thumbnail: image, width: v?.width || item.dimensions?.width || null, height: v?.height || item.dimensions?.height || null };
    // Never pretend a video poster is the video itself.
    if (item.is_video || item.media_type === 2 || item.__typename === 'GraphVideo') return null;
    if (image) return { kind: 'image', url: image, thumbnail: image, width: p?.width || item.dimensions?.width || null, height: p?.height || item.dimensions?.height || null };
    return null;
  }
  function extract(item) {
    const children = item?.carousel_media || item?.edge_sidecar_to_children?.edges?.map(e => e.node);
    const raw = Array.isArray(children) ? children : [item];
    const media = raw.map((x, index) => { const m = one(x); return m ? { ...m, index: index + 1 } : null; }).filter(Boolean);
    return { media, expected: item?.carousel_media_count || raw.length, carousel: Array.isArray(children) };
  }
  function findItem(rootValue, code) {
    const id = shortcodeToId(code);
    const stack = [rootValue];
    let steps = 0;
    while (stack.length && ++steps < 100000) {
      const obj = stack.pop();
      if (!obj || typeof obj !== 'object') continue;
      if ((obj.shortcode === code || obj.code === code || String(obj.pk || '') === id || String(obj.id || '').split('_')[0] === id) &&
          (obj.carousel_media || obj.edge_sidecar_to_children || obj.video_versions || obj.video_url || obj.display_url || obj.image_versions2 || obj.display_resources)) return obj;
      for (const value of Object.values(obj)) {
        if (value && typeof value === 'object') stack.push(value);
        // Instagram's bootstrap sometimes embeds another JSON document as text.
        else if (typeof value === 'string' && value.length < 12000000 && /^[\[{]/.test(value) && /shortcode|carousel_media|video_versions|display_url/.test(value)) {
          try { stack.push(JSON.parse(value)); } catch (_) {}
        }
      }
    }
    return null;
  }
  const api = { safeUrl, shortcodeToId, best, extract, findItem };
  root.InstaMedia = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
