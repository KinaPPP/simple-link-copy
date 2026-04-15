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
