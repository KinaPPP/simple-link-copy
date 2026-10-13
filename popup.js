const SEPARATORS = [' « ', ' | ', ' · ', ' - ', ' – ', ' — ', ' / ', ' ∞ ', '：', ': ', '｜'];

function splitTitle(title) {
  for (const sep of SEPARATORS) {
    const idx = title.lastIndexOf(sep);
    if (idx > 0 && idx < title.length - sep.length) {
      const article = title.slice(0, idx);
      const site = title.slice(idx);

      // 分割が妥当かチェック
      // 1. article側に閉じられていない [ がある場合は無効（タイトル内の区切りに誤マッチ）
      const openBrackets = (article.match(/\[/g) || []).length;
      const closeBrackets = (article.match(/\]/g) || []).length;
      if (openBrackets > closeBrackets) continue;

      // 2. site側（サイト名）が長すぎる場合は怪しい（タイトル本文を誤って切った可能性）
      // サイト名は通常30文字以内
      if (site.trim().length > 30) continue;

      return { article, site, separator: sep };
    }
  }
  return { article: title, site: '', separator: null };
}

// Twitterの重み付けカウント
// 全角文字=2、半角文字=1、URL=23固定 → 全角換算は /2、上限140
function countTwitterWeighted(text) {
  const urlRegex = /https?:\/\/[^\s]+/g;
  let weighted = 0;
  const noUrl = text.replace(urlRegex, () => {
    weighted += 23;
    return '';
  });
  for (const ch of noUrl) {
    const code = ch.codePointAt(0);
    const isHalf = (code <= 0x007E) || (code >= 0xFF61 && code <= 0xFF9F);
    weighted += isHalf ? 1 : 2;
  }
  return weighted;
}

let currentTitle = '';
let currentUrl = '';
let selectedText = '';
let omitSiteName = false;
let splitResult = { article: '', site: '', separator: null };

function isSelectionMode() {
  return selectedText.length > 0;
}

function getDisplayTitle() {
  if (isSelectionMode()) return selectedText;
  if (omitSiteName && splitResult.site) return splitResult.article;
  return currentTitle;
}

function getFullText() {
  return getDisplayTitle() + '\n' + currentUrl;
}

function updateUI() {
  const previewEl = document.getElementById('preview-text');
  const charCountEl = document.getElementById('char-count');
  const sitePreviewEl = document.getElementById('site-name-preview');
  const toggleEl = document.getElementById('omit-toggle');
  const toggleRowEl = document.getElementById('omit-toggle-row');
  const modeBadgeEl = document.getElementById('mode-badge');

  const titleSpan = document.createElement('span');
  titleSpan.style.color = '#111';
  titleSpan.textContent = getDisplayTitle();
  const urlSpan = document.createElement('span');
  urlSpan.style.color = '#3a7bd5';
  urlSpan.textContent = currentUrl;
  previewEl.innerHTML = '';
  previewEl.append(titleSpan, '\n', urlSpan);

  if (isSelectionMode()) {
    modeBadgeEl.textContent = '✦ 選択テキストを使用中';
    modeBadgeEl.style.display = 'block';
    toggleRowEl.style.opacity = '0.4';
    toggleRowEl.style.pointerEvents = 'none';
    sitePreviewEl.textContent = '';
  } else {
    modeBadgeEl.style.display = 'none';
    toggleRowEl.style.opacity = '1';
    toggleRowEl.style.pointerEvents = 'auto';
    toggleEl.classList.toggle('active', omitSiteName);
    if (splitResult.site) {
      sitePreviewEl.textContent = omitSiteName
        ? `省略中: 「${splitResult.site.trim()}」`
        : `検出: 「${splitResult.site.trim()}」`;
    } else {
      sitePreviewEl.textContent = omitSiteName ? 'セパレータが見つかりません' : '';
    }
  }

  const weighted = countTwitterWeighted(getFullText());
  const zenCount = Math.ceil(weighted / 2);
  const remaining = 140 - zenCount;
  charCountEl.className = 'char-count';
  if (remaining < 0) {
    charCountEl.textContent = `全角換算 ${zenCount}文字 (${Math.abs(remaining)}文字オーバー)`;
    charCountEl.classList.add('over');
  } else {
    charCountEl.textContent = `全角換算 ${zenCount}文字 (あと ${remaining}文字)`;
    if (remaining < 15) charCountEl.classList.add('warn');
  }
}


