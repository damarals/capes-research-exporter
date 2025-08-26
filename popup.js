/**
 * @fileoverview CAPES Research Exporter - Popup Script
 * Professional popup interface with robust error handling and UX patterns
 * @author James Rodriguez <james@anthropic.com>
 */

'use strict';

// === CONSTANTS ===

/** @const {string} CAPES domain pattern */
const CAPES_DOMAIN = 'periodicos.capes.gov.br';

/** @const {number} Status message timeout in milliseconds */
const STATUS_TIMEOUT = 4000;

/** @const {number} Button state reset timeout in milliseconds */
const BUTTON_RESET_TIMEOUT = 3000;

// === DOM REFERENCES ===

const elements = {
  exportBtn: null,
  statusMessage: null,
  requirements: null,
  buttonText: null
};

// === UTILITY FUNCTIONS ===

/**
 * Get selected export format
 * @returns {string} Selected format (ris|bibtex)
 */
const getSelectedFormat = () => {
  const checked = document.querySelector('input[name="format"]:checked');
  return checked ? checked.value : 'ris';
};

/**
 * Show status message with animation
 * @param {string} message - Message to display
 * @param {string} type - Message type (success|error)
 * @param {number} duration - Display duration in milliseconds
 */
const showStatus = (message, type = 'success', duration = STATUS_TIMEOUT) => {
  if (!elements.statusMessage) return;

  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message ${type}`;
  elements.statusMessage.style.display = 'block';

  // Auto-hide after duration
  setTimeout(() => {
    if (elements.statusMessage) {
      elements.statusMessage.style.display = 'none';
    }
  }, duration);
};

/**
 * Hide status message
 */
const hideStatus = () => {
  if (elements.statusMessage) {
    elements.statusMessage.style.display = 'none';
  }
};

/**
 * Show requirements warning
 */
const showRequirements = () => {
  if (elements.requirements) {
    elements.requirements.classList.add('show');
  }
};

/**
 * Hide requirements warning
 */
const hideRequirements = () => {
  if (elements.requirements) {
    elements.requirements.classList.remove('show');
  }
};

/**
 * Set button loading state
 * @param {boolean} loading - Loading state
 */
const setButtonLoading = (loading) => {
  if (!elements.exportBtn || !elements.buttonText) return;

  elements.exportBtn.disabled = loading;
  
  if (loading) {
    elements.buttonText.innerHTML = '<div class="spinner"></div>Starting export...';
  } else {
    elements.buttonText.innerHTML = '📥 Export All Articles';
  }
};

/**
 * Reset button state after delay
 */
const resetButtonState = () => {
  setTimeout(() => {
    setButtonLoading(false);
  }, BUTTON_RESET_TIMEOUT);
};

// === VALIDATION ===

/**
 * Validate current tab for CAPES compatibility
 * @param {chrome.tabs.Tab} tab - Current active tab
 * @returns {Promise<boolean>} Validation result
 */
const validateCurrentTab = async (tab) => {
  if (!tab || !tab.url) {
    throw new Error('Unable to access current tab');
  }

  if (!tab.url.includes(CAPES_DOMAIN)) {
    showRequirements();
    throw new Error(`This extension only works on ${CAPES_DOMAIN}`);
  }

  // Check if it's a search results page
  const url = new URL(tab.url);
  const hasQuery = url.searchParams.has('q') || url.pathname.includes('busca');
  
  if (!hasQuery) {
    showRequirements();
    throw new Error('Please navigate to a search results page first');
  }

  hideRequirements();
  return true;
};

// === EXPORT HANDLER ===

/**
 * Handle export process
 * @param {string} format - Export format
 */
const handleExport = async (format) => {
  try {
    setButtonLoading(true);
    hideStatus();

    // Get current active tab
    const [tab] = await chrome.tabs.query({ 
      active: true, 
      currentWindow: true 
    });

    // Validate tab compatibility
    await validateCurrentTab(tab);

    // Send export message to content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'export',
      format: format
    });

    if (response && response.success) {
      showStatus('✅ Export started! Check the page for progress', 'success');
    } else {
      throw new Error('Failed to start export process');
    }

  } catch (error) {
    console.error('Export error:', error);
    
    // Handle specific error cases
    let errorMessage = error.message;
    
    if (error.message.includes('receiving end does not exist')) {
      errorMessage = 'Please refresh the CAPES page and try again';
    } else if (error.message.includes('activeTab')) {
      errorMessage = 'Unable to access the current tab';
    }

    showStatus(`❌ Error: ${errorMessage}`, 'error', 6000);
  } finally {
    resetButtonState();
  }
};

// === EVENT HANDLERS ===

/**
 * Handle export button click
 * @param {Event} event - Click event
 */
const handleExportClick = async (event) => {
  event.preventDefault();
  
  // Prevent multiple simultaneous exports
  if (elements.exportBtn.disabled) {
    return;
  }

  const format = getSelectedFormat();
  await handleExport(format);
};

/**
 * Handle format selection change
 * @param {Event} event - Change event
 */
const handleFormatChange = (event) => {
  // Optional: Add format-specific validation or UI updates
  hideStatus();
  hideRequirements();
};

/**
 * Handle keyboard shortcuts
 * @param {KeyboardEvent} event - Keyboard event
 */
const handleKeyboardShortcuts = (event) => {
  // Enter or Space on export button
  if (event.target === elements.exportBtn && 
      (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    handleExportClick(event);
  }
  
  // Quick format switching with numbers
  if (event.key === '1') {
    document.getElementById('format-ris').checked = true;
    handleFormatChange(event);
  } else if (event.key === '2') {
    document.getElementById('format-bibtex').checked = true;
    handleFormatChange(event);
  }
};

// === INITIALIZATION ===

/**
 * Cache DOM element references
 */
const cacheDOMElements = () => {
  elements.exportBtn = document.getElementById('exportBtn');
  elements.statusMessage = document.getElementById('statusMessage');
  elements.requirements = document.getElementById('requirements');
  elements.buttonText = elements.exportBtn?.querySelector('.button-text');
};

/**
 * Attach event listeners
 */
const attachEventListeners = () => {
  if (elements.exportBtn) {
    elements.exportBtn.addEventListener('click', handleExportClick);
  }

  // Format radio button change handlers
  const formatInputs = document.querySelectorAll('input[name="format"]');
  formatInputs.forEach(input => {
    input.addEventListener('change', handleFormatChange);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboardShortcuts);

  // Accessibility: Ensure proper focus management
  document.addEventListener('focusin', (event) => {
    if (event.target.matches('input[type="radio"]')) {
      hideStatus();
    }
  });
};

/**
 * Perform initial tab validation
 */
const performInitialValidation = async () => {
  try {
    const [tab] = await chrome.tabs.query({ 
      active: true, 
      currentWindow: true 
    });
    
    await validateCurrentTab(tab);
  } catch (error) {
    // Silently handle initial validation errors
    // Requirements will be shown by validateCurrentTab if needed
    console.debug('Initial validation:', error.message);
  }
};

/**
 * Initialize popup interface
 */
const initializePopup = async () => {
  try {
    cacheDOMElements();
    attachEventListeners();
    await performInitialValidation();
    
    // Set focus to export button for better keyboard navigation
    if (elements.exportBtn) {
      elements.exportBtn.focus();
    }
    
    console.debug('CAPES Research Exporter popup initialized');
  } catch (error) {
    console.error('Failed to initialize popup:', error);
    showStatus('❌ Initialization failed', 'error');
  }
};

// === STARTUP ===

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePopup);
} else {
  initializePopup();
}

// Handle popup visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Refresh validation when popup becomes visible
    performInitialValidation();
  }
});