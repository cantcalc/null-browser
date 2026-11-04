// Used only by the owned QA process's inspector. Never imported by product
// code or included in package files. No real API key or provider request.
exports.install = ({ mockOSStorage = true } = {}) => {
  if (mockOSStorage) {
    const { safeStorage, app } = require('electron');
    const crypto = require('node:crypto');
    const key = crypto.createHash('sha256').update('NULL isolated UI fixture:' + app.getPath('userData')).digest();
    safeStorage.isAsyncEncryptionAvailable = async () => true;
    safeStorage.encryptStringAsync = async text => {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    };
    safeStorage.decryptStringAsync = async data => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0,12));
      decipher.setAuthTag(data.subarray(12,28));
      return { result: Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'), shouldReEncrypt: false };
    };
  }
  let requests = 0, cancelled = 0, pending = 0;
  global.fetch = async (url, options = {}) => {
    const address = String(url);
    if (!['https://api.groq.com/', 'https://console.groq.com/', 'https://openrouter.ai/'].some(origin => address.startsWith(origin))) throw Error('QA fixture rejected unexpected network destination');
    const json = value => new Response(JSON.stringify(value));
    if (address.endsWith('/key')) return json({ data: { is_free_tier: true } });
    if (address.includes('/docs/rate-limits')) return new Response('Free Plan Limits<table><tbody><tr><td>qa-model</td><td>30</td></tr></tbody></table>');
    if (address.includes('/docs/tool-use/overview')) return new Response('<table><tr><td>qa-model</td><td>Yes ✅</td></tr></table>');
    if (address.endsWith('/models')) return json({ data: address.includes('groq.com') ? [{ id: 'qa-model', active: true, context_window: 32000 }] : [{ id: 'qa-vision:free', name: 'QA vision', context_length: 32000, pricing: { prompt: '0', completion: '0', image: '0' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['tools'] }] });
    if (!address.endsWith('/chat/completions')) throw Error('Unexpected QA endpoint');
    requests++;
    const body = JSON.parse(options.body), user = body.messages.filter(m => m.role === 'user').at(-1)?.content;
    const slow = String(user).includes('slow-fixture');
    const agent = body.tools?.length && !body.messages.some(m => m.role === 'tool');
    const text = '# 테스트 응답\n\n```js\nconst answer = 42;\n```\n\n<script>window.__nullAIXSS=true</script>\n[차단된 링크](javascript:alert(1))\n\n완료했습니다.';
    return new Response(new ReadableStream({ start(controller) {
      let ended = false;
      const send = value => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
      pending++;
      const finish = () => { if (!ended) { ended = true; pending--; controller.close(); } };
      const timers = [];
    if (String(user).includes('narration-only-fixture')) { send({choices:[{delta:{content:'도구 없이 열었다고 주장하는 잘못된 응답'}}]}); finish(); }
    else if (agent) { send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'qa-read', function: String(user).includes('open-page-fixture') ? {name:'navigate',arguments:JSON.stringify({url:'https://example.com/'})} : { name: 'read_page', arguments: '{}' } }] } }] }); finish(); }
      else {
        send({ choices: [{ delta: { content: text.slice(0, 20) } }] });
        if (!slow) timers.push(setTimeout(() => { if (!ended) { send({ choices: [{ delta: { content: text.slice(20) } }] }); finish(); } }, 400));
      }
      options.signal?.addEventListener('abort', () => { if (!ended) { cancelled++; pending--; ended = true; for (const timer of timers) clearTimeout(timer); controller.error(Error('QA request cancelled')); } }, { once: true });
    } }), { headers: { 'content-type': 'text/event-stream' } });
  };
  global.__nullAIQAMetrics = () => ({ requests, cancelled, pending, mockTransport: true, mockOSStorage });
  return true;
};
