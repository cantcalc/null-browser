import { SearchEngine, SearchShortcut } from '../types/browser';

export interface NavigationParserOptions {
  searchEngine?: SearchEngine;
  customSearchUrl?: string;
  searchShortcuts?: SearchShortcut[];
}

export interface NavigationResult {
  url: string;
  type: 'internal' | 'url' | 'search' | 'shortcut';
  originalQuery: string;
  searchQuery?: string;
  searchEngine?: string;
}

export const BUILTIN_SEARCH_ENGINES: Record<SearchEngine, string> = {
  google: 'https://www.google.com/search?q=%s',
  naver: 'https://search.naver.com/search.naver?query=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  bing: 'https://www.bing.com/search?q=%s',
  brave: 'https://search.brave.com/search?q=%s',
  custom: 'https://www.google.com/search?q=%s',
};

// IPv4 Regex with optional port and path
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?::\d{1,5})?(?:\/.*)?$/;

// IPv6 Regex bracketed with optional port and path
const IPV6_REGEX = /^\[[0-9a-fA-F:]+\](?::\d{1,5})?(?:\/.*)?$/;

const HOSTNAME_REGEX = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isExplicitUrl(query: string): boolean {
  const protocol = query.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  if (!protocol || !['http', 'https', 'file', 'mailto', 'tel', 'vscode'].includes(protocol)) return false;

  try {
    const parsed = new URL(query);
    return Boolean(parsed.href);
  } catch {
    return false;
  }
}

function isSafeSearchTemplate(template: string): boolean {
  try {
    const parsed = new URL(template.replace(/%s/g, 'search'));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function looksLikeWebHost(query: string): boolean {
  if (query.includes(' ') || query.startsWith('//')) return false;
  try {
    const parsed = new URL(`https://${query}`);
    return HOSTNAME_REGEX.test(parsed.hostname);
  } catch {
    return false;
  }
}

function isValidHttpTarget(query: string): boolean {
  try {
    const parsed = new URL(`http://${query}`);
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Parses user input from AddressBar or NewTabPage omnibox into a canonical URL or search URL.
 */
export function parseNavigationInput(
  rawInput: string,
  options: NavigationParserOptions = {}
): NavigationResult {
  const query = (rawInput || '').trim();
  if (!query) {
    return {
      url: 'aero://newtab',
      type: 'internal',
      originalQuery: query,
    };
  }

  // 1. Search Shortcut Matching (e.g., "g react", "gh electron", "n 날씨")
  const parts = query.split(/\s+/);
  const prefix = parts[0].toLowerCase();
  const queryArg = parts.slice(1).join(' ').trim();

  const shortcuts = options.searchShortcuts || [];
  const matchedShortcut = shortcuts.find((s) => s.keyword.toLowerCase() === prefix);

  if (matchedShortcut && queryArg && isSafeSearchTemplate(matchedShortcut.searchUrl)) {
    const searchUrl = matchedShortcut.searchUrl.replace('%s', encodeURIComponent(queryArg));
    return {
      url: searchUrl,
      type: 'shortcut',
      originalQuery: query,
      searchQuery: queryArg,
      searchEngine: matchedShortcut.keyword,
    };
  }

  // 2. Internal Protocol normalizations (aero:// and legacy browser://)
  if (/^(aero|browser):\/\//i.test(query)) {
    const route = query.replace(/^(aero|browser):\/\//i, '');
    return {
      url: `aero://${route || 'newtab'}`,
      type: 'internal',
      originalQuery: query,
    };
  }

  // 3. Supported Explicit Web Protocols
  if (isExplicitUrl(query) || /^about:blank(?:[#?].*)?$/i.test(query)) {
    return {
      url: query,
      type: 'url',
      originalQuery: query,
    };
  }

  // 4. Localhost handling (with or without port/path)
  if (
    query === 'localhost' ||
    query.startsWith('localhost:') ||
    query.startsWith('localhost/') ||
    query === '127.0.0.1' ||
    query.startsWith('127.0.0.1:') ||
    query.startsWith('127.0.0.1/')
  ) {
    if (!isValidHttpTarget(query)) {
      // Fall through to the configured search engine for malformed ports.
    } else {
      return {
        url: `http://${query}`,
        type: 'url',
        originalQuery: query,
      };
    }
  }

  // 5. IPv4 check
  if (IPV4_REGEX.test(query) && isValidHttpTarget(query)) {
    return {
      url: `http://${query}`,
      type: 'url',
      originalQuery: query,
    };
  }

  // 6. IPv6 check
  if (IPV6_REGEX.test(query) && isValidHttpTarget(query)) {
    return {
      url: `http://${query}`,
      type: 'url',
      originalQuery: query,
    };
  }

  // 7. Domain Name Resolution. Validate the complete authority (including
  // ports) instead of maintaining a brittle, incomplete TLD allow-list.
  if (looksLikeWebHost(query)) {
    return {
      url: `https://${query}`,
      type: 'url',
      originalQuery: query,
    };
  }

  // 8. Default to Search Engine
  const engine = options.searchEngine || 'google';
  let template = BUILTIN_SEARCH_ENGINES[engine] || BUILTIN_SEARCH_ENGINES.google;
  if (engine === 'custom' && options.customSearchUrl && isSafeSearchTemplate(options.customSearchUrl)) {
    template = options.customSearchUrl;
  }

  const encodedQuery = encodeURIComponent(query);
  const searchUrl = template.includes('%s')
    ? template.replace('%s', encodedQuery)
    : `${template}${encodedQuery}`;

  return {
    url: searchUrl,
    type: 'search',
    originalQuery: query,
    searchQuery: query,
    searchEngine: engine,
  };
}
