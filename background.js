/**
 * @fileoverview CAPES Research Exporter - Service Worker
 * Minimal background script for Chrome Extension Manifest V3
 * @author James Rodriguez <james@anthropic.com>
 */

'use strict';

// === CONSTANTS ===

/** @const {string} Extension name for logging */
const EXTENSION_NAME = 'CAPES Research Exporter';

/** @const {string} CAPES domain for context menu */
const CAPES_DOMAIN = 'https://www.periodicos.capes.gov.br/*';

// === LIFECYCLE EVENTS ===

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`${EXTENSION_NAME} installed:`, details.reason);
  
  // Only show welcome message on fresh install
  if (details.reason === 'install') {
    console.log(`${EXTENSION_NAME} v${chrome.runtime.getManifest().version} ready`);
  }
});

/**
 * Handle extension startup
 */
chrome.runtime.onStartup.addListener(() => {
  console.log(`${EXTENSION_NAME} started`);
});

// === DOWNLOAD HANDLING ===

/**
 * Handle download requests from content script
 * Note: This is kept for potential future use with chrome.downloads API
 * Currently, content script handles downloads via blob URLs
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'download' && request.content && request.filename) {
    // Future enhancement: Use chrome.downloads API for better download handling
    console.log('Download request received:', request.filename);
    
    // For now, acknowledge but let content script handle download
    sendResponse({ success: true, method: 'blob' });
    return true;
  }
  
  // Handle other potential message types
  if (request.action === 'getVersion') {
    sendResponse({ 
      version: chrome.runtime.getManifest().version,
      name: chrome.runtime.getManifest().name
    });
    return true;
  }
});

// === ERROR HANDLING ===

/**
 * Handle runtime errors
 */
chrome.runtime.onSuspend.addListener(() => {
  console.log(`${EXTENSION_NAME} suspended`);
});

/**
 * Global error handler
 */
self.addEventListener('error', (event) => {
  console.error(`${EXTENSION_NAME} error:`, event.error);
});

/**
 * Unhandled promise rejection handler
 */
self.addEventListener('unhandledrejection', (event) => {
  console.error(`${EXTENSION_NAME} unhandled promise rejection:`, event.reason);
});

// === UTILITY FUNCTIONS ===

/**
 * Check if URL is a CAPES search results page
 * @param {string} url - URL to check
 * @returns {boolean} True if valid CAPES search page
 */
const isCAPESSearchPage = (url) => {
  if (!url || !url.includes('periodicos.capes.gov.br')) {
    return false;
  }
  
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.has('q') || urlObj.pathname.includes('busca');
  } catch {
    return false;
  }
};

/**
 * Get extension stats for debugging
 * @returns {Object} Extension statistics
 */
const getExtensionStats = () => {
  const manifest = chrome.runtime.getManifest();
  return {
    name: manifest.name,
    version: manifest.version,
    manifestVersion: manifest.manifest_version,
    permissions: manifest.permissions || [],
    hostPermissions: manifest.host_permissions || []
  };
};

// Export for potential debugging use
console.debug(`${EXTENSION_NAME} service worker loaded`, getExtensionStats());