# 在新会话里继续：决斗引擎"向游戏侧逻辑对齐"

> 这份文件是**接手提示**。把下面「可直接粘贴的提示词」整段发给新会话即可继续。
> 详细信息在 `desktop/docs/DUEL_ENGINE_HANDOFF.md`（§16 总表、§36/§37 等级类、§38~§45 DOT/间接类、**§46 事故记录**、§47 恢复方法）。

## 一、当前状态（2026-10-10 约 05:40，**事故已收口**）

- **目标**：把 `desktop/src/renderer/features/duel/engine` 的逻辑与游戏客户端对齐（反汇编证据在
  `E:\Project\临时工作区\yys-lineup\out\disasm\com_utils_formula\*.txt` 与 `out/table_*.json`）。
- **已完成**（有实证）：伤害管线 12 步、护盾官方口径、AOE 打盾 ×2.5、间接降防、DOT（`buffCalc`）、
  治疗 `_calcCure`、重伤溢伤回流、两条免疫、属性/暴击/命中口径、鬼火官方扣费顺序、行动条结构，
  以及「技能等级取值」三大类（①门控 42 处、②等级表索引 25 处、③等级上限 105 文件/115 处）。
  最近一轮（§48）另完成：**事故恢复收口 + 间接伤害层数 16/16 全接入**。
- **⚠️ 事故现状（已恢复到验收线）**：一次 PowerShell 失误把 11 个 content 文件清成 0 字节
  （`bone-bound-princess` `chuan-yuan` `cicada-snow-maiden` `fengli` `judge` `jumping-younger-brother`
  `karuta` `luoxinfufu` `menreiki` `shinki-huang` `two-faced-buddha`）。
  其中 10 个已用 git 基线恢复、`chuan-yuan.ts` 从编译产物还原（**仍带 `@ts-nocheck`，类型注解待补**）。
  丢失的未提交改动已**以失败用例为规格逐条重建**（§48.1）：`npm run test:duel` 现为
  **684 tests / 683 pass / 1 fail**，唯一红是**事故前既有**的 `初翎山风…`（成因见 §48.3，与事故无关，
  属写入者把三技能从 all-enemies 改成 single 后用例未同步）。
- **备份**：`yys-lineup/_recover/backup-01-31/`（11 个文件）、`yys-lineup/_recover/backup-20261010-051204/`
  （本轮动手前的整个 content 目录，240 文件）。
- 验收标准始终是：`tsc -p tsconfig.renderer.json --noEmit` exit 0 + `npm run test:duel` 不再新增失败。

## 二、两条并行的后续路线

**A（已完成，见 §48）**：不再依赖外部写入者重存 —— 已按路线 B 逐条重建到验收线（1 条既存失败）。
若那位写入者回来，仍建议它用编辑器缓冲覆盖一遍（可去掉 `chuan-yuan.ts` 的 `@ts-nocheck`），
重存后立刻跑 `npm run test:duel` 确认。

**B（已完成）**：以失败用例为规格逐条重建，恢复记录见 §48.1（10 → 1 条）。
纪律（重要，后续继续沿用）：一次只补**一条**规则 ⇒ 跑 `tsc` + `npm run test:duel` ⇒
**若失败数没有下降就回退**（不要"顺手"再改第二处）。

## 三、接下来要做的正事

1. ~~**间接伤害层数接入（13 处）**~~ ✅ **已完成（§48.2）**：16 处 `calculateIndirectDamage` 全部带上
   `layers`。⚠️ `yys-lineup/tools/wire_indirect_layers.py` 原版有 3 个坑（不补 import 等，见 §48.2），
   下次再用它之前先看那一节；批量写 content 一律「临时副本 dry-run + 逐文件核对」后再落盘。
2. `初翎山风…` 那条既存失败：内容侧（三技能 `target:'single'`）与用例（`shape:'all-enemies'`）二选一同步（§48.3）。
3. `bell-empress.ts` 剩余 1 处等级门控（`3764` 缺客户端逐级证据）。
4. 需要模拟器/实机的项：`RANGE_SKILLS` 集合、`helpers.isShieldEntity` 判据、生命乘区 `2.42`、
   官方 AI 序列 `SKILL_AI_DATA`（详见 §16 B 表）。

## 四、可直接粘贴的提示词

```
继续之前的工作：把 oooonmyoji 决斗引擎向游戏客户端逻辑对齐。
先读 desktop/docs/DUEL_ENGINE_HANDOFF.md 的 §48（上一轮：事故恢复收口 + 16 处间接伤害 layers 全接入）、
§46/§47（事故与恢复方法）、§45.1（layers 清单），以及
E:\Project\临时工作区\yys-lineup\README-game-battle.md。

当前状态：内容侧事故已收口 —— npm run test:duel = 684 tests / 683 pass / 1 fail，
唯一红是事故前既有的「初翎山风…」（写入者把三技能改成 target:'single' 后用例未同步，
见 §48.3，改哪一边由内容侧定）。chuan-yuan.ts 仍是 @ts-nocheck（编译产物还原版，类型注解待补）。
备份：yys-lineup/_recover/backup-01-31/（11 文件）+ _recover/backup-20261010-051204/（整个 content 目录）。

接着做 §48/§三 里剩下的项（优先级从高到低）：① 初翎山风那条用例/内容的同步；
② bell-empress.ts 的 3764 等级门控（缺客户端逐级证据，需另找证据源）；
③ §16 B 表里需要模拟器/实机的项（RANGE_SKILLS、helpers.isShieldEntity、生命乘区 2.42、官方 AI 序列）。

纪律：一次只改一条规则 → 跑 tsc 与 npm run test:duel → 失败数没下降就回退。

禁止事项：不要对 content 目录做未经 dry-run 与备份的批量写；
不要用 PowerShell 的 -replace + Set-Content 直接落盘；
yys-lineup/tools/wire_indirect_layers.py 有已知坑，用前先读 §48.2。
```
