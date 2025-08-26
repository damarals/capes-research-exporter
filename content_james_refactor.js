// === CAPES Article Exporter ===
// Clean, minimal, battle-tested

const STORAGE_KEY = 'capes_export_state';
const SELECTORS = {
  article: 'div[id^="result-busca-"]:not([id$="-load"])',
  title: '.titulo-busca',
  authors: '.view-autor',
  meta: 'p.text-down-01',
  nextBtn: '.pagination-arrows button[aria-label*="seguinte"]:not([disabled])',
  pageInfo: '.pagination-information'
};

let state = null;

// === Core Functions ===

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const getCurrentPage = () => {
  const params = new URLSearchParams(location.search);
  return parseInt(params.get('page')) || 1;
};

const hasNextPage = () => {
  const btn = document.querySelector(SELECTORS.nextBtn);
  if (btn) return true;
  
  const info = document.querySelector(SELECTORS.pageInfo);
  if (info) {
    const match = info.textContent.match(/(\d+)–(\d+)\s*de\s*(\d+)/);
    return match && parseInt(match[2]) < parseInt(match[3]);
  }
  
  return false;
};

const extractArticles = () => {
  return Array.from(document.querySelectorAll(SELECTORS.article))
    .map(el => {
      const content = el.querySelector('div[id^="conteudo-"]');
      if (!content) return null;
      
      const title = content.querySelector(SELECTORS.title)?.textContent?.trim() || '';
      const authors = Array.from(content.querySelectorAll(SELECTORS.authors))
        .map(a => a.textContent.trim());
      
      let year = '', journal = '';
      const meta = content.querySelector(SELECTORS.meta);
      if (meta) {
        const text = meta.textContent;
        const parts = text.split(' - ');
        if (parts.length >= 2) {
          year = parts[0].trim();
          const remaining = parts[1].split(' | ');
          if (remaining.length >= 2) journal = remaining[1].trim();
        }
      }
      
      return title ? { title, authors, year, journal } : null;
    })
    .filter(Boolean);
};

const navigateNext = () => {
  const nextPage = getCurrentPage() + 1;
  const url = new URL(location.href);
  url.searchParams.set('page', nextPage);
  location.href = url.toString();
};

// === Export Functions ===

const toRIS = articles => {
  return articles.map(article => [
    'TY  - JOUR',
    `TI  - ${article.title}`,
    ...article.authors.map(author => `AU  - ${author}`),
    article.year && `PY  - ${article.year}`,
    article.journal && `T2  - ${article.journal}`,
    'ER  - '
  ].filter(Boolean).join('\r\n')).join('\n\n') + '\n';
};

const toBibTeX = articles => {
  return articles.map((article, i) => {
    const key = `article${i + 1}`;
    const entries = [
      `@article{${key},`,
      `  title = {${article.title.replace(/[{}]/g, '')}},`
    ];
    
    if (article.authors.length) {
      entries.push(`  author = {${article.authors.join(' and ')}},`);
    }
    if (article.journal) entries.push(`  journal = {${article.journal}},`);
    if (article.year) entries.push(`  year = {${article.year}},`);
    
    entries.push('}');
    return entries.join('\n');
  }).join('\n\n') + '\n';
};

const download = (content, filename) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

// === UI Functions ===

const createOverlay = () => {
  const overlay = document.createElement('div');
  overlay.id = 'capes-export-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.8); z-index: 10000;
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  `;
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white; padding: 24px; border-radius: 8px;
    text-align: center; min-width: 300px;
  `;
  
  const status = document.createElement('div');
  status.id = 'export-status';
  status.style.cssText = 'font-size: 16px; margin-bottom: 16px;';
  
  const progress = document.createElement('div');
  progress.style.cssText = `
    width: 100%; height: 4px; background: #e0e0e0; border-radius: 2px;
    overflow: hidden;
  `;
  
  const bar = document.createElement('div');
  bar.id = 'progress-bar';
  bar.style.cssText = `
    height: 100%; background: #1976d2; width: 0%;
    transition: width 0.3s ease;
  `;
  
  progress.appendChild(bar);
  modal.appendChild(status);
  modal.appendChild(progress);
  overlay.appendChild(modal);
  
  return overlay;
};

const updateOverlay = (message, progress = 0) => {
  const overlay = document.getElementById('capes-export-overlay');
  if (!overlay) return;
  
  overlay.querySelector('#export-status').textContent = message;
  overlay.querySelector('#progress-bar').style.width = `${progress}%`;
};

// === Main Export Logic ===

const processPage = async () => {
  const currentPage = getCurrentPage();
  const articles = extractArticles();
  
  if (!articles.length) return;
  
  state.articles.push(...articles);
  state.pages.add(currentPage);
  
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...state,
    pages: Array.from(state.pages)
  }));
  
  updateOverlay(`Collected ${state.articles.length} articles from ${state.pages.size} pages`);
  
  if (hasNextPage() && !state.pages.has(currentPage + 1)) {
    await sleep(1000);
    navigateNext();
  } else {
    // Export complete
    const content = state.format === 'ris' ? toRIS(state.articles) : toBibTeX(state.articles);
    const ext = state.format === 'ris' ? 'ris' : 'bib';
    const filename = `capes_export_${Date.now()}.${ext}`;
    
    download(content, filename);
    
    updateOverlay(`✅ Downloaded ${state.articles.length} articles!`, 100);
    
    setTimeout(() => {
      document.getElementById('capes-export-overlay')?.remove();
      sessionStorage.removeItem(STORAGE_KEY);
    }, 2000);
  }
};

// === Message Handler ===

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'export') {
    state = {
      format: msg.format,
      articles: [],
      pages: new Set()
    };
    
    document.body.appendChild(createOverlay());
    updateOverlay('Starting export...');
    
    setTimeout(processPage, 500);
    sendResponse({ success: true });
  }
});

// === Resume Export ===

const savedState = sessionStorage.getItem(STORAGE_KEY);
if (savedState) {
  const data = JSON.parse(savedState);
  state = {
    ...data,
    pages: new Set(data.pages)
  };
  
  document.body.appendChild(createOverlay());
  updateOverlay('Resuming export...');
  setTimeout(processPage, 1000);
}