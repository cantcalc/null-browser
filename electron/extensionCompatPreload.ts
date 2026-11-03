import { contextBridge, ipcRenderer } from 'electron';

// Chromium exposes separate `browser` and `chrome` namespace objects. The
// extension bridge augments only chrome; browser-first extensions would bypass
// NULL tab/command APIs and can crash their worker before registering messages.
const unifyExtensionNamespace = () => {
  const scope = globalThis as typeof globalThis & {
    chrome?: any;
    browser?: unknown;
    __nullExtensionCompat?: { readTabText: (id: number) => Promise<string>; captureTab: (options: unknown) => Promise<string> };
  };
  let api = scope.chrome;
  const id = api?.runtime?.id;
  // Never install APIs into a website/content script or an unrelated frame.
  if (!id || !/^[a-p]{32}$/.test(id) || location.protocol !== 'chrome-extension:' || location.hostname !== id) return;
  const callbackResult = <T>(task: Promise<T>, callback?: (...values: any[]) => void) => {
    if (!callback) return task;
    task.then(callback, error => {
      const previous = Object.getOwnPropertyDescriptor(api.runtime, 'lastError');
      let replaced = false;
      try {
        if (!previous || previous.configurable) {
          Object.defineProperty(api.runtime, 'lastError', { value: { message: String(error) }, configurable: true });
          replaced = true;
        }
        callback();
      } finally {
        if (replaced) {
          if (previous) Object.defineProperty(api.runtime, 'lastError', previous);
          else delete api.runtime.lastError;
        }
      }
    });
  };
  if (!api.tabCapture && scope.__nullExtensionCompat) {
    // Implement only the real stream-id path we support, not placeholder APIs
    // that appear successful without capturing audio.
    const tabCapture = {
      getMediaStreamId: (options: unknown, callback?: (id?: string) => void) =>
        callbackResult(scope.__nullExtensionCompat!.captureTab(options), callback),
    };
    // The upstream bridge freezes the top-level chrome object. Preserve its
    // existing namespaces/descriptors rather than mutating that frozen object
    // or patching a dependency. Only the new adapter is added to the copy.
    const extended = Object.create(Object.getPrototypeOf(api), Object.getOwnPropertyDescriptors(api));
    Object.defineProperty(extended, 'tabCapture', { value: tabCapture, enumerable: true });
    api = extended;
    Object.defineProperty(scope, 'chrome', { value: api, enumerable: true, configurable: true, writable: true });
  }
  if (scope.browser !== api) Object.defineProperty(scope, 'browser', { value: api, enumerable: true, configurable: true, writable: true });
  if (!api.tabs?.detectLanguage && typeof api.i18n?.detectLanguage === 'function' && scope.__nullExtensionCompat) {
    api.tabs.detectLanguage = (tabId?: number | ((language: string) => void), callback?: (language: string) => void) => {
      if (typeof tabId === 'function') { callback = tabId; tabId = undefined; }
      const task = (async () => {
        const id = typeof tabId === 'number' ? tabId : (await api.tabs.query({ active: true, currentWindow: true }))[0]?.id;
        const text = await scope.__nullExtensionCompat!.readTabText(id);
        const result = await api.i18n.detectLanguage(text);
        return result.languages?.[0]?.language || 'und';
      })();
      return callbackResult(task, callback);
    };
  }
};

// Chromium's own offscreen extension documents can be non-isolated. Do not
// change their preferences or expose Node; use the already-existing world.
if (process.type === 'service-worker' || (location.protocol === 'chrome-extension:' && /^[a-p]{32}$/.test(location.hostname))) {
  const bridge = {
    readTabText: (id: number) => ipcRenderer.invoke('null:extension-compat', 'page-text', id),
    captureTab: (options: unknown) => ipcRenderer.invoke('null:extension-compat', 'capture-tab', options),
  };
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('__nullExtensionCompat', bridge);
    contextBridge.executeInMainWorld({ func: unifyExtensionNamespace });
  } else {
    (globalThis as any).__nullExtensionCompat = bridge;
    unifyExtensionNamespace();
  }
}
