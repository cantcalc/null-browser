import { nativeImage, type WebContents } from 'electron';
import { isWebURL, publicURL, redact } from './Policy';

export interface PageElement { id: number; tag: string; label: string; href?: string; inputType?: string; safeInput: boolean; download: boolean; downloadName?: string; role?: string; context: string; submit: boolean; formMethod?: string; formAction?: string; searchControl: boolean; fingerprint: string }
export interface PageSnapshot {
  title: string; url: string; text: string; revision: number; interaction: number;
  elements: PageElement[]; sensitive: boolean; login: boolean;
  headings: Array<{ level: number; text: string }>; code: string;
  viewport: { width: number; height: number }; masks: Array<{ x: number; y: number; width: number; height: number }>;
}

// Runs in a separate isolated world only on explicit AI use. It never reads
// input values, cookies, storage, hidden DOM, script bodies or cross-origin frames.
function pageOperation(operation: string, args: any) {
  const world = globalThis as any;
  const state = world.__nullAIContext ||= { revision: 0, interaction: 0, elements: new Map(), counter: 0, installed: false };
  if (!state.installed) {
    state.installed = true;
    for (const name of ['pointerdown', 'keydown', 'wheel', 'input']) document.addEventListener(name, e => { if (e.isTrusted) state.interaction++; }, { capture: true, passive: true });
  }
  const excluded = 'script,style,noscript,template,input,textarea,select,[contenteditable],[hidden],[aria-hidden="true"],[data-private],[data-sensitive]';
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const login = Array.from(document.querySelectorAll('input[type="password"]')).some(visible) || /\/(?:login|servicelogin|signin|sign-in|oauth2?|authorize|authenticate|authentication|saml|sso|auth)(?:[/?#]|$)/i.test(location.pathname) || /^(?:accounts?|login|auth|signin)\./i.test(location.hostname);
  const sensitive = login || /\/(?:checkout|billing|payment|credit-card|wallet|account\/settings)(?:[/?#]|$)/i.test(location.pathname) || Array.from(document.querySelectorAll('[autocomplete^="cc-"],input[name*="credit" i],input[name*="password" i]')).some(visible);
  const descriptor = (element: Element): Omit<PageElement, 'id'> => {
    const el = element as HTMLInputElement;
    const tag = el.tagName.toLowerCase();
    const editable = tag === 'input' || tag === 'textarea' || (el as unknown as HTMLElement).isContentEditable;
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).slice(0,8).map(id => { const label = document.getElementById(id); return label && !label.closest(excluded) ? label.textContent?.slice(0,160) || '' : ''; }).join(' ');
    const label = (el.getAttribute('aria-label') || labelledBy || el.getAttribute('title') || (editable ? el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.name || '텍스트 입력란' : (el as unknown as HTMLElement).innerText || el.querySelector('svg title')?.textContent) || '').trim().slice(0, 160);
    const href = tag === 'a' ? (el as unknown as HTMLAnchorElement).href : undefined;
    const inputType = tag === 'input' ? el.type : tag === 'textarea' ? 'textarea' : (el as unknown as HTMLElement).isContentEditable ? 'contenteditable' : undefined;
    const safeInput = tag === 'input' && (el.type === 'search' || /^(?:q|query|search|search_query)$/i.test(el.name)) && !el.autocomplete?.match(/password|one-time|cc-|email|tel/);
    const button = tag === 'button' ? el as unknown as HTMLButtonElement : undefined;
    const form = button?.form || el.closest('form');
    const dialog = el.closest('dialog,[role="dialog"]');
    const heading = dialog?.querySelector('h1,h2,h3,[role="heading"]');
    const context = [form?.getAttribute('aria-label'),form?.getAttribute('name'),dialog?.getAttribute('aria-label'),heading && !heading.closest(excluded) ? heading.textContent : ''].filter(Boolean).join(' ').slice(0,320);
    const submit = button?.type === 'submit' && Boolean(form);
    const formMethod = (button?.getAttribute('formmethod') || form?.method)?.toLowerCase();
    const formAction = submit ? (button?.hasAttribute('formaction') ? button.formAction : form?.action) : undefined;
    const searchControl = formMethod === 'get' && Array.from(form?.querySelectorAll('input[type="search"],input[name="q"],input[name="query"],input[name="search"],input[name="search_query"]') || []).some(visible) && !form?.querySelector('textarea,[contenteditable],input[type="password"],[autocomplete^="cc-"]');
    return { tag, label, href, inputType, safeInput: Boolean(safeInput), download: el.hasAttribute('download'), downloadName: el.getAttribute('download') || undefined, role:el.getAttribute('role') || undefined, context, submit, formMethod, formAction, searchControl, fingerprint: JSON.stringify([tag, label, href, inputType, el.name, el.getAttribute('role'), el.getAttribute('aria-expanded'), el.getAttribute('download'), el.getAttribute('target'),formAction,formMethod,context,submit,searchControl]) };
  };
  if (operation === 'snapshot') {
    state.revision++; state.elements.clear();
    const elements: PageElement[] = [];
    for (const element of Array.from(document.querySelectorAll('a[href],button,input[type="search"],input[type="text"],textarea,[contenteditable="true"],[role="button"],[role="tab"]')).slice(0, 1500)) {
      if (!visible(element) || element.closest('[data-private],[data-sensitive],[hidden],[aria-hidden="true"]') || (element as HTMLInputElement).disabled) continue;
      if (elements.length >= 70) break;
      const id = ++state.counter; const item = descriptor(element); state.elements.set(id, { element, ...item }); elements.push({ id, ...item });
    }
    let text = '', relevant = '', count = 0;
    const masks: PageSnapshot['masks'] = [];
    for (const el of Array.from(document.querySelectorAll('input,textarea,select,[contenteditable],[data-private],[data-sensitive]')).slice(0, 500)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect(); masks.push({ x: r.x, y: r.y, width: r.width, height: r.height });
    }
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && ++count <= 5000) {
      const parent = node.parentElement;
      if (!parent || parent.closest(excluded) || !visible(parent)) continue;
      const value = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!value) continue;
      if (text.length < 18000) text += value.slice(0, 18000 - text.length) + '\n';
      if (relevant.length < 12000 && Array.isArray(args.keywords) && args.keywords.some((word: string) => value.toLowerCase().includes(word))) relevant += value.slice(0, 12000 - relevant.length) + '\n';
      if (/@|\b(?:\d[ -]?){10,19}\b|\b(?:sk-|AIza|gsk_|gh[pousr]_|github_pat_|xox[baprs]-|ya29\.|AKIA|ASIA|Bearer |eyJ)|password|token|secret|api.?key|PRIVATE KEY/i.test(value)) {
        const range = document.createRange(); range.selectNodeContents(node);
        for (const r of Array.from(range.getClientRects())) masks.push({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
    }
    if (relevant) text = text.slice(0, 6000) + '\n[질문과 관련된 페이지 구간]\n' + relevant;
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(el => visible(el) && !el.closest(excluded)).slice(0, 40).map(el => ({ level: Number(el.tagName.slice(1)), text: (el as HTMLElement).innerText.slice(0, 160) }));
    const code = Array.from(document.querySelectorAll('pre')).filter(el => visible(el) && !el.closest(excluded)).slice(0, 8).map(el => el.innerText).join('\n\n').slice(0, 8000);
    return { title: document.title.slice(0, 200), url: location.href, text, code, headings, revision: state.revision, interaction: state.interaction, elements, sensitive, login, viewport: { width: innerWidth, height: innerHeight }, masks };
  }
  if (sensitive) throw Error('LOGIN_OR_SENSITIVE');
  if (state.interaction !== args.interaction) throw Error('USER_INTERACTION');
  if (state.revision !== args.revision || location.href !== args.url) throw Error('PAGE_CHANGED');
  if (operation === 'validate') return true;
  if (operation === 'scroll') { window.scrollBy({ top: Math.max(-innerHeight * 2, Math.min(innerHeight * 2, args.amount)), behavior: 'instant' }); return true; }
  const record = state.elements.get(args.id);
  if (!record?.element?.isConnected || descriptor(record.element).fingerprint !== record.fingerprint || !visible(record.element)) throw Error('ELEMENT_CHANGED');
  if (operation === 'inspect') return descriptor(record.element);
  if (operation === 'click') { record.element.click(); return true; }
  if (operation === 'type') {
    const el = record.element as HTMLInputElement;
    const editable = (el as unknown as HTMLElement).isContentEditable;
    if ((!['INPUT', 'TEXTAREA'].includes(el.tagName) && !editable) || (el.tagName === 'INPUT' && !['text', 'search'].includes(el.type)) || /password|one.?time|otp|pin|cc-|card|cvv|cvc|ssn|iban|routing|account|email|tel|phone|token|secret/i.test((el.autocomplete || '') + ' ' + (el.name || ''))) throw Error('SENSITIVE_INPUT');
    if (editable) el.textContent = args.text;
    else Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, args.text);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;
  }
  throw Error('UNKNOWN_OPERATION');
}

export class PageContext {
  async ready(contents: WebContents, signal: AbortSignal) {
    signal.throwIfAborted();
    await new Promise<void>(resolve => setImmediate(resolve));
    if (!contents.isLoadingMainFrame()) return;
    await new Promise<void>((resolve, reject) => {
      const finish = () => { cleanup(); resolve(); };
      const cancel = () => { cleanup(); reject(Error('작업이 중지되었습니다.')); };
      const timer = setTimeout(finish, 12_000);
      const cleanup = () => { clearTimeout(timer); contents.removeListener('did-stop-loading', finish); contents.removeListener('destroyed', cancel); signal.removeEventListener('abort', cancel); };
      contents.once('did-stop-loading', finish); contents.once('destroyed', cancel); signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
    signal.throwIfAborted();
  }
  async operation(contents: WebContents, operation: string, args: unknown = {}): Promise<any> {
    if (contents.isDestroyed() || !isWebURL(contents.getURL())) throw Error('일반 웹페이지에서만 사용할 수 있습니다.');
    const code = `(()=>{try{return {ok:true,value:(${pageOperation.toString()})(${JSON.stringify(operation)},${JSON.stringify(args)})}}catch(error){const allowed=['LOGIN_OR_SENSITIVE','PAGE_CHANGED','USER_INTERACTION','ELEMENT_CHANGED','SENSITIVE_INPUT','UNKNOWN_OPERATION'];return {ok:false,error:allowed.includes(error?.message)?error.message:'PAGE_OPERATION_FAILED'}}})()`;
    let timer: ReturnType<typeof setTimeout>;
    try {
      const result = await Promise.race([
        contents.executeJavaScriptInIsolatedWorld(1001, [{ code }], false),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('페이지 분석 응답 시간이 초과되었습니다.')), 5000); }),
      ]);
      if (!result || !result.ok) throw Error(result?.error || 'PAGE_OPERATION_FAILED');
      return result.value;
    } finally { clearTimeout(timer!); }
  }
  async snapshot(contents: WebContents, query?: string): Promise<PageSnapshot> {
    const keywords = query?.toLowerCase().match(/[\p{L}\p{N}]{4,50}/gu)?.slice(0, 8) || [];
    const result = await this.operation(contents, 'snapshot', { keywords }) as PageSnapshot;
    result.title = redact(result.title); result.text = redact(result.text);
    result.headings = result.headings.map(item => ({ ...item, text: redact(item.text) })); result.code = redact(result.code);
    result.elements = result.elements.map(el => ({ ...el, label: redact(el.label) }));
    return result;
  }
  external(snapshot: PageSnapshot, compact = false) {
    if (snapshot.sensitive) throw Error(snapshot.login ? 'LOGIN_REQUIRED' : '민감한 페이지의 AI 분석은 제한됩니다.');
    return { title: snapshot.title, url: publicURL(snapshot.url), text: snapshot.text.slice(0, compact ? 7000 : 18000), headings: snapshot.headings.slice(0, compact ? 12 : 30), code: snapshot.code.slice(0, compact ? 2000 : 8000),
      headingsAndControls: snapshot.elements.slice(0, compact ? 30 : 70).map(({ id, tag, label, href, inputType }) => ({ id, tag, label: label.slice(0, 120), href: href ? publicURL(href).slice(0, 240) : undefined, inputType })) };
  }
  async screenshot(contents: WebContents) {
    const snapshot = await this.snapshot(contents);
    if (snapshot.sensitive || snapshot.masks.length > 500) throw Error('민감한 화면은 AI 이미지로 전송할 수 없습니다.');
    const before = contents.getURL();
    const capture = await contents.capturePage();
    if (contents.getURL() !== before) throw Error('페이지가 변경되었습니다. 다시 캡처해 주세요.');
    const after = await this.snapshot(contents);
    if (after.sensitive || after.text !== snapshot.text || JSON.stringify(after.viewport) !== JSON.stringify(snapshot.viewport) || JSON.stringify(after.masks) !== JSON.stringify(snapshot.masks)) throw Error('캡처 중 페이지 내용이 변경되었습니다. 화면이 안정된 뒤 다시 확인해 주세요.');
    const original = capture.getSize();
    const image = capture.resize({ width: Math.min(1280, original.width), quality: 'good' });
    const size = image.getSize(), bitmap = image.toBitmap();
    const scale = Math.sqrt(bitmap.length / (size.width * size.height * 4));
    const width = Math.round(size.width * scale), height = Math.round(size.height * scale);
    const sx = width / snapshot.viewport.width, sy = height / snapshot.viewport.height;
    for (const mask of snapshot.masks) {
      const left = Math.max(0, Math.floor(mask.x * sx) - 3), right = Math.min(width, Math.ceil((mask.x + mask.width) * sx) + 3);
      const top = Math.max(0, Math.floor(mask.y * sy) - 3), bottom = Math.min(height, Math.ceil((mask.y + mask.height) * sy) + 3);
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const offset = (y * width + x) * 4; bitmap[offset] = bitmap[offset + 1] = bitmap[offset + 2] = 36; bitmap[offset + 3] = 255; }
    }
    const jpeg = nativeImage.createFromBitmap(bitmap, { width, height }).toJPEG(75);
    if (jpeg.length > 1_000_000) throw Error('화면 이미지 크기 제한을 초과했습니다.');
    return { dataURL: `data:image/jpeg;base64,${jpeg.toString('base64')}`, snapshot };
  }
}
