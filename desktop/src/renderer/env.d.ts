import type { OnmyojiDesktopApi } from '../shared/contracts';

export interface StudioShortcutDefinition {
  id: string;
  group: string;
  label: string;
  defaultBinding: string;
}

export interface StudioShortcutSetResult {
  ok: boolean;
  reason?: 'unknown' | 'invalid' | 'conflict';
  conflictId?: string;
}

export interface StudioShortcutsApi {
  storageKey: string;
  groups: Array<{ id: string; label: string }>;
  definitions: StudioShortcutDefinition[];
  getAll(): Record<string, string | null>;
  get(id: string): string | null;
  defaultBinding(id: string): string | null;
  isCustom(id: string): boolean;
  set(id: string, binding: string): StudioShortcutSetResult;
  reset(id: string): boolean;
  resetAll(): void;
  format(binding: string | null | undefined): string;
  bindingFromEvent(event: KeyboardEvent): string | null;
  matches(event: KeyboardEvent, binding: string | null | undefined): boolean;
  matchesById(event: KeyboardEvent, id: string): boolean;
  conflictFor(id: string, binding: string): string | null;
  subscribe(listener: () => void): () => void;
}

declare global {
  interface Window {
    onmyoji: OnmyojiDesktopApi;
    StudioShortcuts: StudioShortcutsApi;
  }
}

export {};
