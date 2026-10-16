'use strict';
const $ = id => document.getElementById(id);
let post = null;
function status(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}
function selected() {
  return post ? [...document.querySelectorAll('.media-check:checked')].map(c => post.media[Number(c.value)]) : [];
}
function updateSelection() {
  const count = selected().length;
  $('download').disabled = count === 0;
  $('download').textContent = `Скачать выбранное · ${count}`;
  $('select-all').checked = !!post && count === post.media.length;
  $('select-all').indeterminate = count > 0 && count < (post?.media.length || 0);
}
function render(data) {
  post = data;
  $('list').replaceChildren();
  for (const [i, item] of data.media.entries()) {
    const label = document.createElement('label'); label.className = 'media-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.className = 'media-check'; checkbox.value = String(i); checkbox.checked = true;
    checkbox.addEventListener('change', updateSelection);
    label.append(checkbox);
    const placeholder = document.createElement('span'); placeholder.className = 'thumb placeholder';
    placeholder.textContent = item.kind === 'video' ? '▶' : '▧';
    if (item.thumbnail) {
      const img = document.createElement('img'); img.className = 'thumb'; img.alt = ''; img.src = item.thumbnail; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.replaceWith(placeholder), { once: true });
      label.append(img);
    } else label.append(placeholder);
    const text = document.createElement('div');
    const title = document.createElement('div'); title.className = 'media-name';
    title.textContent = `${String(item.index).padStart(2, '0')} / ${item.kind === 'video' ? 'Видео' : 'Фото'}`;
    const meta = document.createElement('div'); meta.className = 'media-meta';
    meta.textContent = item.width && item.height ? `${item.width} × ${item.height}` : 'Доступный файл';
    text.append(title, meta); label.append(text); $('list').append(label);
  }
  $('results').hidden = false;
  $('warning').hidden = !data.warning;
  $('warning').textContent = data.warning || '';
  $('count').textContent = `${data.media.length} шт.`;
  updateSelection();
  status(`${data.code} · ${data.source}`);
}
async function scan() {
  $('scan').disabled = true; $('results').hidden = true; post = null;
  status('Ищем файлы… Это может занять до 12 секунд.');
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    let url;
    try { url = new URL(tab?.url || ''); } catch (_) { throw new Error('Откройте публикацию на instagram.com.'); }
    if (!['www.instagram.com', 'instagram.com'].includes(url.hostname) || url.protocol !== 'https:') throw new Error('Откройте публикацию на instagram.com.');
    let code = null;
    const pasted = $('post-url').value.trim();
    if (pasted) {
      let link;
      try { link = new URL(pasted); } catch (_) { throw new Error('Вставьте полную ссылку https://www.instagram.com/p/…'); }
      if (!['www.instagram.com', 'instagram.com'].includes(link.hostname) || link.protocol !== 'https:') throw new Error('Нужна ссылка на публикацию Instagram.');
      code = link.pathname.match(/^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
      if (!code) throw new Error('В ссылке должен быть адрес поста /p/… или видео /reel/…');
    }
    let response;
    try { response = await browser.tabs.sendMessage(tab.id, { type: 'SCAN_POST', code }); }
    catch (_) { throw new Error('Обновите вкладку Instagram после установки расширения и повторите поиск.'); }
    if (!response?.ok) throw new Error(response?.error || 'Не удалось прочитать страницу.');
    render(response.data);
  } catch (error) { status(error.message, true); }
  finally { $('scan').disabled = false; }
}
$('scan').addEventListener('click', scan);
$('select-all').addEventListener('change', () => {
  for (const c of document.querySelectorAll('.media-check')) c.checked = $('select-all').checked;
  updateSelection();
});
$('save-as').addEventListener('change', () => browser.storage.local.set({ saveAs: $('save-as').checked }).catch(() => {}));
$('download').addEventListener('click', async () => {
  const media = selected();
  if (!post || !media.length) return;
  $('download').disabled = true; $('scan').disabled = true;
  status('Передаём файлы в загрузки Firefox…');
  try {
    const result = await browser.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA', code: post.code, media, saveAs: $('save-as').checked });
    if (!result?.ok) throw new Error(result?.error || result?.errors?.join(' ') || 'Загрузка не началась.');
    status(`Передано в загрузки Firefox: ${result.accepted.length}. Проверьте завершение в меню загрузок (Ctrl+J).${result.errors.length ? ' Ошибки: ' + result.errors.join(' ') : ''}`, result.errors.length > 0);
  } catch (error) { status(error.message, true); }
  finally { $('scan').disabled = false; updateSelection(); }
});
browser.storage.local.get('saveAs').then(p => { $('save-as').checked = Boolean(p.saveAs); }).catch(() => {});
