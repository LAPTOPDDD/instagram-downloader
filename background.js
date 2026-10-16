'use strict';
browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'DOWNLOAD_MEDIA' || sender.id !== browser.runtime.id) return;
  return downloadBatch(message);
});
function allowedUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      ['instagram.com', 'cdninstagram.com', 'fbcdn.net'].some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch (_) { return false; }
}
async function downloadBatch({ code, media, saveAs }) {
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(code || '') || !Array.isArray(media) || !media.length || media.length > 50) {
    return { ok: false, error: 'Некорректный список файлов.' };
  }
  const accepted = [], errors = [];
  for (const item of media) {
    if (!allowedUrl(item.url) || !['video', 'image'].includes(item.kind) || !Number.isInteger(item.index) || item.index < 1 || item.index > 100) {
      errors.push('Недопустимый адрес или тип файла.'); continue;
    }
    const path = new URL(item.url).pathname;
    const imageExt = path.match(/\.(jpe?g|png|webp|avif)$/i)?.[1]?.toLowerCase() || 'jpg';
    const ext = item.kind === 'video' ? 'mp4' : imageExt;
    const filename = `Instagram/${code}/${code}_${String(item.index).padStart(2, '0')}.${ext}`;
    try {
      const id = await browser.downloads.download({ url: item.url, filename, saveAs: Boolean(saveAs), conflictAction: 'uniquify' });
      accepted.push({ id, filename });
    } catch (error) { errors.push(`Элемент ${item.index}: ${error.message}`); }
  }
  return { ok: accepted.length > 0, accepted, errors };
}
