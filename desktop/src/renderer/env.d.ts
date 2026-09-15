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

export interface StudioTooltipInstallOptions {
  attribute?: string;
  scanTitles?: boolean;
  ariaLabelTags?: RegExp | null;
  assetPreview?: boolean;
  bridge?: 'none' | 'send' | 'receive';
  embedded?: 'auto' | 'host' | 'embedded';
  repositionOnResize?: boolean;
  hideOnScroll?: boolean;
  suppressSelector?: string | null;
  trimText?: boolean;
  receiverFrames?: () => HTMLIFrameElement[];
}

export interface StudioTooltipHandle {
  show(text: string, rect: DOMRectReadOnly, target?: HTMLElement): void;
  hide(): void;
  scan(): void;
}

export interface StudioTooltipApi {
  install(options?: StudioTooltipInstallOptions): StudioTooltipHandle;
}

declare global {
  interface Window {
    onmyoji: OnmyojiDesktopApi;
    StudioShortcuts: StudioShortcutsApi;
    StudioTooltip?: StudioTooltipApi;
  }
}

export {};
