import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { AIProvider, AISettings } from '../../shared/ai';

interface Profile { settings?: Partial<AISettings>; keys?: Partial<Record<AIProvider, { ciphertext: string; freeAccount: boolean }>> }
interface VaultData { version: 1; profiles: Record<string, Profile> }
// Separate from settings import/export and all page/extension partitions.
export class AIVault {
  private data: VaultData | undefined;
  private loading?: Promise<VaultData>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private filename: string) {}
  private async load() {
    if (this.loading) return this.loading;
    this.loading = this.read();
    return this.loading;
  }
  private async read() {
    if (!this.data) {
      try {
        const raw = JSON.parse(await fs.readFile(this.filename, 'utf8'));
        if (raw.version !== 1 || !raw.profiles || typeof raw.profiles !== 'object') throw Error();
        this.data = raw;
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw Error('AI 연결 저장소를 읽지 못했습니다. 파일을 임의로 초기화하지 않았습니다.');
        this.data = { version: 1, profiles: {} };
      }
    }
    return this.data!;
  }
  async profile(id: string): Promise<Profile> { const profiles = (await this.load()).profiles; return Object.hasOwn(profiles, id) ? profiles[id] : {}; }
  private ensure(data: VaultData, id: string): Profile {
    if (!Object.hasOwn(data.profiles, id)) Object.defineProperty(data.profiles, id, { value: {}, enumerable: true, writable: true, configurable: true });
    return data.profiles[id];
  }
  private write(change: (data: VaultData) => void | Promise<void>) {
    const work = this.queue.then(async () => {
      const data = await this.load();
      const next: VaultData = structuredClone(data);
      await change(next);
      await fs.mkdir(path.dirname(this.filename), { recursive: true });
      const temporary = this.filename + '.tmp';
      await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, this.filename);
      this.data = next;
      this.loading = Promise.resolve(next);
    });
    this.queue = work.catch(() => {});
    return work;
  }
  async saveSettings(id: string, settings: AISettings) { await this.write(data => { this.ensure(data, id).settings = settings; }); }
  private async secure<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('OS 암호화 저장소가 응답하지 않습니다. 키체인 접근 권한을 확인한 뒤 다시 시도해 주세요.')), 12_000); })]);
    } catch { throw Error('OS 암호화 저장소에 접근하지 못했습니다. 키체인 권한·잠금 상태를 확인한 뒤 다시 시도해 주세요. 평문으로 저장하지 않았습니다.'); }
    finally { clearTimeout(timer!); }
  }
  private async requireEncryption() {
    if (!await this.secure(safeStorage.isAsyncEncryptionAvailable()) || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw Error('OS 암호화 저장소를 사용할 수 없습니다. API 키를 저장하지 않았습니다.');
    }
  }
  async saveKey(id: string, provider: AIProvider, key: string, freeAccount: boolean) {
    await this.requireEncryption();
    const ciphertext = (await this.secure(safeStorage.encryptStringAsync(key))).toString('base64');
    await this.write(data => { (this.ensure(data, id).keys ||= {})[provider] = { ciphertext, freeAccount }; });
  }
  async key(id: string, provider: AIProvider) {
    const stored = (await this.profile(id)).keys?.[provider];
    if (!stored) throw Error('먼저 API 키를 연결해 주세요.');
    await this.requireEncryption();
    const decrypted = await this.secure(safeStorage.decryptStringAsync(Buffer.from(stored.ciphertext, 'base64')));
    if (decrypted.shouldReEncrypt) await this.saveKey(id, provider, decrypted.result, stored.freeAccount);
    return decrypted.result;
  }
  async removeKey(id: string, provider: AIProvider) { await this.write(data => { delete this.ensure(data, id).keys?.[provider]; }); }
}