// ---------------------------------------------------------------
// PSストア専用：画像のコピー＆保存（store.playstation.com のみ表示）
// ---------------------------------------------------------------
function extractImageCandidatesFromPage() {
  const media = [], seen = new Set(), masters = [], shots = [];
  function add(url) { const c = url.split('?')[0]; if (!seen.has(c)) { seen.add(c); media.push({ url: c }); } }
  function traverse(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(traverse); return; }
    if (o.url && typeof o.url === 'string') {
      const r = String(o.role || o.type || '');
      if (/master|packshot/i.test(r)) masters.push(o.url);
      else if (/screenshot/i.test(r)) shots.push(o.url);
    }
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
        try { traverse(JSON.parse(v)); } catch (e) {}
      } else traverse(v);
    }
  }
  document.querySelectorAll('script[type="application/json"]').forEach((s) => {
    try { traverse(JSON.parse(s.textContent)); } catch (e) {}
  });
  masters.forEach(add);
  if (media.length === 0) shots.forEach(add);
  if (media.length === 0) {
    const imgs = Array.from(document.querySelectorAll('img[src*="image.api.playstation.com"]'));
    const groups = new Map();
    imgs.forEach((img) => {
      const c = img.src.split('?')[0];
      if (!groups.has(c)) groups.set(c, { thumb: false, full: false, order: groups.size });
      const g = groups.get(c);
      if (img.src.includes('thumb=true')) g.thumb = true; else g.full = true;
    });
    Array.from(groups.entries()).filter(([, g]) => g.thumb && g.full)
      .sort((a, b) => a[1].order - b[1].order).forEach(([u]) => add(u));
    if (media.length === 0 && imgs.length > 0) add(imgs[0].src);
  }
  return media;
}

let psImages = [];
let psIndex = 0;
const pngCache = new Map();

async function fetchImageAsCanvas(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`画像の取得に失敗 (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  return canvas;
}

function ensurePngBlob(url) {
  if (!pngCache.has(url)) {
    pngCache.set(url, fetchImageAsCanvas(url).then((c) => new Promise((resolve, reject) => {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG変換に失敗'))), 'image/png');
    })));
  }
  return pngCache.get(url);
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|？：＊＜＞｜]/g, '').trim().slice(0, 100) || 'image';
}

function setImgStatus(msg, type) {
  const el = document.getElementById('img-status');
  el.textContent = msg || '';
  el.className = type || '';
}

function renderImage() {
  const thumb = document.getElementById('image-thumb');
  const info = document.getElementById('image-info');
  const has = psImages.length > 0;
  ['img-prev', 'img-next'].forEach((id) => { document.getElementById(id).disabled = psImages.length <= 1; });
  document.getElementById('btn-img-copy').disabled = !has;
  document.getElementById('btn-img-save').disabled = !has;
  if (!has) {
    thumb.style.display = 'none';
    info.textContent = '画像なし';
    return;
  }
  const url = psImages[psIndex].url;
  thumb.src = url;
  thumb.style.display = 'block';
  info.textContent = `${psIndex + 1} / ${psImages.length}`;
  ensurePngBlob(url).catch(() => {}); // クリック前に先読み
}

async function initPsSection(tab) {
  let host = '';
  try { host = new URL(tab.url).hostname; } catch (e) {}
  if (host !== 'store.playstation.com') return; // PSストア以外では一切表示しない
  document.getElementById('ps-section').style.display = 'block';
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractImageCandidatesFromPage });
    psImages = result || [];
  } catch (e) { psImages = []; }
  psIndex = 0;
  renderImage();

  document.getElementById('img-prev').addEventListener('click', () => {
    psIndex = (psIndex - 1 + psImages.length) % psImages.length; renderImage();
  });
  document.getElementById('img-next').addEventListener('click', () => {
    psIndex = (psIndex + 1) % psImages.length; renderImage();
  });
  document.getElementById('btn-img-copy').addEventListener('click', async () => {
    try {
      const blobPromise = ensurePngBlob(psImages[psIndex].url);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      setImgStatus('画像をコピーしました', 'success');
    } catch (e) { setImgStatus('コピー失敗: ' + e.message, 'error'); }
  });
  document.getElementById('btn-img-save').addEventListener('click', async () => {
    const btn = document.getElementById('btn-img-save');
    btn.disabled = true;
    setImgStatus('変換中…');
    try {
      const canvas = await fetchImageAsCanvas(psImages[psIndex].url);
      const base = splitResult.article || currentTitle || 'image';
      chrome.downloads.download({ url: canvas.toDataURL('image/png'), filename: sanitizeFilename(base) + '.png', saveAs: false });
      setImgStatus('画像を保存しました', 'success');
    } catch (e) { setImgStatus('保存失敗: ' + e.message, 'error'); }
    finally { btn.disabled = false; }
  });
}

chrome.storage.local.get(['omitSiteName'], (data) => {
  omitSiteName = !!data.omitSiteName;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    currentTitle = tab.title || '';
    currentUrl = tab.url || '';
    splitResult = splitTitle(currentTitle);
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, func: () => window.getSelection().toString().trim() },
      (results) => {
        if (!chrome.runtime.lastError && results && results[0] && results[0].result) {
          selectedText = results[0].result;
        }
        updateUI();
        initPsSection(tab);
      }
    );
  });
});

document.getElementById('omit-toggle-row').addEventListener('click', () => {
  omitSiteName = !omitSiteName;
  chrome.storage.local.set({ omitSiteName });
  updateUI();
});

document.getElementById('btn-copy').addEventListener('click', async () => {
  const text = getFullText();
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('btn-copy');
    btn.textContent = '✓ コピーしました';
    btn.classList.add('copied');
    setTimeout(() => window.close(), 800);
  } catch (e) {
    const btn = document.getElementById('btn-copy');
    btn.textContent = 'コピー失敗: ' + e.message;
  }
});
