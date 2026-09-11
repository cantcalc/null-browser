import { app, session } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { InstalledExtension } from './types';

interface StoredExtension {
  path: string;
}

const STORE_FILE = 'extensions.json';

/**
 * Manages unpacked Chrome extensions for the normal persistent browser
 * session. Private sessions intentionally remain extension-free because
 * Electron does not support loading extensions into in-memory sessions.
 */
export class ExtensionManager {
  private initialized = false;
  private extensionPaths = new Set<string>();

  private get storePath(): string {
    return path.join(app.getPath('userData'), STORE_FILE);
  }

  private normalizePath(extensionPath: string): string {
    return path.resolve(extensionPath.trim());
  }

  private toInfo(extension: Electron.Extension): InstalledExtension {
    const manifest = extension.manifest || {};
    return {
      id: extension.id,
      name: extension.name || String(manifest.name || extension.id),
      version: extension.version || String(manifest.version || 'unknown'),
      path: extension.path,
      description: typeof manifest.description === 'string' ? manifest.description : undefined,
      manifestVersion: typeof manifest.manifest_version === 'number' ? manifest.manifest_version : undefined,
    };
  }

  private async saveStoredPaths(): Promise<void> {
    const payload: StoredExtension[] = Array.from(this.extensionPaths)
      .sort((a, b) => a.localeCompare(b))
      .map((extensionPath) => ({ path: extensionPath }));
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private async readStoredPaths(): Promise<string[]> {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry): entry is StoredExtension => Boolean(entry && typeof entry === 'object' && typeof (entry as StoredExtension).path === 'string'))
        .map((entry) => this.normalizePath(entry.path));
    } catch {
      return [];
    }
  }

  private async validateExtensionDirectory(extensionPath: string): Promise<void> {
    const stats = await fs.stat(extensionPath);
    if (!stats.isDirectory()) {
      throw new Error('확장 프로그램 폴더를 선택해 주세요.');
    }

    const manifestPath = path.join(extensionPath, 'manifest.json');
    const rawManifest = await fs.readFile(manifestPath, 'utf8');
    const manifest: unknown = JSON.parse(rawManifest);
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('manifest.json 형식이 올바르지 않습니다.');
    }
    const typedManifest = manifest as { name?: unknown; version?: unknown; manifest_version?: unknown };
    if (typeof typedManifest.name !== 'string' || typeof typedManifest.version !== 'string') {
      throw new Error('manifest.json에 name과 version이 필요합니다.');
    }
    if (typedManifest.manifest_version !== 2 && typedManifest.manifest_version !== 3) {
      throw new Error('Manifest V2 또는 V3 확장 프로그램만 지원합니다.');
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const storedPaths = await this.readStoredPaths();
    const uniquePaths = Array.from(new Set(storedPaths));
    let changed = uniquePaths.length !== storedPaths.length;

    for (const extensionPath of uniquePaths) {
      try {
        await this.validateExtensionDirectory(extensionPath);
        const extension = await session.defaultSession.loadExtension(extensionPath, { allowFileAccess: true });
        this.extensionPaths.add(extension.path);
      } catch (error) {
        changed = true;
        console.warn(`[extensions] Could not restore ${extensionPath}:`, error instanceof Error ? error.message : error);
      }
    }

    if (changed || this.extensionPaths.size !== uniquePaths.length) {
      await this.saveStoredPaths();
    }
  }

  async list(): Promise<InstalledExtension[]> {
    await this.initialize();
    return session.defaultSession.getAllExtensions().map((extension) => this.toInfo(extension));
  }

  async install(extensionPath: string): Promise<InstalledExtension> {
    await this.initialize();
    const normalizedPath = this.normalizePath(extensionPath);
    await this.validateExtensionDirectory(normalizedPath);

    const alreadyLoaded = session.defaultSession.getAllExtensions().find((extension) => path.resolve(extension.path) === normalizedPath);
    if (alreadyLoaded) return this.toInfo(alreadyLoaded);

    const extension = await session.defaultSession.loadExtension(normalizedPath, { allowFileAccess: true });
    this.extensionPaths.add(extension.path);
    await this.saveStoredPaths();
    return this.toInfo(extension);
  }

  async remove(extensionId: string): Promise<boolean> {
    await this.initialize();
    const extension = session.defaultSession.getAllExtensions().find((item) => item.id === extensionId);
    if (!extension) return false;

    session.defaultSession.removeExtension(extensionId);
    this.extensionPaths.delete(extension.path);
    await this.saveStoredPaths();
    return true;
  }
}
