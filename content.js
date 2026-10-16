'use strict';
(() => {
  const M = globalThis.InstaMedia;
  let pending = null;
  let selectedPost = null;
  function pathCode(path) {
    return path.match(/^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] || null;
  }
  function linkCode(link) {
    try {
      const url = new URL(link.href, location.href);
      return ['www.instagram.com', 'instagram.com'].includes(url.hostname) ? pathCode(url.pathname) : null;
    } catch (_) { return null; }
  }
  function articleCode(article) {
    // The timestamp's permalink identifies the post, not a tagged/related post.
    const dated = article.querySelector('time')?.closest('a[href]');
    const datedCode = dated && linkCode(dated);
    if (datedCode) return datedCode;
    const codes = new Set([...article.querySelectorAll('a[href]')].map(linkCode).filter(Boolean));
    return codes.size === 1 ? [...codes][0] : null;
  }
  function targetFor(requestedCode) {
    const articles = [...document.querySelectorAll('article')];
    const direct = pathCode(location.pathname);
    const validSelection = selectedPost && selectedPost.page === location.href && selectedPost.article.isConnected && articleCode(selectedPost.article) === selectedPost.code;
    const code = requestedCode || (validSelection ? selectedPost.code : direct);
    if (code) {
      const container = articles.find(a => articleCode(a) === code) || (direct === code && articles.length === 1 ? articles[0] : null);
      return { code, container };
    }
    const dialog = document.querySelector('[role="dialog"]');
    const dialogCode = dialog && articleCode(dialog);
    return dialogCode ? { code: dialogCode, container: dialog } : null;
  }
  function installPostButtons() {
    for (const article of document.querySelectorAll('article')) {
      const code = articleCode(article);
      if (!code || article.querySelector('[data-instasave-select]')) continue;
      const bar = document.createElement('div');
      bar.setAttribute('data-instasave-select', 'true');
      bar.style.cssText = 'padding:12px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-top:1px solid #8884;';
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = '↓ Выбрать для скачивания · InstaSave';
      button.style.cssText = 'font:600 12px system-ui,sans-serif;border:1px solid #9572cf;background:#c6afff;color:#211433;padding:10px 14px;border-radius:9px;cursor:pointer;';
      const note = document.createElement('span');
      note.style.cssText = 'font:12px system-ui,sans-serif;color:#888;';
      note.setAttribute('role', 'status');
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        const current = articleCode(article);
        if (!current) { note.textContent = 'Не найдена ссылка поста. Скопируйте её через меню ⋯.'; return; }
        selectedPost = { code: current, article, page: location.href };
        for (const old of document.querySelectorAll('[data-instasave-select] [role="status"]')) old.textContent = '';
        note.textContent = `Выбран ${current}. Нажмите значок InstaSave → «Найти медиа».`;
      });
      bar.append(button, note); article.append(bar);
    }
  }
  if (typeof MutationObserver !== 'undefined') {
    let timer = null;
    const observer = new MutationObserver(() => {
      if (timer === null) timer = setTimeout(() => { timer = null; installPostButtons(); }, 350);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    installPostButtons();
  }
  function fromScripts(code) {
    for (const script of document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')) {
      const text = script.textContent;
      if (!text || text.length > 12000000) continue;
      try {
        const item = M.findItem(JSON.parse(text), code);
        if (item) {
          const result = M.extract(item);
          if (result.media.length && result.media.length === result.expected) return result;
        }
      } catch (_) { /* Some scripts are not JSON. */ }
    }
    return null;
  }
  async function fromApi(code) {
    const id = M.shortcodeToId(code);
    if (!id) throw new Error('Некорректный адрес публикации.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      // One read-only request using the visitor's existing Instagram session.
      // This undocumented endpoint can change; no login or access bypass is attempted.
      const response = await fetch(`/api/v1/media/${id}/info/`, {
        method: 'GET', credentials: 'include', signal: controller.signal,
        headers: { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error('Instagram ограничил частоту запросов. Попробуйте позже.');
        if (response.status === 401 || response.status === 403) throw new Error('Instagram не разрешил запрос. Проверьте вход в аккаунт.');
        throw new Error(`Instagram ответил HTTP ${response.status}.`);
      }
      const data = await response.json();
      const item = M.findItem(data, code);
      if (!item) throw new Error('Instagram не вернул данные этой публикации.');
      const result = M.extract(item);
      if (!result.media.length) throw new Error('В ответе нет прямых ссылок на медиа.');
      return result;
    } finally { clearTimeout(timeout); }
  }
  function fromDom(container) {
    // Use only the explicitly selected post, never unrelated feed items.
    if (!container || !container.isConnected) return [];
    const found = [];
    for (const video of container.querySelectorAll('video')) {
      const url = M.safeUrl(video.currentSrc || video.src || video.querySelector('source')?.src);
      if (url) found.push({ kind: 'video', url, thumbnail: M.safeUrl(video.poster) });
    }
    // A video's poster must not appear as a separate downloadable photo.
    if (!container.querySelector('video')) {
      for (const img of container.querySelectorAll('img')) {
        if ((img.naturalWidth || img.width) < 300 || (img.naturalHeight || img.height) < 250) continue;
        if (img.closest('header')) continue;
        const url = M.safeUrl(img.currentSrc || img.src);
        if (url) found.push({ kind: 'image', url, thumbnail: url });
      }
    }
    const seen = new Set();
    return found.filter(x => { if (seen.has(x.url)) return false; seen.add(x.url); return true; }).map((x, i) => ({ ...x, index: i + 1 }));
  }
  async function scan(requestedCode) {
    const target = targetFor(requestedCode);
    if (!target) throw new Error('В ленте нажмите под нужным постом «Выбрать для скачивания · InstaSave», затем повторите поиск. Или вставьте ссылку поста в поле расширения.');
    const { code, container } = target;
    let result = fromScripts(code);
    let source = 'Данные страницы';
    let apiError = '';
    if (!result) {
      try { result = await fromApi(code); source = 'Ответ Instagram'; }
      catch (error) { apiError = error.name === 'AbortError' ? 'Instagram не ответил за 12 секунд.' : error.message; }
    }
    if (targetFor(requestedCode)?.code !== code) throw new Error('Страница изменилась. Повторите поиск.');
    if (!result) {
      const media = fromDom(container);
      if (!media.length) throw new Error(`${apiError} Не удалось найти доступные файлы. Дождитесь загрузки публикации и повторите поиск. Для видео попробуйте запустить воспроизведение.`);
      return { code, media, source: 'Видимые элементы страницы', complete: false, warning: `${apiError} Показаны только найденные на экране файлы. Полнота карусели не подтверждена. Переключите слайд и повторите поиск для других элементов.` };
    }
    const complete = result.media.length === result.expected;
    return { code, media: result.media, source, complete, warning: complete ? '' : `Найдено ${result.media.length} из ${result.expected}. Для некоторых элементов Instagram не предоставил прямую ссылку.` };
  }
  browser.runtime.onMessage.addListener(message => {
    if (message?.type !== 'SCAN_POST') return;
    if (message.code && !/^[A-Za-z0-9_-]{1,24}$/.test(message.code)) return Promise.resolve({ ok: false, error: 'Некорректная ссылка публикации.' });
    if (!pending) pending = scan(message.code || null).then(data => ({ ok: true, data })).catch(error => ({ ok: false, error: error.message })).finally(() => { pending = null; });
    return pending;
  });
})();
