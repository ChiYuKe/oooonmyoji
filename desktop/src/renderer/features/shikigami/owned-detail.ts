import { groupOwnedHeroes, type HeroOwnershipSnapshot } from '../../../shared/hero-ownership';
import type { HeroProfile, Panel } from '../../../shared/soul-optimizer';
import { catalogHeroBase, ownedEquipmentPanel, ownedHeroBaseRequest, readHeroPanel, type HeroBaseRequest } from '../../../shared/hero-panel';
import { soulCatalog } from '../../../shared/soul-catalog-data';
import { heroSkillsCatalog } from '../../../shared/hero-skills-data';
import { appendPickerPortrait, appendHeroRarity, SUIT_ATTRIBUTES } from '../souls/optimizer/picker';
import { createSoulPositionPortrait } from '../souls/components/position-portrait';
import { renderSoulDetail } from '../souls/components/detail-render';
import { appendEffectNumbers } from '../../ui/effect-text';
import { renderSoulPanelTable } from '../souls/components/panel-table';
import { installShikigamiOwnedShare, type OwnedShareApi } from './owned-share';

/** Actual account copies live here; the atlas sidebar remains the encyclopedia. */
export function installShikigamiOwnedDetail(root: HTMLElement, loadBase?: (request: HeroBaseRequest) => Promise<Panel | null>, shareApi?: OwnedShareApi): {
  show(hero: HeroProfile, snapshot: HeroOwnershipSnapshot | null, instanceName: string, origin: HTMLElement): void;
  close(): void; dispose(): void;
} {
  const doc = root.ownerDocument, dialog = doc.createElement('dialog');
  dialog.className = 'soul-optimizer shikigami-owned-detail';
  dialog.setAttribute('aria-label', '式神仓库详情');
  dialog.innerHTML = `<header class="soul-optimizer-header"><div data-owned="heading"></div><button type="button" aria-label="关闭式神详情" autofocus>×</button></header><div class="shikigami-owned-body"><p data-owned="status" class="shikigami-atlas-caption"></p><div data-owned="groups"></div></div>`;
  root.append(dialog);
  const share = installShikigamiOwnedShare(root, shareApi);
  const el = (name: string): HTMLElement => dialog.querySelector(`[data-owned="${name}"]`)!;
  const add = (parent: HTMLElement, tag: string, value: string, className = ''): HTMLElement => {
    const node = doc.createElement(tag); node.textContent = value; node.className = className; parent.append(node); return node;
  };
  let origin: HTMLElement | null = null;
  let version = 0;
  const close = (): void => { version++; share.close(); if (dialog.open) dialog.close(); };
  dialog.querySelector('button')!.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
  dialog.addEventListener('close', () => { if (origin?.isConnected && !root.closest('[hidden]')) origin.focus({ preventScroll: true }); origin = null; });
  return {
    show(hero, snapshot, instanceName, anchor): void {
      share.close();
      const current = ++version;
      origin = anchor; el('heading').replaceChildren(); el('groups').replaceChildren();
      const heading = add(el('heading'), 'div', '', 'shikigami-atlas-detail-heading');
      appendPickerPortrait(heading, 'hero', hero.id, hero.name);
      const title = add(heading, 'div', ''); appendHeroRarity(add(title, 'small', ''), hero.rarity);
      add(title, 'h2', `${hero.name} · 仓库详情`);
      const count = snapshot?.counts[hero.id] ?? 0;
      if (!snapshot) {
        el('status').textContent = '拥有情况尚未检测。请在游戏中打开式神录，点击「仓库检测」同步等级、技能和御魂装配。';
      } else {
        const groups = groupOwnedHeroes(snapshot, hero.id);
        el('status').textContent = `${instanceName || snapshot.instanceId} · ${new Date(snapshot.fetchedAt).toLocaleString()} · 已拥有 ${count} 只${snapshot.heroes ? ` · ${groups.length} 种配置` : ''}`;
        if (!count) add(el('groups'), 'p', '本次检测的仓库中未拥有此式神。', 'shikigami-owned-empty');
        else if (!snapshot.heroes) add(el('groups'), 'p', '此历史缓存只有拥有数量。请重新「仓库检测」补齐式神等级、技能等级和御魂装配；检测后可离线查看。', 'shikigami-owned-empty');
        else {
          el('status').title = '等级、星级、觉醒、技能及御魂配置相同的式神合并显示；御魂详情展示组内第一只。';
          const souls = new Map(snapshot.equippedSouls?.map(s => [s.id, s]));
          const catalog = heroSkillsCatalog.heroes[hero.id]?.skills ?? [];
          const skillNames = new Map(catalog.flatMap(s => [s, ...s.extraSkills]).map(s => [s.id, s]));
          groups.forEach((group, index) => {
            const article = add(el('groups'), 'article', '', 'shikigami-owned-group'); article.dataset.ownedGroup = String(index);
            const meta = add(article, 'header', '', 'shikigami-owned-group-heading');
            add(meta, 'h3', `配置 ${index + 1}`);
            const badges = add(meta, 'div', '', 'shikigami-owned-badges');
            for (const label of [`${group.hero.level} 级`, `${group.hero.stars} 星`, hero.awake ? group.hero.awake ? '已觉醒' : '未觉醒' : '无需觉醒', `已锁定 ${group.lockedCount} / ${group.count}`]) add(badges, 'span', label);
            add(meta, 'strong', `× ${group.count}`, 'shikigami-owned-quantity');
            const shareButton = add(meta, 'button', '分享', 'shikigami-owned-share-button') as HTMLButtonElement;
            shareButton.type = 'button'; shareButton.dataset.ownedShare = String(index);
            shareButton.setAttribute('aria-label', `分享${hero.name}配置 ${index + 1}`);
            shareButton.addEventListener('click', () => share.show(article, heading, hero.name, shareButton));
            add(article, 'h4', '技能等级'); const skills = add(article, 'div', '', 'shikigami-owned-skills');
            for (const skill of group.hero.skills) {
              const profile = skillNames.get(skill.id), item = add(skills, 'div', '', 'shikigami-owned-skill');
              if (profile) {
                const frame = add(item, 'span', profile.name.slice(0, 1), 'shikigami-skill-icon');
                const image = doc.createElement('img'); image.alt = ''; image.src = `onmyoji-resource://project/assets/skill-icons/${profile.icon}.png`;
                image.addEventListener('error', () => image.remove(), { once: true }); frame.append(image);
              }
              const label = add(item, 'div', ''); add(label, 'span', profile?.name ?? `技能 ${skill.id}`); add(label, 'strong', `Lv.${skill.level}`);
            }
            if (!group.hero.skills.length) add(skills, 'span', '该式神无可显示的技能等级。');
            const loadout = add(article, 'div', '', 'shikigami-owned-loadout');
            const gearSection = add(loadout, 'section', '', 'shikigami-owned-equipment-section');
            const overview = add(loadout, 'section', '', 'shikigami-owned-overview');
            add(overview, 'h4', '属性面板');
            const panel = add(overview, 'div', '', 'shikigami-owned-panel');
            const note = add(overview, 'p', '', 'shikigami-owned-panel-note'); note.setAttribute('role', 'status');
            const request = ownedHeroBaseRequest(group.hero, hero);
            const base = catalogHeroBase(request, hero);
            const renderPanel = (base: Panel | null, loading = false): void => {
              const values = ownedEquipmentPanel(group.hero, souls, base, soulCatalog.suits);
              renderSoulPanelTable(doc, panel, values.addition, values.total, { split: true, additionClass: 'shikigami-owned-addition', totalClass: 'shikigami-owned-total' });
              note.textContent = values.incomplete ? '部分御魂属性待解析，加成与总属性暂不可计算。'
                : loading ? '正在读取当前等级、星级的基础属性…'
                : !base ? '当前等级的基础属性暂未取得；已显示可确定的御魂加成。'
                : '已计入两件套与固有属性；不含战斗触发效果。';
            };
            renderPanel(base, !base && Boolean(loadBase));
            if (!base && loadBase) {
              shareButton.disabled = true; shareButton.title = '正在读取基础属性，请稍候';
              void loadBase(request).catch(() => null).then(result => {
                if (current === version && article.isConnected) { renderPanel(readHeroPanel(result)); shareButton.disabled = false; shareButton.title = '分享此配置的完整图片'; }
              });
            }
            add(gearSection, 'h4', '御魂装配'); const equipment = add(gearSection, 'div', '', 'shikigami-owned-equipment');
            equipment.classList.toggle('is-empty', group.hero.equips.every(id => !id));
            group.hero.equips.forEach((id, position) => {
              const soul = id ? souls.get(id) : undefined;
              const box = add(equipment, 'div', '', 'shikigami-owned-soul'); box.dataset.position = String(position + 1);
              const slot = add(box, 'div', '', 'shikigami-owned-soul-heading');
              add(slot, 'small', `${position + 1} 号位${soul ? ` · +${soul.level} · ${soul.stars} 星` : ''}`);
              if (soul) {
                const identity = add(box, 'div', '', 'shikigami-owned-soul-identity');
                identity.append(createSoulPositionPortrait(doc, soul, false));
                add(identity, 'strong', soul.name ?? `套装 ${soul.suitId}`);
                renderSoulDetail(doc, add(box, 'div', '', 'shikigami-owned-soul-attributes'), soul, { hideIdentity: true, hideSetEffects: true, hideRecordId: true });
                const identifiers = add(box, 'details', '', 'shikigami-owned-soul-id');
                add(identifiers, 'summary', '查看编号'); add(identifiers, 'small', `套装编号 ${soul.suitId}`); add(identifiers, 'code', soul.id);
              } else { box.classList.add('is-empty'); add(box, 'span', id ? '御魂数据待解析' : '未装配', 'shikigami-owned-empty-slot'); }
            });
            const equipped = group.hero.equips.flatMap(id => id && souls.has(id) ? [souls.get(id)!] : []);
            const suits = new Map<number, number>();
            for (const soul of equipped) if (soul.suitId != null) suits.set(soul.suitId, (suits.get(soul.suitId) ?? 0) + 1);
            const active = [...suits].filter(([, count]) => count >= 2);
            if (active.length) {
              add(overview, 'h4', '套装效果'); const effects = add(overview, 'div', '', 'shikigami-owned-set-effects');
              for (const [id, count] of active) {
                const suit = soulCatalog.suits.find(suit => suit.id === id); if (!suit) continue;
                const item = add(effects, 'div', ''); add(item, 'strong', `${suit.name} × ${count}`);
                if (suit.bonus) appendEffectNumbers(add(item, 'p', ''), `${SUIT_ATTRIBUTES[suit.bonus.name] ?? suit.bonus.name} +${(suit.bonus.value * 100).toFixed(0)}%`);
                const description = equipped.find(soul => soul.suitId === id)?.setEffects?.join(' ') || suit.four;
                if ((count >= 4 || suit.boss) && description) appendEffectNumbers(add(item, 'p', ''), description);
              }
            }
            const identities = add(article, 'details', '', 'shikigami-owned-identities');
            add(identities, 'summary', `包含 ${group.count} 只式神 · 查看编号`);
            for (const id of group.ids) add(identities, 'code', id);
          });
        }
      }
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('button')!.focus();
      dialog.querySelector('.shikigami-owned-body')!.scrollTop = 0;
    }, close, dispose: () => { close(); share.dispose(); dialog.remove(); },
  };
}
