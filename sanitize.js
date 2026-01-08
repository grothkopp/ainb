/**
 * Sanitizes HTML to prevent XSS attacks.
 * Allows safe markdown elements and links, but blocks javascript: URLs and embedded content.
 */

/**
 * Sanitizes HTML string by parsing and filtering elements.
 * @param {string} html - The HTML string to sanitize.
 * @returns {string} Sanitized HTML.
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  
  // Create a temporary DOM element to parse HTML
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  // Recursively sanitize the DOM tree
  sanitizeNode(temp);
  
  return temp.innerHTML;
}

/**
 * Recursively sanitizes a DOM node and its children.
 * @param {Node} node - The DOM node to sanitize.
 */
function sanitizeNode(node) {
  // Allowed tags for markdown content
  const ALLOWED_TAGS = new Set([
    'P', 'BR', 'STRONG', 'EM', 'CODE', 'PRE', 'UL', 'OL', 'LI',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'A',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'HR', 'DEL', 'INS',
    'SUP', 'SUB', 'SPAN', 'DIV'
  ]);
  
  // Allowed attributes per tag
  const ALLOWED_ATTRS = {
    'A': ['href', 'title', 'rel'],
    'CODE': ['class'],
    'PRE': ['class'],
    'SPAN': ['class'],
    'DIV': ['class']
  };
  
  // Blocked URL protocols
  const BLOCKED_PROTOCOLS = ['javascript:', 'data:', 'vbscript:', 'file:', 'about:'];
  
  const children = Array.from(node.childNodes);
  
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tagName = child.tagName.toUpperCase();
      
      // Remove disallowed tags (including IMG, IFRAME, OBJECT, EMBED, etc.)
      if (!ALLOWED_TAGS.has(tagName)) {
        child.remove();
        continue;
      }
      
      // Sanitize attributes
      const allowedAttrs = ALLOWED_ATTRS[tagName] || [];
      const attrs = Array.from(child.attributes);
      
      for (const attr of attrs) {
        const attrName = attr.name.toLowerCase();
        
        // Remove disallowed attributes
        if (!allowedAttrs.includes(attrName)) {
          child.removeAttribute(attr.name);
          continue;
        }
        
        // Special handling for href to block dangerous protocols
        if (attrName === 'href') {
          const href = attr.value.trim().toLowerCase();
          
          // Check for blocked protocols
          const isBlocked = BLOCKED_PROTOCOLS.some(protocol => 
            href.startsWith(protocol)
          );
          
          if (isBlocked) {
            // Replace with safe placeholder
            child.setAttribute('href', '#blocked-url');
            child.setAttribute('title', 'Blocked: Potentially unsafe URL');
            child.style.color = 'red';
            child.style.textDecoration = 'line-through';
          } else {
            // Add rel="noopener noreferrer" for security
            child.setAttribute('rel', 'noopener noreferrer');
            // Add target="_blank" to open in new tab
            child.setAttribute('target', '_blank');
          }
        }
      }
      
      // Recursively sanitize children
      sanitizeNode(child);
      
    } else if (child.nodeType === Node.TEXT_NODE) {
      // Text nodes are safe, keep them
      continue;
    } else {
      // Remove other node types (comments, etc.)
      child.remove();
    }
  }
}
