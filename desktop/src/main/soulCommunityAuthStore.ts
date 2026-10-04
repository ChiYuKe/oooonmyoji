import { normalizeCommunityAccount } from '../shared/soul-community';
import type { CommunityAccount } from '../shared/soul-community';
interface Session { token: string; user: CommunityAccount; expiresAt: number }
interface SecretStorage { available(): boolean; encrypt(value: string): string; decrypt(value: string): string }
interface FileStore { read(): string; write(value: string): void }
/** Persistent credentials use the OS-backed Electron safeStorage, never plain text or renderer layout storage. */
export class SoulCommunityAuthStore {
  private sessions = new Map<string, Session>();
  private persistenceFailed = false;
  constructor(private storage: SecretStorage, private file: FileStore) {
    if (!this.storage.available()) return;
    try {
      const text = file.read(); if (text.length > 100_000) return;
      const data = JSON.parse(text);
      if (data.version !== 1 || !Array.isArray(data.sessions)) return;
      for (const row of data.sessions.slice(0, 30)) {
        try {
          if (typeof row.endpoint !== 'string' || typeof row.secret !== 'string') continue;
          const token = storage.decrypt(row.secret), user = normalizeCommunityAccount(row.user);
          if (!/^cs_[a-f0-9]{64}$/.test(token) || !Number.isFinite(row.expiresAt) || row.expiresAt <= Date.now()) continue;
          this.sessions.set(row.endpoint, { token, user, expiresAt: row.expiresAt });
        } catch { /* Invalid or undecryptable entries require a new sign-in. */ }
      }
    } catch { /* No saved session yet. */ }
  }
  persistent(): boolean { return this.storage.available() && !this.persistenceFailed; }
  get(endpoint: string): Session | undefined {
    const session = this.sessions.get(endpoint);
    if (session && session.expiresAt <= Date.now()) { this.remove(endpoint); return undefined; }
    return session ? structuredClone(session) : undefined;
  }
  set(endpoint: string, session: Session): void {
    if (!/^cs_[a-f0-9]{64}$/.test(session.token) || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) throw Error('社区登录凭据无效。');
    this.sessions.delete(endpoint); this.sessions.set(endpoint, { ...session, user: normalizeCommunityAccount(session.user) });
    while (this.sessions.size > 30) this.sessions.delete(this.sessions.keys().next().value!);
    this.save();
  }
  remove(endpoint: string): void { this.sessions.delete(endpoint); this.save(); }
  private save(): void {
    if (!this.storage.available()) return;
    try {
      const sessions = [...this.sessions].map(([endpoint, session]) => ({ endpoint, user: session.user, expiresAt: session.expiresAt, secret: this.storage.encrypt(session.token) }));
      this.file.write(JSON.stringify({ version: 1, sessions }));
      this.persistenceFailed = false;
    } catch { this.persistenceFailed = true; /* Keep only the current in-memory session. */ }
  }
}
