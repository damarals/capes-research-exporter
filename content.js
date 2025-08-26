/**
 * @fileoverview CAPES Research Exporter - Content Script
 * Battle-tested Chrome extension for exporting academic articles
 * @author James Rodriguez <james@anthropic.com>
 */

'use strict';

// === CONSTANTS ===

/** @const {string} Storage key for export state persistence */
const STORAGE_KEY = 'capes_export_state';

/** @const {number} Navigation delay in milliseconds */
const NAV_DELAY = 1200;

/** @const {number} Processing timeout in milliseconds */
const PROCESSING_TIMEOUT = 30000;

/** @const {Object<string, string>} DOM selectors for article extraction */
const SELECTORS = {
  article: 'div[id^="result-busca-"]:not([id$="-load"])',
  title: '.titulo-busca',
  authors: '.view-autor',
  metadata: 'p.text-down-01',
  nextButton: '.pagination-arrows button[aria-label*="seguinte"]:not([disabled])',
  pageInfo: '.pagination-information',
  openAccess: '[title="Acesso aberto"], [id*="open-acess-item"]',
  peerReviewed: '[title="Revisado por pares"], [id*="peer-reviewed-item"]',
  documentType: '.fw-semibold'
};

/** @const {Object<string, string>} Document type mappings for RIS format */
const RIS_TYPE_MAP = {
  'Artigo': 'JOUR',
  'Capítulo de livro': 'CHAP',
  'Carta': 'NEWS',
  'Errata': 'JOUR',
  'Revisão': 'JOUR'
};

/** @const {Object<string, string>} Document type mappings for BibTeX format */
const BIBTEX_TYPE_MAP = {
  'Artigo': 'article',
  'Capítulo de livro': 'inbook',
  'Carta': 'article',
  'Errata': 'article',
  'Revisão': 'article'
};

// === TYPE DEFINITIONS ===

/**
 * @typedef {Object} Article
 * @property {string} id - Unique article identifier
 * @property {string} title - Article title
 * @property {string[]} authors - List of authors
 * @property {string} journal - Journal name
 * @property {string} year - Publication year
 * @property {string} documentType - Type of document
 * @property {boolean} isOpenAccess - Open access indicator
 * @property {boolean} isPeerReviewed - Peer review indicator
 */

/**
 * @typedef {Object} ExportState
 * @property {string} format - Export format (ris|bibtex)
 * @property {Article[]} articles - Collected articles
 * @property {Set<number>} processedPages - Set of processed page numbers
 * @property {number} totalArticles - Total articles count estimate
 * @property {Date} startTime - Export start timestamp
 */

// === UTILITIES ===

/**
 * Sleep utility for async delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Safe DOM query selector
 * @param {string} selector - CSS selector
 * @param {Element} context - Context element (default: document)
 * @returns {Element|null}
 */
const $ = (selector, context = document) => context.querySelector(selector);

/**
 * Safe DOM query selector all
 * @param {string} selector - CSS selector
 * @param {Element} context - Context element (default: document)
 * @returns {NodeList}
 */
const $$ = (selector, context = document) => context.querySelectorAll(selector);

/**
 * Extract clean text from element
 * @param {Element|null} element - DOM element
 * @returns {string} Cleaned text content
 */
const getCleanText = element => {
  if (!element) return '';
  return element.textContent.trim().replace(/<\/?[^>]+>/g, '');
};

/**
 * Generate timestamp string for filenames
 * @returns {string} ISO timestamp formatted for filenames
 */
const getTimestamp = () => new Date().toISOString()
  .slice(0, 19)
  .replace(/[:-]/g, '');

// === PAGE NAVIGATION ===

class PageNavigator {
  /**
   * Get current page number from URL
   * @returns {number} Current page number
   */
  static getCurrentPage() {
    const params = new URLSearchParams(location.search);
    return parseInt(params.get('page'), 10) || 1;
  }

  /**
   * Check if next page exists
   * @returns {boolean} True if next page available
   */
  static hasNextPage() {
    if ($(SELECTORS.nextButton)) return true;

    const info = $(SELECTORS.pageInfo);
    if (info) {
      const match = info.textContent.match(/(\d+)–(\d+)\s*de\s*(\d+)/);
      return match && parseInt(match[2], 10) < parseInt(match[3], 10);
    }

    return false;
  }

