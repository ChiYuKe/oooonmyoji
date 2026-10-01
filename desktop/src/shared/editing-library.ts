export interface ActionPreset {
  id: string;
  name: string;
  action: string;
  params: Record<string, unknown>;
  favorite: boolean;
}
export interface EditingLibrary {
  presets: ActionPreset[];
  favoriteActions: string[];
  recent: string[];
}
export type EditingLibraryChange =
  | { op: 'save'; preset: ActionPreset }
  | { op: 'remove'; id: string }
  | { op: 'favorite'; id: string }
  | { op: 'use'; id: string };
export const emptyEditingLibrary = (): EditingLibrary => ({ presets: [], favoriteActions: [], recent: [] });

export function containsReference(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (!Array.isArray(value) && typeof (value as any).ref === 'string') return true;
  return Object.values(value).some(containsReference);
}

export function literalPresetParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params || {}).filter(([, value]) => !containsReference(value)));
}

function validPreset(value: any): value is ActionPreset {
  return value && typeof value.id === 'string' && /^[\w-]{1,100}$/.test(value.id)
    && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 100
    && typeof value.action === 'string' && value.action.length > 0 && value.action.length <= 200
    && value.params && typeof value.params === 'object' && !Array.isArray(value.params)
    && !containsReference(value.params) && JSON.stringify(value.params).length <= 100_000;
}

export function parseEditingLibrary(value: any): EditingLibrary {
  if (!value || typeof value !== 'object') return emptyEditingLibrary();
  const presets: ActionPreset[] = Array.isArray(value.presets) ? value.presets.filter(validPreset).slice(0, 500).map((preset: ActionPreset) => ({ ...preset, favorite: preset.favorite === true })) : [];
  return { presets, favoriteActions: Array.isArray(value.favoriteActions) ? value.favoriteActions.filter((item: unknown) => typeof item === 'string').slice(0, 500) : [], recent: Array.isArray(value.recent) ? value.recent.filter((item: unknown) => typeof item === 'string').slice(0, 20) : [] };
}

export function changeEditingLibrary(library: EditingLibrary, change: EditingLibraryChange): EditingLibrary {
  const next = parseEditingLibrary(JSON.parse(JSON.stringify(library)));
  if (!change || typeof change !== 'object') throw new Error('预设操作无效');
  if (change.op === 'save') {
    if (!validPreset(change.preset)) throw new Error('预设名称或参数无效；引用不能存入共享预设');
    const index = next.presets.findIndex((item) => item.id === change.preset.id);
    if (index < 0 && next.presets.length >= 500) throw new Error('最多保存 500 份预设');
    const preset = { ...change.preset, name: change.preset.name.trim(), favorite: change.preset.favorite === true };
    if (index < 0) next.presets.push(preset); else next.presets[index] = preset;
  } else {
    if (typeof change.id !== 'string' || change.id.length > 220) throw new Error('预设标识无效');
    if (change.op === 'remove') {
      next.presets = next.presets.filter((item) => item.id !== change.id);
      next.recent = next.recent.filter((id) => id !== `preset:${change.id}`);
    } else if (change.op === 'favorite') {
      const preset = next.presets.find((item) => `preset:${item.id}` === change.id);
      if (preset) preset.favorite = !preset.favorite;
      else if (change.id.startsWith('action:')) {
        const action = change.id.slice(7);
        next.favoriteActions = next.favoriteActions.includes(action) ? next.favoriteActions.filter((item) => item !== action) : [...next.favoriteActions, action];
      } else throw new Error('找不到预设');
    } else if (change.op === 'use') next.recent = [change.id, ...next.recent.filter((id) => id !== change.id)].slice(0, 20);
    else throw new Error('预设操作无效');
  }
  return next;
}