  /**
   * Navigate to next page
   * @returns {void}
   */
  static goToNextPage() {
    const nextPage = this.getCurrentPage() + 1;
    const url = new URL(location.href);
    url.searchParams.set('page', nextPage);
    location.href = url.toString();
  }

  /**
   * Extract estimated total articles count
   * @returns {number} Total articles estimate
   */
  static getTotalArticlesEstimate() {
    const info = $(SELECTORS.pageInfo);
    if (info) {
      const match = info.textContent.match(/de\s*(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    }
    return 0;
  }
}

// === ARTICLE EXTRACTION ===

class ArticleExtractor {
  /**
   * Extract all articles from current page
   * @returns {Article[]} Array of extracted articles
   */
  static extractFromPage() {
    const articles = [];
    const elements = $$(SELECTORS.article);

    elements.forEach((element, index) => {
      const content = $('div[id^="conteudo-"]', element);
      if (!content) return;

      const article = this.extractSingleArticle(element, content, index);
      if (this.isValidArticle(article)) {
        articles.push(article);
      }
    });

    return articles;
  }

  /**
   * Extract single article data
   * @param {Element} element - Article element
   * @param {Element} content - Content element
   * @param {number} index - Article index
   * @returns {Article} Extracted article data
   */
  static extractSingleArticle(element, content, index) {
    const article = {
      id: element.id.replace('result-busca-', '') || `article_${index}`,
      title: this.extractTitle(content),
      authors: this.extractAuthors(content),
      journal: '',
      year: '',
      documentType: this.extractDocumentType(content),
      isOpenAccess: this.checkOpenAccess(content),
      isPeerReviewed: this.checkPeerReviewed(content)
    };

    this.extractMetadata(content, article);
    return article;
  }

  /**
   * Extract article title
   * @param {Element} content - Content element
   * @returns {string} Article title
   */
  static extractTitle(content) {
    const titleElement = $(SELECTORS.title, content);
    return getCleanText(titleElement);
  }

  /**
   * Extract authors list
   * @param {Element} content - Content element
   * @returns {string[]} Array of author names
   */
  static extractAuthors(content) {
    const authorElements = $$(SELECTORS.authors, content);
    return Array.from(authorElements, el => getCleanText(el)).filter(Boolean);
  }

  /**
   * Extract document type
   * @param {Element} content - Content element
   * @returns {string} Document type
   */
  static extractDocumentType(content) {
    const typeElement = $(SELECTORS.documentType, content);
    return getCleanText(typeElement) || 'Artigo';
  }

  /**
   * Check if article is open access
   * @param {Element} content - Content element
   * @returns {boolean} True if open access
   */
  static checkOpenAccess(content) {
    return Boolean($(SELECTORS.openAccess, content));
  }

  /**
   * Check if article is peer reviewed
   * @param {Element} content - Content element
   * @returns {boolean} True if peer reviewed
   */
  static checkPeerReviewed(content) {
    return Boolean($(SELECTORS.peerReviewed, content));
  }

  /**
   * Extract metadata (year, journal)
   * @param {Element} content - Content element
   * @param {Article} article - Article object to populate
   */
  static extractMetadata(content, article) {
    const metaElements = $$(SELECTORS.metadata, content);
    
    for (const meta of metaElements) {
      const text = getCleanText(meta);
      
      if (text.includes(' - ') && text.includes('|')) {
        const parts = text.split(' - ');
        if (parts.length >= 2) {
          article.year = parts[0].trim();
          const remaining = parts[1].split(' | ');
          if (remaining.length >= 2) {
            article.journal = remaining[1].trim();
          }
        }
        break;
      }
    }
  }

  /**
   * Validate article data
   * @param {Article} article - Article to validate
   * @returns {boolean} True if valid
   */
  static isValidArticle(article) {
    return article.title && article.title.length > 5;
  }
}

// === FORMAT CONVERTERS ===

class FormatConverter {
  /**
   * Convert articles to RIS format
   * @param {Article[]} articles - Articles to convert
   * @returns {string} RIS formatted string
   */
  static toRIS(articles) {
    const records = articles.map(article => this.articleToRIS(article));
    return records.join('\n\n') + '\n';
  }

  /**
   * Convert single article to RIS format
   * @param {Article} article - Article to convert
   * @returns {string} RIS record string
   */
  static articleToRIS(article) {
    const lines = [];
    const risType = RIS_TYPE_MAP[article.documentType] || 'JOUR';
    
    lines.push(`TY  - ${risType}`);
    
    if (article.title) {
      lines.push(`TI  - ${article.title}`);
    }
    
    article.authors.forEach(author => {
      lines.push(`AU  - ${author}`);
    });
    
    if (article.year) {
      const yearMatch = article.year.match(/(\d{4})/);
      if (yearMatch) {
        lines.push(`PY  - ${yearMatch[1]}`);
      }
    }
    
    if (article.journal) {
      lines.push(`T2  - ${article.journal}`);
      lines.push(`JF  - ${article.journal}`);
    }
    
    const notes = this.buildNotesArray(article);
    if (notes.length > 0) {
      lines.push(`N1  - ${notes.join('; ')}`);
    }
    
    lines.push('ER  - ');
    return lines.join('\r\n');
  }

  /**
   * Convert articles to BibTeX format
   * @param {Article[]} articles - Articles to convert
   * @returns {string} BibTeX formatted string
   */
  static toBibTeX(articles) {
    const entries = articles
      .filter(article => article.title)
      .map(article => this.articleToBibTeX(article));
    return entries.join('\n\n') + '\n';
  }

  /**
   * Convert single article to BibTeX format
   * @param {Article} article - Article to convert
   * @returns {string} BibTeX entry string
   */
  static articleToBibTeX(article) {
    const citationKey = this.generateCitationKey(article);
    const entryType = BIBTEX_TYPE_MAP[article.documentType] || 'article';
    
    const lines = [`@${entryType}{${citationKey},`];
    
    lines.push(`  title = {${this.escapeBibTeX(article.title)}},`);
    
    if (article.authors.length > 0) {
      const authors = article.authors.join(' and ');
      lines.push(`  author = {${this.escapeBibTeX(authors)}},`);
    }
    
    if (article.journal) {
      lines.push(`  journal = {${this.escapeBibTeX(article.journal)}},`);
    }
    
    const year = this.extractYear(article.year);
    if (year !== 'unknown') {
      lines.push(`  year = {${year}},`);
    }
    
    const notes = this.buildNotesArray(article);
    if (notes.length > 0) {
      lines.push(`  note = {${this.escapeBibTeX(notes.join('; '))}},`);
    }
    
    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Generate citation key for BibTeX
   * @param {Article} article - Article data
   * @returns {string} Citation key
   */
  static generateCitationKey(article) {
    const titleWords = article.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 3);
    
    const year = this.extractYear(article.year);
    return titleWords.join('') + year;
  }

  /**
   * Extract year from year string
   * @param {string} yearStr - Year string
   * @returns {string} Extracted year or 'unknown'
   */
  static extractYear(yearStr) {
    if (!yearStr) return 'unknown';
    const match = yearStr.match(/(\d{4})/);
    return match ? match[1] : 'unknown';
  }

  /**
   * Escape special characters for BibTeX
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  static escapeBibTeX(str) {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\$/g, '\\$')
      .replace(/&/g, '\\&')
      .replace(/%/g, '\\%')
      .replace(/#/g, '\\#');
  }

  /**
   * Build notes array for article
   * @param {Article} article - Article data
   * @returns {string[]} Array of notes
   */
  static buildNotesArray(article) {
    const notes = [];
    if (article.isOpenAccess) notes.push('Open Access');
    if (article.isPeerReviewed) notes.push('Peer Reviewed');
    if (article.id) notes.push(`CAPES ID: ${article.id}`);
    return notes;
  }
}

// === FILE DOWNLOAD ===

class FileDownloader {
  /**
   * Download content as file
   * @param {string} content - File content
   * @param {string} filename - Filename
   */
  static download(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  }

  /**
   * Generate filename for export
   * @param {string} format - Export format
   * @returns {string} Generated filename
   */
  static generateFilename(format) {
    const searchParams = new URLSearchParams(location.search);
    const searchTerm = searchParams.get('q') || 'capes-export';
    const cleanTerm = searchTerm
      .replace(/[^a-zA-Z0-9]/g, '_')
      .slice(0, 20);
    const timestamp = getTimestamp();
    const ext = format === 'ris' ? 'ris' : 'bib';
    
    return `capes_${cleanTerm}_${timestamp}.${ext}`;
  }
}

// === STATE MANAGEMENT ===

class StateManager {
  /**
   * Save export state to session storage
   * @param {ExportState} state - State to save
   */
  static save(state) {
    try {
      const serializedState = {
        ...state,
        processedPages: Array.from(state.processedPages),
        startTime: state.startTime.toISOString()
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializedState));
    } catch (error) {
      console.warn('Failed to save export state:', error);
    }
  }

  /**
   * Load export state from session storage
   * @returns {ExportState|null} Loaded state or null
   */
  static load() {
    try {
      const data = sessionStorage.getItem(STORAGE_KEY);
      if (!data) return null;
      
      const parsed = JSON.parse(data);
      return {
        ...parsed,
        processedPages: new Set(parsed.processedPages),
        startTime: new Date(parsed.startTime)
      };
    } catch (error) {
      console.warn('Failed to load export state:', error);
      this.clear();
      return null;
    }
  }

  /**
   * Clear saved export state
   */
  static clear() {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

// === PROGRESS UI ===

class ProgressUI {
  constructor() {
    this.overlay = null;
  }

  /**
   * Show progress overlay
   * @param {string} message - Initial message
   */
  show(message = 'Initializing export...') {
    if (this.overlay) return;

    this.overlay = this.createElement();
    document.body.appendChild(this.overlay);
    this.updateStatus(message, 0);
  }

  /**
   * Update progress status
   * @param {string} message - Status message
   * @param {number} progress - Progress percentage (0-100)
   */
  updateStatus(message, progress) {
    if (!this.overlay) return;

    const statusEl = this.overlay.querySelector('.export-status');
    const progressEl = this.overlay.querySelector('.progress-bar');
    
    if (statusEl) statusEl.textContent = message;
    if (progressEl) progressEl.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }

  /**
   * Hide progress overlay
   * @param {number} delay - Hide delay in milliseconds
   */
  hide(delay = 2000) {
    if (!this.overlay) return;

    setTimeout(() => {
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
    }, delay);
  }

  /**
   * Create progress overlay element
   * @returns {Element} Overlay element
   */
  createElement() {
    const overlay = document.createElement('div');
    overlay.className = 'capes-export-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.85); z-index: 999999;
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      backdrop-filter: blur(2px);
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white; padding: 32px; border-radius: 12px;
      text-align: center; min-width: 320px; max-width: 480px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    `;

    const status = document.createElement('div');
    status.className = 'export-status';
    status.style.cssText = `
      font-size: 16px; color: #374151; margin-bottom: 20px;
      font-weight: 500; line-height: 1.5;
    `;

    const progressContainer = document.createElement('div');
    progressContainer.style.cssText = `
      width: 100%; height: 6px; background: #e5e7eb; border-radius: 3px;
      overflow: hidden; margin-bottom: 16px;
    `;

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBar.style.cssText = `
      height: 100%; background: linear-gradient(90deg, #3b82f6, #1d4ed8);
      width: 0%; transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      border-radius: 3px;
    `;

    const stats = document.createElement('div');
    stats.className = 'export-stats';
    stats.style.cssText = `
      font-size: 14px; color: #6b7280; margin-top: 12px;
    `;

    progressContainer.appendChild(progressBar);
    modal.appendChild(status);
    modal.appendChild(progressContainer);
    modal.appendChild(stats);
    overlay.appendChild(modal);

    return overlay;
  }
}

// === MAIN EXPORT CONTROLLER ===

class ExportController {
  constructor() {
    this.state = null;
    this.progressUI = new ProgressUI();
    this.processingTimeout = null;
  }

  /**
   * Start export process
   * @param {string} format - Export format (ris|bibtex)
   */
  async startExport(format) {
    try {
      this.clearExistingExport();
      this.initializeState(format);
      this.progressUI.show('Starting export...');
      
      await this.processCurrentPage();
    } catch (error) {
      console.error('Export failed:', error);
      this.handleError(error);
    }
  }

  /**
   * Resume export from saved state
   */
  async resumeExport() {
    try {
      this.state = StateManager.load();
      if (!this.state) return;

      this.progressUI.show('Resuming export...');
      await sleep(500);
      await this.processCurrentPage();
    } catch (error) {
      console.error('Resume failed:', error);
      this.handleError(error);
    }
  }

  /**
   * Initialize export state
   * @param {string} format - Export format
   */
  initializeState(format) {
    this.state = {
      format,
      articles: [],
      processedPages: new Set(),
      totalArticles: PageNavigator.getTotalArticlesEstimate(),
      startTime: new Date()
    };
  }

  /**
   * Process current page articles
   */
  async processCurrentPage() {
    if (!this.state) return;

    this.setProcessingTimeout();
    
    const currentPage = PageNavigator.getCurrentPage();
    const articles = ArticleExtractor.extractFromPage();

    if (articles.length > 0) {
      this.state.articles.push(...articles);
      this.state.processedPages.add(currentPage);
      StateManager.save(this.state);
    }

    this.updateProgress();

    if (this.shouldContinueToNextPage(currentPage)) {
      await this.navigateToNextPage();
    } else {
      await this.completeExport();
    }
  }

  /**
   * Check if should continue to next page
   * @param {number} currentPage - Current page number
   * @returns {boolean} True if should continue
   */
  shouldContinueToNextPage(currentPage) {
    const nextPage = currentPage + 1;
    return PageNavigator.hasNextPage() && !this.state.processedPages.has(nextPage);
  }

  /**
   * Navigate to next page
   */
  async navigateToNextPage() {
    this.progressUI.updateStatus('Navigating to next page...', this.calculateProgress());
    await sleep(NAV_DELAY);
    PageNavigator.goToNextPage();
  }

  /**
   * Complete export process
   */
  async completeExport() {
    this.clearProcessingTimeout();
    
    if (this.state.articles.length === 0) {
      this.handleError(new Error('No articles found to export'));
      return;
    }

    this.progressUI.updateStatus('Generating file...', 95);

    const content = this.generateExportContent();
    const filename = FileDownloader.generateFilename(this.state.format);
    
    FileDownloader.download(content, filename);
    
    const message = `✅ Successfully exported ${this.state.articles.length} articles!`;
    this.progressUI.updateStatus(message, 100);
    this.progressUI.hide();
    
    StateManager.clear();
  }

  /**
   * Generate export content based on format
   * @returns {string} Formatted content
   */
  generateExportContent() {
    return this.state.format === 'ris'
      ? FormatConverter.toRIS(this.state.articles)
      : FormatConverter.toBibTeX(this.state.articles);
  }

  /**
   * Update progress UI
   */
  updateProgress() {
    const progress = this.calculateProgress();
    const message = `Collected ${this.state.articles.length} articles from ${this.state.processedPages.size} pages`;
    this.progressUI.updateStatus(message, progress);
  }

  /**
   * Calculate progress percentage
   * @returns {number} Progress percentage
   */
  calculateProgress() {
    if (this.state.totalArticles <= 0) {
      return Math.min(90, this.state.processedPages.size * 10);
    }
    return Math.min(90, (this.state.articles.length / this.state.totalArticles) * 100);
  }

  /**
   * Set processing timeout
   */
  setProcessingTimeout() {
    this.clearProcessingTimeout();
    this.processingTimeout = setTimeout(() => {
      this.handleError(new Error('Export timed out'));
    }, PROCESSING_TIMEOUT);
  }

  /**
   * Clear processing timeout
   */
  clearProcessingTimeout() {
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
  }

  /**
   * Handle export errors
   * @param {Error} error - Error object
   */
  handleError(error) {
    this.clearProcessingTimeout();
    
    const message = `❌ Export failed: ${error.message}`;
    this.progressUI.updateStatus(message, 0);
    this.progressUI.hide(4000);
    
    StateManager.clear();
    console.error('CAPES Export Error:', error);
  }

  /**
   * Clear any existing export state
   */
  clearExistingExport() {
    this.clearProcessingTimeout();
    StateManager.clear();
    
    const existingOverlay = $('.capes-export-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }
  }
}

// === INITIALIZATION ===

const exportController = new ExportController();

// Message handler for popup communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'export' && message.format) {
    exportController.startExport(message.format);
    sendResponse({ success: true });
  }
  return true;
});

// Resume export on page load if state exists
if (StateManager.load()) {
  exportController.resumeExport();
}