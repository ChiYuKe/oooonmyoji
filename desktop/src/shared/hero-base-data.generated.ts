// Generated from out/hero_base_6star40.json.
// Re-run scripts/import-hero-base.cjs after refreshing the game export.
// Source of the panels: NetEase's public simulator (get_hero_attr?level=40&star=6),
// i.e. exactly the level/star used by 乱斗 / 对弈竞猜.

export const HERO_BASE_SCHEMA_VERSION = 1;

/** Every panel below is a 6-star, level-40 base panel. */
export const HERO_BASE_META = {
  level: 40,
  star: 6,
  generatedFrom: "2026-10-03",
  heroCount: 280,
} as const;

export interface HeroBasePanel {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  crit: number;
  critDamage: number;
  hit: number;
  resist: number;
}

export interface HeroBaseEntry {
  name: string;
  rarity: number | null;
  pinyin: string;
  /** true = 面板为觉醒形态 */
  awake: boolean;
  /**
   * 面板的觉醒来源：
   * - awake1            原目录即为觉醒态（可信）
   * - awake1-fetched    原本未觉醒，已用 awake=1 重新抓取补齐（可信）
   * - awake0-complete  该形态没有独立觉醒态（全部 SP 51 个 + UR 1 个 + 无觉醒版本的 N 卡
   *   17 个），接口的 awake=0 返回即为**完整面板**，可直接使用
   */
  awakeStatus: 'awake1' | 'awake1-fetched' | 'awake0-complete' | string;
  kind: 'shikigami' | 'npc' | 'suspect';
  base: HeroBasePanel;
}

/** NPC / 素材条目：不应作为战斗式神处理。 */
export const heroBaseNpcIds: readonly number[] = [203, 245, 246, 400, 401, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 420, 433, 499];

/** 无独立觉醒态的式神 id（全部 SP/UR + 部分 N 卡）；其面板本身即完整值。 */
export const heroBaseAwake0CompleteIds: readonly number[] = [203, 246, 315, 322, 326, 327, 328, 331, 334, 339, 341, 343, 346, 348, 352, 354, 355, 357, 358, 362, 366, 367, 372, 377, 383, 385, 388, 390, 393, 395, 396, 400, 401, 403, 408, 411, 417, 422, 424, 425, 426, 427, 428, 430, 433, 499, 551, 554, 555, 559, 562, 565, 566, 568, 572, 574, 578, 579, 580, 584, 586, 590, 593, 594, 595, 598, 599, 602, 607];

const NPC_ID_SET = new Set<number>(heroBaseNpcIds);

export const heroBaseById: Readonly<Record<number, HeroBaseEntry>> = {
  "200": {
    "name": "桃花妖",
    "rarity": 3,
    "pinyin": "taohuayao",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12532.3,
      "attack": 2385.2,
      "defense": 489.51,
      "speed": 100,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "201": {
    "name": "雪女",
    "rarity": 3,
    "pinyin": "xuenv",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10481.64,
      "attack": 3055.2,
      "defense": 414.54,
      "speed": 109,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "202": {
    "name": "三尾狐",
    "rarity": 2,
    "pinyin": "sanweihu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10367.72,
      "attack": 2921.2,
      "defense": 441,
      "speed": 122,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "203": {
    "name": "灯笼鬼",
    "rarity": 1,
    "pinyin": "denglonggui",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "npc",
    "base": {
      "hp": 10253.8,
      "attack": 2412,
      "defense": 396.9,
      "speed": 100,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "205": {
    "name": "座敷童子",
    "rarity": 2,
    "pinyin": "zuofutongzi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12418.28,
      "attack": 2331.6,
      "defense": 458.64,
      "speed": 102,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "206": {
    "name": "鲤鱼精",
    "rarity": 2,
    "pinyin": "liyujing",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11620.84,
      "attack": 2733.6,
      "defense": 423.36,
      "speed": 117,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "207": {
    "name": "九命猫",
    "rarity": 2,
    "pinyin": "jiumingmao",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9798.12,
      "attack": 2974.8,
      "defense": 454.23,
      "speed": 108,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "208": {
    "name": "狸猫",
    "rarity": 2,
    "pinyin": "limao",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12873.96,
      "attack": 2358.4,
      "defense": 436.59,
      "speed": 109,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "209": {
    "name": "河童",
    "rarity": 2,
    "pinyin": "hetong",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10139.88,
      "attack": 3028.4,
      "defense": 432.18,
      "speed": 113,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "210": {
    "name": "鬼使白",
    "rarity": 3,
    "pinyin": "guishibai",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 3055.2,
      "defense": 423.36,
      "speed": 116,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "211": {
    "name": "鬼使黑",
    "rarity": 3,
    "pinyin": "guishihei",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10367.72,
      "attack": 3419.68,
      "defense": 410.13,
      "speed": 101,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "212": {
    "name": "童男",
    "rarity": 2,
    "pinyin": "tongnan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12760.04,
      "attack": 2438.8,
      "defense": 427.77,
      "speed": 103,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "213": {
    "name": "童女",
    "rarity": 2,
    "pinyin": "tongnv",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12987.88,
      "attack": 2412,
      "defense": 423.36,
      "speed": 109,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "214": {
    "name": "饿鬼",
    "rarity": 2,
    "pinyin": "egui",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 2840.8,
      "defense": 414.54,
      "speed": 105,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "215": {
    "name": "孟婆",
    "rarity": 3,
    "pinyin": "mengpo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10709.48,
      "attack": 2921.2,
      "defense": 427.77,
      "speed": 118,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "216": {
    "name": "巫蛊师",
    "rarity": 2,
    "pinyin": "wugushi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10709.48,
      "attack": 3055.2,
      "defense": 405.72,
      "speed": 105,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0.2,
      "resist": 0
    }
  },
  "217": {
    "name": "大天狗",
    "rarity": 4,
    "pinyin": "datiangou",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10025.96,
      "attack": 3449.16,
      "defense": 418.95,
      "speed": 114,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "218": {
    "name": "鸦天狗",
    "rarity": 2,
    "pinyin": "yatiangou",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10481.64,
      "attack": 2974.8,
      "defense": 427.77,
      "speed": 111,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "219": {
    "name": "酒吞童子",
    "rarity": 4,
    "pinyin": "jiutuntongzi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11165.16,
      "attack": 3135.6,
      "defense": 374.85,
      "speed": 113,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "220": {
    "name": "犬神",
    "rarity": 3,
    "pinyin": "quanshen",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 3001.6,
      "defense": 432.18,
      "speed": 109,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "221": {
    "name": "食发鬼",
    "rarity": 2,
    "pinyin": "shifagui",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10709.48,
      "attack": 2894.4,
      "defense": 432.18,
      "speed": 118,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "222": {
    "name": "武士之灵",
    "rarity": 2,
    "pinyin": "wushizhiling",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10481.64,
      "attack": 3028.4,
      "defense": 418.95,
      "speed": 110,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "223": {
    "name": "骨女",
    "rarity": 3,
    "pinyin": "gunv",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9912.04,
      "attack": 2948,
      "defense": 454.23,
      "speed": 107,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "224": {
    "name": "雨女",
    "rarity": 2,
    "pinyin": "yunv",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12304.36,
      "attack": 2251.2,
      "defense": 476.28,
      "speed": 114,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "225": {
    "name": "跳跳弟弟",
    "rarity": 2,
    "pinyin": "tiaotiaodidi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10709.48,
      "attack": 3028.4,
      "defense": 410.13,
      "speed": 104,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "226": {
    "name": "跳跳妹妹",
    "rarity": 2,
    "pinyin": "tiaotiaomeimei",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10937.32,
      "attack": 3055.2,
      "defense": 396.9,
      "speed": 108,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "227": {
    "name": "兵俑",
    "rarity": 2,
    "pinyin": "bingyong",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13329.64,
      "attack": 2385.2,
      "defense": 480.69,
      "speed": 116,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "228": {
    "name": "丑时之女",
    "rarity": 2,
    "pinyin": "choushizhinv",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11165.16,
      "attack": 2894.4,
      "defense": 414.54,
      "speed": 117,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "230": {
    "name": "独眼小僧",
    "rarity": 2,
    "pinyin": "duyanxiaoseng",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11734.76,
      "attack": 2519.2,
      "defense": 454.23,
      "speed": 118,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "231": {
    "name": "鬼女红叶",
    "rarity": 3,
    "pinyin": "guinvhongye",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 2974.8,
      "defense": 436.59,
      "speed": 114,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "232": {
    "name": "铁鼠",
    "rarity": 2,
    "pinyin": "tieshu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10709.48,
      "attack": 2921.2,
      "defense": 427.77,
      "speed": 115,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "233": {
    "name": "跳跳哥哥",
    "rarity": 3,
    "pinyin": "tiaotiaogege",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10709.48,
      "attack": 3055.2,
      "defense": 405.72,
      "speed": 119,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "234": {
    "name": "椒图",
    "rarity": 2,
    "pinyin": "jiaotu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12304.36,
      "attack": 2304.8,
      "defense": 467.46,
      "speed": 117,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "236": {
    "name": "管狐",
    "rarity": 2,
    "pinyin": "guanhu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10595.56,
      "attack": 3001.6,
      "defense": 418.95,
      "speed": 108,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "237": {
    "name": "山兔",
    "rarity": 2,
    "pinyin": "shantu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10709.48,
      "attack": 2894.4,
      "defense": 432.18,
      "speed": 115,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "238": {
    "name": "萤草",
    "rarity": 2,
    "pinyin": "yingcao",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 103,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "241": {
    "name": "蝴蝶精",
    "rarity": 2,
    "pinyin": "hudiejing",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12076.52,
      "attack": 2438.8,
      "defense": 454.23,
      "speed": 115,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "242": {
    "name": "傀儡师",
    "rarity": 3,
    "pinyin": "kuileishi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11734.76,
      "attack": 2840.8,
      "defense": 401.31,
      "speed": 108,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "243": {
    "name": "山童",
    "rarity": 2,
    "pinyin": "shantong",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10139.88,
      "attack": 3001.6,
      "defense": 523.91,
      "speed": 116,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "244": {
    "name": "首无",
    "rarity": 2,
    "pinyin": "shouwu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10937.32,
      "attack": 2894.4,
      "defense": 423.36,
      "speed": 110,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "245": {
    "name": "提灯小僧",
    "rarity": 1,
    "pinyin": "tidengxiaoseng",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "npc",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 110,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "246": {
    "name": "赤舌",
    "rarity": 1,
    "pinyin": "chishe",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "npc",
    "base": {
      "hp": 10253.8,
      "attack": 2412,
      "defense": 396.9,
      "speed": 100,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "247": {
    "name": "海坊主",
    "rarity": 3,
    "pinyin": "haifangzhu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10139.88,
      "attack": 3055.2,
      "defense": 427.77,
      "speed": 109,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "248": {
    "name": "荒川之主",
    "rarity": 4,
    "pinyin": "huangchuanzhizhu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11051.24,
      "attack": 3001.6,
      "defense": 401.31,
      "speed": 111,
      "crit": 0.2,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "249": {
    "name": "觉",
    "rarity": 2,
    "pinyin": "jiao",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11620.84,
      "attack": 2599.6,
      "defense": 445.41,
      "speed": 108,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "250": {
    "name": "青蛙瓷器",
    "rarity": 2,
    "pinyin": "qingwaciqi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10595.56,
      "attack": 2974.8,
      "defense": 423.36,
      "speed": 107,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "251": {
    "name": "判官",
    "rarity": 3,
    "pinyin": "panguan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10481.64,
      "attack": 3028.4,
      "defense": 418.95,
      "speed": 118,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "252": {
    "name": "凤凰火",
    "rarity": 3,
    "pinyin": "fenghuanghuo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 106,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "253": {
    "name": "吸血姬",
    "rarity": 3,
    "pinyin": "xixueji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10937.32,
      "attack": 3001.6,
      "defense": 405.72,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "254": {
    "name": "妖狐",
    "rarity": 3,
    "pinyin": "yaohu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10367.72,
      "attack": 3055.2,
      "defense": 418.95,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "255": {
    "name": "阎魔",
    "rarity": 4,
    "pinyin": "yanmo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11962.6,
      "attack": 2465.6,
      "defense": 454.23,
      "speed": 127,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "256": {
    "name": "妖琴师",
    "rarity": 3,
    "pinyin": "yaoqinshi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12646.12,
      "attack": 2572.8,
      "defense": 410.13,
      "speed": 120,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "257": {
    "name": "食梦貘",
    "rarity": 3,
    "pinyin": "shimengmo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11962.6,
      "attack": 2412,
      "defense": 463.05,
      "speed": 119,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "258": {
    "name": "两面佛",
    "rarity": 4,
    "pinyin": "liangmianfo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10481.64,
      "attack": 3135.6,
      "defense": 401.31,
      "speed": 109,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "259": {
    "name": "小鹿男",
    "rarity": 4,
    "pinyin": "xiaolunan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11165.16,
      "attack": 2814,
      "defense": 427.77,
      "speed": 120,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "260": {
    "name": "清姬",
    "rarity": 3,
    "pinyin": "qingji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11848.68,
      "attack": 2412,
      "defense": 467.46,
      "speed": 105,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "261": {
    "name": "镰鼬",
    "rarity": 3,
    "pinyin": "lianyou",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11620.84,
      "attack": 2680,
      "defense": 432.18,
      "speed": 117,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "262": {
    "name": "姑获鸟",
    "rarity": 3,
    "pinyin": "guhuoniao",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10823.4,
      "attack": 3082,
      "defense": 396.9,
      "speed": 113,
      "crit": 0.5,
      "critDamage": 1.2,
      "hit": 0,
      "resist": 0
    }
  },
  "263": {
    "name": "二口女",
    "rarity": 3,
    "pinyin": "erkounv",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11506.92,
      "attack": 2626.4,
      "defense": 445.41,
      "speed": 116,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "264": {
    "name": "白狼",
    "rarity": 3,
    "pinyin": "bailang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10823.4,
      "attack": 3082,
      "defense": 396.9,
      "speed": 112,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "265": {
    "name": "茨木童子",
    "rarity": 4,
    "pinyin": "cimutongzi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 3216,
      "defense": 396.9,
      "speed": 112,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "266": {
    "name": "青行灯",
    "rarity": 4,
    "pinyin": "qinghangdeng",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11620.84,
      "attack": 2438.8,
      "defense": 471.87,
      "speed": 119,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "267": {
    "name": "樱花妖",
    "rarity": 3,
    "pinyin": "yinghuayao",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13785.32,
      "attack": 2385.2,
      "defense": 396.9,
      "speed": 99,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "268": {
    "name": "惠比寿",
    "rarity": 3,
    "pinyin": "huibishou",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12873.96,
      "attack": 2358.4,
      "defense": 436.59,
      "speed": 107,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "269": {
    "name": "妖刀姬",
    "rarity": 4,
    "pinyin": "yaodaoji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10025.96,
      "attack": 3269.6,
      "defense": 396.9,
      "speed": 111,
      "crit": 0.12,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "270": {
    "name": "络新妇",
    "rarity": 3,
    "pinyin": "luoxinfu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 3537.6,
      "defense": 396.9,
      "speed": 118,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "271": {
    "name": "般若",
    "rarity": 3,
    "pinyin": "bore",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10595.56,
      "attack": 3135.6,
      "defense": 396.9,
      "speed": 114,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "272": {
    "name": "一目连",
    "rarity": 4,
    "pinyin": "yimulian",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13899.24,
      "attack": 2385.2,
      "defense": 392.49,
      "speed": 117,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "273": {
    "name": "青坊主",
    "rarity": 3,
    "pinyin": "qingfangzhu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13329.64,
      "attack": 2385.2,
      "defense": 414.54,
      "speed": 118,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "274": {
    "name": "古笼火",
    "rarity": 2,
    "pinyin": "gulonghuo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13215.72,
      "attack": 2519.2,
      "defense": 396.9,
      "speed": 117,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "275": {
    "name": "万年竹",
    "rarity": 3,
    "pinyin": "wannianzhu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10139.88,
      "attack": 3596.56,
      "defense": 392.49,
      "speed": 115,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "276": {
    "name": "夜叉",
    "rarity": 3,
    "pinyin": "yecha",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10139.88,
      "attack": 3269.6,
      "defense": 392.49,
      "speed": 110,
      "crit": 0.12,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "277": {
    "name": "黑童子",
    "rarity": 3,
    "pinyin": "heitongzi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9912.04,
      "attack": 3376.8,
      "defense": 383.67,
      "speed": 109,
      "crit": 0.09,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "278": {
    "name": "白童子",
    "rarity": 3,
    "pinyin": "baitongzi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10481.64,
      "attack": 3189.2,
      "defense": 392.49,
      "speed": 113,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "279": {
    "name": "花鸟卷",
    "rarity": 4,
    "pinyin": "huaniaojuan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 14127.08,
      "attack": 2304.8,
      "defense": 396.9,
      "speed": 112,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "280": {
    "name": "辉夜姬",
    "rarity": 4,
    "pinyin": "huiyeji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13785.32,
      "attack": 2331.6,
      "defense": 405.72,
      "speed": 108,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "281": {
    "name": "烟烟罗",
    "rarity": 3,
    "pinyin": "yanyanluo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10595.56,
      "attack": 3162.4,
      "defense": 392.49,
      "speed": 112,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "282": {
    "name": "金鱼姬",
    "rarity": 3,
    "pinyin": "jinyuji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13671.4,
      "attack": 2331.6,
      "defense": 410.13,
      "speed": 116,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "283": {
    "name": "荒",
    "rarity": 4,
    "pinyin": "huang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 3323.2,
      "defense": 489.51,
      "speed": 109,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "285": {
    "name": "鸩",
    "rarity": 3,
    "pinyin": "zhen",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3001.6,
      "defense": 388.08,
      "speed": 119,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "286": {
    "name": "以津真天",
    "rarity": 3,
    "pinyin": "yijinzhentian",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10025.96,
      "attack": 3269.6,
      "defense": 396.9,
      "speed": 110,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "287": {
    "name": "匣中少女",
    "rarity": 3,
    "pinyin": "xiazhongshaonv",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13671.4,
      "attack": 2438.8,
      "defense": 392.49,
      "speed": 119,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "288": {
    "name": "彼岸花",
    "rarity": 4,
    "pinyin": "bianhua",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3001.6,
      "defense": 388.08,
      "speed": 107,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "289": {
    "name": "兔丸",
    "rarity": 2,
    "pinyin": "tuwan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13215.72,
      "attack": 2412,
      "defense": 414.54,
      "speed": 116,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "290": {
    "name": "小松丸",
    "rarity": 3,
    "pinyin": "xiaosongwan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10823.4,
      "attack": 2921.2,
      "defense": 423.36,
      "speed": 115,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "291": {
    "name": "书翁",
    "rarity": 3,
    "pinyin": "shuweng",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 109,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "292": {
    "name": "雪童子",
    "rarity": 4,
    "pinyin": "xuetongzi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10025.96,
      "attack": 3323.2,
      "defense": 388.08,
      "speed": 121,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "293": {
    "name": "百目鬼",
    "rarity": 3,
    "pinyin": "baimugui",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9456.36,
      "attack": 2733.6,
      "defense": 507.15,
      "speed": 118,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "294": {
    "name": "奴良陆生",
    "rarity": 4,
    "pinyin": "nulianglusheng",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3028.4,
      "defense": 383.67,
      "speed": 113,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.5
    }
  },
  "295": {
    "name": "追月神",
    "rarity": 3,
    "pinyin": "zhuiyueshen",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12760.04,
      "attack": 2304.8,
      "defense": 449.82,
      "speed": 109,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "296": {
    "name": "山风",
    "rarity": 4,
    "pinyin": "shanfeng",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3403.6,
      "defense": 388.08,
      "speed": 115,
      "crit": 0.01,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "297": {
    "name": "日和坊",
    "rarity": 3,
    "pinyin": "rihefang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 14013.16,
      "attack": 2358.4,
      "defense": 392.49,
      "speed": 112,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "298": {
    "name": "薰",
    "rarity": 3,
    "pinyin": "xun",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13899.24,
      "attack": 2251.2,
      "defense": 396.9,
      "speed": 111,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "300": {
    "name": "玉藻前",
    "rarity": 4,
    "pinyin": "yuzaoqian",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12532.2,
      "attack": 3350,
      "defense": 352.8,
      "speed": 110,
      "crit": 0.12,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "301": {
    "name": "数珠",
    "rarity": 2,
    "pinyin": "shuzhu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11051.24,
      "attack": 2251.2,
      "defense": 485.1,
      "speed": 111,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.4
    }
  },
  "302": {
    "name": "小袖之手",
    "rarity": 2,
    "pinyin": "xiaoxiuzhishou",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11051.24,
      "attack": 2948,
      "defense": 401.31,
      "speed": 116,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "303": {
    "name": "弈",
    "rarity": 3,
    "pinyin": "yi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9912.04,
      "attack": 3001.6,
      "defense": 445.41,
      "speed": 106,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "304": {
    "name": "御馔津",
    "rarity": 4,
    "pinyin": "yuxuanjin",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12646.12,
      "attack": 3001.6,
      "defense": 449.82,
      "speed": 119,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "305": {
    "name": "卖药郎",
    "rarity": 4,
    "pinyin": "maiyaolang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 3350,
      "defense": 392.49,
      "speed": 112,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "306": {
    "name": "虫师",
    "rarity": 2,
    "pinyin": "chongshi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 14013.16,
      "attack": 2385.2,
      "defense": 388.08,
      "speed": 115,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "307": {
    "name": "猫掌柜",
    "rarity": 3,
    "pinyin": "maozhanggui",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10709.48,
      "attack": 3001.6,
      "defense": 414.54,
      "speed": 118,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "308": {
    "name": "鬼灯",
    "rarity": 4,
    "pinyin": "guideng",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9228.52,
      "attack": 3189.2,
      "defense": 441,
      "speed": 110,
      "crit": 0.1,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "309": {
    "name": "阿香",
    "rarity": 3,
    "pinyin": "axiang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10595.56,
      "attack": 3162.4,
      "defense": 401.31,
      "speed": 114,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "310": {
    "name": "蜜桃&芥子",
    "rarity": 2,
    "pinyin": "mitaojiezi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12418.28,
      "attack": 2063.6,
      "defense": 485.1,
      "speed": 110,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "311": {
    "name": "面灵气",
    "rarity": 4,
    "pinyin": "mianlingqi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10139.88,
      "attack": 3242.8,
      "defense": 396.9,
      "speed": 119,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "312": {
    "name": "鬼切",
    "rarity": 4,
    "pinyin": "guiqie",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10823.4,
      "attack": 3350,
      "defense": 352.8,
      "speed": 117,
      "crit": 0.11,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "313": {
    "name": "犬夜叉",
    "rarity": 4,
    "pinyin": "quanyecha",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 2974.8,
      "defense": 392.49,
      "speed": 114,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "314": {
    "name": "杀生丸",
    "rarity": 4,
    "pinyin": "shashengwan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10025.96,
      "attack": 3323.2,
      "defense": 388.08,
      "speed": 118,
      "crit": 0.12,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "315": {
    "name": "少羽大天狗",
    "rarity": 5,
    "pinyin": "shaoyudatiangou",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 9684.2,
      "attack": 3484,
      "defense": 374.85,
      "speed": 122,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "316": {
    "name": "白藏主",
    "rarity": 4,
    "pinyin": "baizangzhu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 14241,
      "attack": 1822.4,
      "defense": 471.87,
      "speed": 111,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "317": {
    "name": "人面树",
    "rarity": 3,
    "pinyin": "renmianshu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12987.88,
      "attack": 1795.6,
      "defense": 511.56,
      "speed": 98,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "318": {
    "name": "於菊虫",
    "rarity": 3,
    "pinyin": "yujuchong",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11962.6,
      "attack": 2948,
      "defense": 374.85,
      "speed": 109,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "319": {
    "name": "桔梗",
    "rarity": 4,
    "pinyin": "jiegeng",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10595.56,
      "attack": 3108.8,
      "defense": 401.31,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "320": {
    "name": "一反木绵",
    "rarity": 3,
    "pinyin": "yifanmumian",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11734.76,
      "attack": 2733.6,
      "defense": 418.95,
      "speed": 118,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "321": {
    "name": "入殓师",
    "rarity": 3,
    "pinyin": "rulianshi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9342.44,
      "attack": 3028.4,
      "defense": 463.05,
      "speed": 104,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "322": {
    "name": "炼狱茨木童子",
    "rarity": 5,
    "pinyin": "lianyucimutongzi",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 3323.2,
      "defense": 379.26,
      "speed": 112,
      "crit": 0.15,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "323": {
    "name": "天井下",
    "rarity": 2,
    "pinyin": "tianjingxia",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11962.6,
      "attack": 2251.2,
      "defense": 489.51,
      "speed": 109,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "324": {
    "name": "化鲸",
    "rarity": 3,
    "pinyin": "huajing",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12873.96,
      "attack": 2840.8,
      "defense": 357.21,
      "speed": 111,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "325": {
    "name": "八岐大蛇",
    "rarity": 4,
    "pinyin": "baqidashe",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12418.28,
      "attack": 4073.6,
      "defense": 480.69,
      "speed": 118,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "326": {
    "name": "稻荷神御馔津",
    "rarity": 5,
    "pinyin": "daoheshenyuxuanjin",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3082,
      "defense": 485.1,
      "speed": 109,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "327": {
    "name": "苍风一目连",
    "rarity": 5,
    "pinyin": "cangfengyimulian",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3296.4,
      "defense": 339.57,
      "speed": 121,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "328": {
    "name": "赤影妖刀姬",
    "rarity": 5,
    "pinyin": "chiyingyaodaoji",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 9912.04,
      "attack": 3376.8,
      "defense": 383.67,
      "speed": 111,
      "crit": 0.12,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "329": {
    "name": "海忍",
    "rarity": 3,
    "pinyin": "hairen",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10367.72,
      "attack": 3216,
      "defense": 432.18,
      "speed": 111,
      "crit": 0.09,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "330": {
    "name": "不知火",
    "rarity": 4,
    "pinyin": "buzhihuo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9228.52,
      "attack": 3457.2,
      "defense": 396.9,
      "speed": 117,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "331": {
    "name": "御怨般若",
    "rarity": 5,
    "pinyin": "yuyuanbore",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11734.76,
      "attack": 3055.2,
      "defense": 383.67,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "332": {
    "name": "久次良",
    "rarity": 3,
    "pinyin": "jiuciliang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9114.6,
      "attack": 2948,
      "defense": 485.1,
      "speed": 109,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "333": {
    "name": "大岳丸",
    "rarity": 4,
    "pinyin": "dayuewan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12646.12,
      "attack": 3323.2,
      "defense": 396.9,
      "speed": 108,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "334": {
    "name": "骁浪荒川之主",
    "rarity": 5,
    "pinyin": "xiaolanghuangchuanzhizhu",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11279.08,
      "attack": 3403.6,
      "defense": 383.67,
      "speed": 110,
      "crit": 0.2,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "335": {
    "name": "蟹姬",
    "rarity": 3,
    "pinyin": "xieji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11051.24,
      "attack": 3242.8,
      "defense": 361.62,
      "speed": 108,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "336": {
    "name": "朽木露琪亚",
    "rarity": 3,
    "pinyin": "xiumulouqiya",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10595.56,
      "attack": 3162.4,
      "defense": 401.31,
      "speed": 114,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "337": {
    "name": "黑崎一护",
    "rarity": 4,
    "pinyin": "heiqiyihu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9898.37,
      "attack": 3198.04,
      "defense": 398,
      "speed": 110,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "338": {
    "name": "泷夜叉姬",
    "rarity": 4,
    "pinyin": "longyechaji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10025.96,
      "attack": 3510.8,
      "defense": 357.21,
      "speed": 120,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "339": {
    "name": "烬天玉藻前",
    "rarity": 5,
    "pinyin": "jintianyuzaoqian",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 12532.2,
      "attack": 3510.8,
      "defense": 388.08,
      "speed": 115,
      "crit": 0.12,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "340": {
    "name": "纸舞",
    "rarity": 3,
    "pinyin": "zhiwu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11620.84,
      "attack": 2546,
      "defense": 454.23,
      "speed": 109,
      "crit": 0.06,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "341": {
    "name": "鬼王酒吞童子",
    "rarity": 5,
    "pinyin": "guiwangjiutuntongzi",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11962.6,
      "attack": 3189.2,
      "defense": 445.41,
      "speed": 109,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "342": {
    "name": "星熊童子",
    "rarity": 3,
    "pinyin": "xingxiongtongzi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13557.48,
      "attack": 2358.4,
      "defense": 480.69,
      "speed": 115,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "343": {
    "name": "天剑韧心鬼切",
    "rarity": 5,
    "pinyin": "tianjianrenxinguiqie",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10937.32,
      "attack": 3403.6,
      "defense": 339.57,
      "speed": 119,
      "crit": 0.12,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "344": {
    "name": "云外镜",
    "rarity": 4,
    "pinyin": "yunwaijing",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 8317.16,
      "attack": 3028.4,
      "defense": 498.33,
      "speed": 109,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "345": {
    "name": "鬼童丸",
    "rarity": 4,
    "pinyin": "guitongwan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10139.88,
      "attack": 3395.56,
      "defense": 392.49,
      "speed": 118,
      "crit": 0.11,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "346": {
    "name": "聆海金鱼姬",
    "rarity": 5,
    "pinyin": "linghaijinyuji",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11051.24,
      "attack": 3001.6,
      "defense": 401.31,
      "speed": 111,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "347": {
    "name": "缘结神",
    "rarity": 4,
    "pinyin": "yuanjieshen",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13443.56,
      "attack": 2197.6,
      "defense": 441,
      "speed": 110,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "348": {
    "name": "浮世青行灯",
    "rarity": 5,
    "pinyin": "fushiqinghangdeng",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11506.92,
      "attack": 2733.6,
      "defense": 427.77,
      "speed": 119,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "349": {
    "name": "风狸",
    "rarity": 3,
    "pinyin": "fengli",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3601.92,
      "defense": 388.08,
      "speed": 109,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "350": {
    "name": "蝎女",
    "rarity": 3,
    "pinyin": "xienv",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11279.08,
      "attack": 2974.8,
      "defense": 396.9,
      "speed": 107,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "351": {
    "name": "铃鹿御前",
    "rarity": 4,
    "pinyin": "lingluyuqian",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13215.72,
      "attack": 3269.6,
      "defense": 383.67,
      "speed": 110,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "352": {
    "name": "缚骨清姬",
    "rarity": 5,
    "pinyin": "fuguqingji",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 12042.34,
      "attack": 3028.4,
      "defense": 398.22,
      "speed": 118,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "353": {
    "name": "紧那罗",
    "rarity": 4,
    "pinyin": "jinneiluo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10709.48,
      "attack": 3108.8,
      "defense": 396.9,
      "speed": 115,
      "crit": 0.15,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "354": {
    "name": "待宵姑获鸟",
    "rarity": 5,
    "pinyin": "daixiaoguhuoniao",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10481.64,
      "attack": 3269.6,
      "defense": 379.26,
      "speed": 115,
      "crit": 0.12,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "355": {
    "name": "麓铭大岳丸",
    "rarity": 5,
    "pinyin": "lumingdayuewan",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3350,
      "defense": 441,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "356": {
    "name": "千姬",
    "rarity": 4,
    "pinyin": "qianji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12532.2,
      "attack": 2948,
      "defense": 410.13,
      "speed": 121,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "357": {
    "name": "初翎山风",
    "rarity": 5,
    "pinyin": "chulingshanfeng",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3296.4,
      "defense": 388.08,
      "speed": 116,
      "crit": 0.12,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "358": {
    "name": "夜溟彼岸花",
    "rarity": 5,
    "pinyin": "yemibianhua",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10823.4,
      "attack": 3350,
      "defense": 352.8,
      "speed": 108,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "359": {
    "name": "灶门炭治郎",
    "rarity": 4,
    "pinyin": "zaomentanzhilang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10481.64,
      "attack": 3135.6,
      "defense": 401.31,
      "speed": 110,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "360": {
    "name": "灶门祢豆子",
    "rarity": 4,
    "pinyin": "zaomennidouzi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3001.6,
      "defense": 388.08,
      "speed": 118,
      "crit": 0.09,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "361": {
    "name": "垢尝",
    "rarity": 2,
    "pinyin": "gouchang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11962.6,
      "attack": 2492.4,
      "defense": 449.82,
      "speed": 109,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.6
    }
  },
  "362": {
    "name": "蝉冰雪女",
    "rarity": 5,
    "pinyin": "chanbingxuenv",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10025.96,
      "attack": 2680,
      "defense": 493.92,
      "speed": 109,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "363": {
    "name": "帝释天",
    "rarity": 4,
    "pinyin": "dishitian",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 15380.2,
      "attack": 3108.8,
      "defense": 436.59,
      "speed": 111,
      "crit": 0.09,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "364": {
    "name": "阿修罗",
    "rarity": 4,
    "pinyin": "axiuluo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11279.08,
      "attack": 4127.2,
      "defense": 427.77,
      "speed": 119,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "365": {
    "name": "入内雀",
    "rarity": 3,
    "pinyin": "runeique",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9114.6,
      "attack": 2787.2,
      "defense": 507.15,
      "speed": 114,
      "crit": 0.09,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "366": {
    "name": "空相面灵气",
    "rarity": 5,
    "pinyin": "kongxiangmianlingqi",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10481.64,
      "attack": 3162.4,
      "defense": 396.9,
      "speed": 119,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "367": {
    "name": "绘世花鸟卷",
    "rarity": 5,
    "pinyin": "huishihuaniaojuan",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 14468.84,
      "attack": 2278,
      "defense": 388.08,
      "speed": 112,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "368": {
    "name": "饴细工",
    "rarity": 3,
    "pinyin": "yixigong",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 14354.92,
      "attack": 2492.4,
      "defense": 480.69,
      "speed": 113,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "369": {
    "name": "食灵",
    "rarity": 4,
    "pinyin": "shiling",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3028.4,
      "defense": 396.9,
      "speed": 119,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "370": {
    "name": "饭笥",
    "rarity": 4,
    "pinyin": "fansi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10823.4,
      "attack": 3162.4,
      "defense": 396.9,
      "speed": 112,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "371": {
    "name": "川猿",
    "rarity": 3,
    "pinyin": "chuanyuan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12190.44,
      "attack": 2814,
      "defense": 401.31,
      "speed": 123,
      "crit": 0.09,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "372": {
    "name": "因幡辉夜姬",
    "rarity": 5,
    "pinyin": "yinfanhuiyeji",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 2949.07,
      "defense": 396.9,
      "speed": 113,
      "crit": 0.08,
      "critDamage": 1.65,
      "hit": 0,
      "resist": 0
    }
  },
  "373": {
    "name": "夜刀神",
    "rarity": 4,
    "pinyin": "yedaoshen",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11051.24,
      "attack": 3028.4,
      "defense": 396.9,
      "speed": 113,
      "crit": 0.09,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "375": {
    "name": "影鳄",
    "rarity": 2,
    "pinyin": "yinge",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10139.88,
      "attack": 3001.6,
      "defense": 523.91,
      "speed": 116,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "376": {
    "name": "铃彦姬",
    "rarity": 4,
    "pinyin": "lingyanji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9251.3,
      "attack": 3195.07,
      "defense": 441,
      "speed": 114,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "377": {
    "name": "梦寻山兔",
    "rarity": 5,
    "pinyin": "mengxunshantu",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10481.64,
      "attack": 3031.08,
      "defense": 418.07,
      "speed": 116,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "378": {
    "name": "迦楼罗",
    "rarity": 3,
    "pinyin": "jialouluo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10595.56,
      "attack": 3055.2,
      "defense": 410.13,
      "speed": 112,
      "crit": 0.09,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "379": {
    "name": "不见岳",
    "rarity": 4,
    "pinyin": "bujianyue",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12532.2,
      "attack": 2492.4,
      "defense": 538.02,
      "speed": 115,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "382": {
    "name": "灵海蝶",
    "rarity": 3,
    "pinyin": "linghaidie",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12532.2,
      "attack": 2358.4,
      "defense": 449.82,
      "speed": 116,
      "crit": 0.06,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "383": {
    "name": "神堕八岐大蛇",
    "rarity": 5,
    "pinyin": "shenduobaqidashe",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 13215.72,
      "attack": 4153,
      "defense": 436.59,
      "speed": 118,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "384": {
    "name": "粉婆婆",
    "rarity": 3,
    "pinyin": "fenpopo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12418.28,
      "attack": 2503.12,
      "defense": 432.18,
      "speed": 121,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "385": {
    "name": "大夜摩天阎魔",
    "rarity": 5,
    "pinyin": "dayemotianyanmo",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 12805.61,
      "attack": 2144,
      "defense": 476.28,
      "speed": 123,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "386": {
    "name": "我妻善逸",
    "rarity": 4,
    "pinyin": "woqishanyi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10367.72,
      "attack": 3403.6,
      "defense": 361.62,
      "speed": 117,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "387": {
    "name": "嘴平伊之助",
    "rarity": 4,
    "pinyin": "zuipingyizhizhu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11962.6,
      "attack": 2760.4,
      "defense": 405.72,
      "speed": 119,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "388": {
    "name": "心狩鬼女红叶",
    "rarity": 5,
    "pinyin": "xinshouguinvhongye",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11279.08,
      "attack": 3135.6,
      "defense": 370.44,
      "speed": 114,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "389": {
    "name": "须佐之男",
    "rarity": 4,
    "pinyin": "xuzuozhinan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11734.76,
      "attack": 4154,
      "defense": 493.92,
      "speed": 112,
      "crit": 0.12,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "390": {
    "name": "神启荒",
    "rarity": 5,
    "pinyin": "shenqihuang",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 13101.8,
      "attack": 3671.6,
      "defense": 432.18,
      "speed": 116,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "391": {
    "name": "寻香行",
    "rarity": 4,
    "pinyin": "xunxianghang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9228.52,
      "attack": 3510.8,
      "defense": 388.08,
      "speed": 117,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "392": {
    "name": "季",
    "rarity": 4,
    "pinyin": "ji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "suspect",
    "base": {
      "hp": 11165.16,
      "attack": 3564.4,
      "defense": 436.59,
      "speed": 118,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "393": {
    "name": "禅心云外镜",
    "rarity": 5,
    "pinyin": "chanxinyunwaijing",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 12839.78,
      "attack": 2098.44,
      "defense": 480.69,
      "speed": 113,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.75
    }
  },
  "394": {
    "name": "月读",
    "rarity": 4,
    "pinyin": "yuedu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 15391.59,
      "attack": 3400.92,
      "defense": 388.08,
      "speed": 118,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "395": {
    "name": "流光追月神",
    "rarity": 5,
    "pinyin": "liuguangzhuiyueshen",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 12873.96,
      "attack": 2224.4,
      "defense": 458.64,
      "speed": 111,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "396": {
    "name": "修罗鬼童丸",
    "rarity": 5,
    "pinyin": "xiuluoguitongwan",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11506.92,
      "attack": 3028.4,
      "defense": 401.31,
      "speed": 114,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "397": {
    "name": "坂田银时",
    "rarity": 4,
    "pinyin": "bantianyinshi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11404.39,
      "attack": 3100.76,
      "defense": 371.32,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "398": {
    "name": "天逆每",
    "rarity": 3,
    "pinyin": "tiannimei",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13671.4,
      "attack": 1902.8,
      "defense": 480.69,
      "speed": 118,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "399": {
    "name": "言灵",
    "rarity": 4,
    "pinyin": "yanling",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11734.76,
      "attack": 3123.27,
      "defense": 471.87,
      "speed": 109,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "400": {
    "name": "盗墓小鬼",
    "rarity": 1,
    "pinyin": "daomuxiaogui",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "npc",
    "base": {
      "hp": 10253.8,
      "attack": 2412,
      "defense": 396.9,
      "speed": 100,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "401": {
    "name": "寄生魂",
    "rarity": 1,
    "pinyin": "jishenghun",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "npc",
    "base": {
      "hp": 10253.8,
      "attack": 2412,
      "defense": 396.9,
      "speed": 100,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "403": {
    "name": "唐纸伞妖",
    "rarity": 1,
    "pinyin": "tangzhisanyao",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "npc",
    "base": {
      "hp": 10253.8,
      "attack": 2412,
      "defense": 396.9,
      "speed": 100,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "404": {
    "name": "天邪鬼绿",
    "rarity": 1,
    "pinyin": "tianxieguilu",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "npc",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "405": {
    "name": "天邪鬼赤",
    "rarity": 1,
    "pinyin": "tianxieguichi",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "npc",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "406": {
    "name": "天邪鬼黄",
    "rarity": 1,
    "pinyin": "tianxieguihuang",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "npc",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "407": {
    "name": "天邪鬼青",
    "rarity": 1,
    "pinyin": "tianxieguiqing",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "npc",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "408": {
    "name": "帚神",
    "rarity": 1,
    "pinyin": "zhoushen",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "npc",
    "base": {
      "hp": 10253.8,
      "attack": 2412,
      "defense": 396.9,
      "speed": 100,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "409": {
    "name": "涂壁",
    "rarity": 1,
    "pinyin": "tubi",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "npc",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "410": {
    "name": "招福达摩",
    "rarity": 1,
    "pinyin": "zhaofudamo",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "npc",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "411": {
    "name": "御行达摩",
    "rarity": 1,
    "pinyin": "yuhangdamo",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "npc",
    "base": {
      "hp": 10253.8,
      "attack": 2412,
      "defense": 396.9,
      "speed": 100,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "412": {
    "name": "奉为达摩",
    "rarity": 1,
    "pinyin": "fengweidamo",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "npc",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "413": {
    "name": "大吉达摩",
    "rarity": 1,
    "pinyin": "dajidamo",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "npc",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "414": {
    "name": "大天狗呱",
    "rarity": 1,
    "pinyin": "datiangougua",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "suspect",
    "base": {
      "hp": 11165.16,
      "attack": 2733.6,
      "defense": 441,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "415": {
    "name": "酒吞呱",
    "rarity": 1,
    "pinyin": "jiutungua",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "suspect",
    "base": {
      "hp": 11279.08,
      "attack": 2706.8,
      "defense": 445.41,
      "speed": 109,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "416": {
    "name": "荒川呱",
    "rarity": 1,
    "pinyin": "huangchuangua",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "suspect",
    "base": {
      "hp": 11393,
      "attack": 2760.4,
      "defense": 432.18,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "417": {
    "name": "阎魔呱",
    "rarity": 1,
    "pinyin": "yanmogua",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "suspect",
    "base": {
      "hp": 10481.64,
      "attack": 2278,
      "defense": 396.9,
      "speed": 102,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "418": {
    "name": "两面佛呱",
    "rarity": 1,
    "pinyin": "liangmianfogua",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "suspect",
    "base": {
      "hp": 11393,
      "attack": 2706.8,
      "defense": 423.36,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "419": {
    "name": "小鹿男呱",
    "rarity": 1,
    "pinyin": "xiaolunangua",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "suspect",
    "base": {
      "hp": 11734.76,
      "attack": 2599.6,
      "defense": 441,
      "speed": 111,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "420": {
    "name": "茨木呱",
    "rarity": 1,
    "pinyin": "cimugua",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "npc",
    "base": {
      "hp": 11393,
      "attack": 2680,
      "defense": 441,
      "speed": 110,
      "crit": 0.01,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "421": {
    "name": "青行灯呱",
    "rarity": 1,
    "pinyin": "qinghangdenggua",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "suspect",
    "base": {
      "hp": 11393,
      "attack": 2653.2,
      "defense": 445.41,
      "speed": 111,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "422": {
    "name": "妖刀姬呱",
    "rarity": 1,
    "pinyin": "yaodaojigua",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "suspect",
    "base": {
      "hp": 10253.8,
      "attack": 2465.6,
      "defense": 379.26,
      "speed": 99,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "423": {
    "name": "一目连呱",
    "rarity": 1,
    "pinyin": "yimuliangua",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "suspect",
    "base": {
      "hp": 11506.92,
      "attack": 2626.4,
      "defense": 445.41,
      "speed": 110,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "424": {
    "name": "花鸟卷呱",
    "rarity": 1,
    "pinyin": "huaniaojuangua",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "suspect",
    "base": {
      "hp": 10481.64,
      "attack": 2331.6,
      "defense": 396.9,
      "speed": 100,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "425": {
    "name": "辉夜姬呱",
    "rarity": 1,
    "pinyin": "huiyejigua",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "suspect",
    "base": {
      "hp": 10253.8,
      "attack": 2304.8,
      "defense": 405.72,
      "speed": 98,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "426": {
    "name": "荒呱",
    "rarity": 1,
    "pinyin": "huanggua",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "suspect",
    "base": {
      "hp": 10253.8,
      "attack": 2438.8,
      "defense": 392.49,
      "speed": 99,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "427": {
    "name": "彼岸花呱",
    "rarity": 1,
    "pinyin": "bianhuagua",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "suspect",
    "base": {
      "hp": 10139.88,
      "attack": 2412,
      "defense": 401.31,
      "speed": 100,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "428": {
    "name": "雪童子呱",
    "rarity": 1,
    "pinyin": "xuetongzigua",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "suspect",
    "base": {
      "hp": 10253.8,
      "attack": 2438.8,
      "defense": 392.49,
      "speed": 99,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "429": {
    "name": "玉藻前呱",
    "rarity": 1,
    "pinyin": "yuzaoqiangua",
    "awake": true,
    "awakeStatus": "awake1-fetched",
    "kind": "suspect",
    "base": {
      "hp": 10253.8,
      "attack": 3028.4,
      "defense": 405.72,
      "speed": 107,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "430": {
    "name": "御馔津呱",
    "rarity": 1,
    "pinyin": "yuxuanjingua",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "suspect",
    "base": {
      "hp": 10253.8,
      "attack": 2412,
      "defense": 396.9,
      "speed": 95,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "433": {
    "name": "生剥鬼",
    "rarity": 1,
    "pinyin": "shengbogui",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "npc",
    "base": {
      "hp": 10253.8,
      "attack": 2412,
      "defense": 396.9,
      "speed": 100,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "499": {
    "name": "鬼武达摩",
    "rarity": 1,
    "pinyin": "guiwudamo",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "npc",
    "base": {
      "hp": 10253.8,
      "attack": 2412,
      "defense": 396.9,
      "speed": 100,
      "crit": 0,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "500": {
    "name": "神乐&定春",
    "rarity": 4,
    "pinyin": "shenyuedingchun",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11062.63,
      "attack": 3047.16,
      "defense": 393.37,
      "speed": 117,
      "crit": 0.09,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.4
    }
  },
  "550": {
    "name": "孔雀明王",
    "rarity": 4,
    "pinyin": "kongquemingwang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11165.16,
      "attack": 3537.6,
      "defense": 441,
      "speed": 119,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0.3,
      "resist": 0
    }
  },
  "551": {
    "name": "寻森小鹿男",
    "rarity": 5,
    "pinyin": "xunsenxiaolunan",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11734.76,
      "attack": 2680,
      "defense": 427.77,
      "speed": 120,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.3
    }
  },
  "552": {
    "name": "慧明灯",
    "rarity": 3,
    "pinyin": "huimingdeng",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12532.2,
      "attack": 2251.2,
      "defense": 467.46,
      "speed": 122,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.3
    }
  },
  "553": {
    "name": "闻人翊悬",
    "rarity": 4,
    "pinyin": "wenrenyixuan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11506.92,
      "attack": 3604.6,
      "defense": 431.3,
      "speed": 115,
      "crit": 0.2,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "554": {
    "name": "纺愿缘结神",
    "rarity": 5,
    "pinyin": "fangyuanyuanjieshen",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 13557.48,
      "attack": 2224.4,
      "defense": 432.18,
      "speed": 108,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "555": {
    "name": "渺念萤草",
    "rarity": 5,
    "pinyin": "miaonianyingcao",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10709.48,
      "attack": 3135.6,
      "defense": 396.9,
      "speed": 114,
      "crit": 0.1,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "556": {
    "name": "天照",
    "rarity": 4,
    "pinyin": "tianzhao",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11962.6,
      "attack": 3886,
      "defense": 595.35,
      "speed": 119,
      "crit": 0.12,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "557": {
    "name": "伊邪那美",
    "rarity": 4,
    "pinyin": "yixieneimei",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12076.52,
      "attack": 3618,
      "defense": 449.82,
      "speed": 116,
      "crit": 0.2,
      "critDamage": 1.5,
      "hit": 0.2,
      "resist": 0
    }
  },
  "558": {
    "name": "盗人神",
    "rarity": 3,
    "pinyin": "daorenshen",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11506.92,
      "attack": 2492.4,
      "defense": 467.46,
      "speed": 120,
      "crit": 0.05,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "559": {
    "name": "本真三尾狐",
    "rarity": 5,
    "pinyin": "benzhensanweihu",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 9684.2,
      "attack": 3350,
      "defense": 396.9,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "561": {
    "name": "泷",
    "rarity": 4,
    "pinyin": "long",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11506.92,
      "attack": 2170.8,
      "defense": 520.38,
      "speed": 118,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "562": {
    "name": "鲸汐千姬",
    "rarity": 5,
    "pinyin": "jingxiqianji",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 12418.28,
      "attack": 3108.8,
      "defense": 388.08,
      "speed": 114,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "563": {
    "name": "初音未来",
    "rarity": 4,
    "pinyin": "chuyinweilai",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 14013.16,
      "attack": 2170.8,
      "defense": 423.36,
      "speed": 116,
      "crit": 0.09,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "564": {
    "name": "镜音铃·连",
    "rarity": 4,
    "pinyin": "jingyinlinglian",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 16405.68,
      "attack": 1983.2,
      "defense": 467.46,
      "speed": 115,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "565": {
    "name": "福悦座敷童子",
    "rarity": 5,
    "pinyin": "fuyuezuofutongzi",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 12532.2,
      "attack": 2224.4,
      "defense": 471.87,
      "speed": 126,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "566": {
    "name": "晨晖惠比寿",
    "rarity": 5,
    "pinyin": "chenhuihuibishou",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 12987.88,
      "attack": 2278,
      "defense": 445.41,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "567": {
    "name": "申屠子夜",
    "rarity": 4,
    "pinyin": "shentuziye",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11506.92,
      "attack": 3516.16,
      "defense": 431.3,
      "speed": 108,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "568": {
    "name": "龙吟铃鹿御前",
    "rarity": 5,
    "pinyin": "longyinlingluyuqian",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 13557.48,
      "attack": 3269.6,
      "defense": 480.69,
      "speed": 117,
      "crit": 0.1,
      "critDamage": 1.8,
      "hit": 0,
      "resist": 0
    }
  },
  "569": {
    "name": "猫川",
    "rarity": 4,
    "pinyin": "maochuan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10367.72,
      "attack": 3376.8,
      "defense": 366.03,
      "speed": 118,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "570": {
    "name": "祸津神",
    "rarity": 4,
    "pinyin": "huojinshen",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 15539.79,
      "attack": 2626.4,
      "defense": 454.23,
      "speed": 116,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "571": {
    "name": "湍津姬",
    "rarity": 3,
    "pinyin": "tuanjinji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12760.04,
      "attack": 2251.2,
      "defense": 458.64,
      "speed": 109,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.4
    }
  },
  "572": {
    "name": "遥念烟烟罗",
    "rarity": 5,
    "pinyin": "yaonianyanyanluo",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 12190.44,
      "attack": 2412,
      "defense": 454.23,
      "speed": 114,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "573": {
    "name": "龙珏",
    "rarity": 4,
    "pinyin": "longjue",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12646.12,
      "attack": 3786.04,
      "defense": 386.89,
      "speed": 118,
      "crit": 0.2,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "574": {
    "name": "心友犬神",
    "rarity": 5,
    "pinyin": "xinyouquanshen",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11506.92,
      "attack": 3108.8,
      "defense": 366.03,
      "speed": 110,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.3
    }
  },
  "575": {
    "name": "封阳君",
    "rarity": 4,
    "pinyin": "fengyangjun",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10823.4,
      "attack": 3108.8,
      "defense": 392.49,
      "speed": 116,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0.3,
      "resist": 0
    }
  },
  "576": {
    "name": "夏目&猫老师",
    "rarity": 4,
    "pinyin": "xiamumaolaoshi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 2948,
      "defense": 396.9,
      "speed": 117,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.3
    }
  },
  "577": {
    "name": "鬼金羊",
    "rarity": 4,
    "pinyin": "guijinyang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12646.12,
      "attack": 2010,
      "defense": 507.15,
      "speed": 118,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0.3,
      "resist": 0
    }
  },
  "578": {
    "name": "神酿星熊童子",
    "rarity": 5,
    "pinyin": "shenniangxingxiongtongzi",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 13557.48,
      "attack": 2224.4,
      "defense": 432.18,
      "speed": 108,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "579": {
    "name": "瑶音紧那罗",
    "rarity": 5,
    "pinyin": "yaoyinjinneiluo",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11165.16,
      "attack": 3296.4,
      "defense": 414.54,
      "speed": 115,
      "crit": 0.15,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "580": {
    "name": "晴思日和坊",
    "rarity": 5,
    "pinyin": "qingsirihefang",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 2948,
      "defense": 396.9,
      "speed": 114,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "581": {
    "name": "歌留多",
    "rarity": 4,
    "pinyin": "geliuduo",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11136.83,
      "attack": 3296.4,
      "defense": 405.72,
      "speed": 118,
      "crit": 0.11,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "582": {
    "name": "巡音流歌",
    "rarity": 4,
    "pinyin": "xunyinliuge",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13671.4,
      "attack": 2197.6,
      "defense": 432.18,
      "speed": 115,
      "crit": 0.02,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.25
    }
  },
  "583": {
    "name": "卑弥呼",
    "rarity": 4,
    "pinyin": "beimihu",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12304.36,
      "attack": 3242.8,
      "defense": 445.41,
      "speed": 119,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "584": {
    "name": "时曜泷夜叉姬",
    "rarity": 5,
    "pinyin": "shiyaolongyechaji",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3510.8,
      "defense": 436.59,
      "speed": 116,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "585": {
    "name": "荒骷髅",
    "rarity": 4,
    "pinyin": "huangkulou",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 14924.52,
      "attack": 1849.2,
      "defense": 441,
      "speed": 118,
      "crit": 0.03,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "586": {
    "name": "云间不见岳",
    "rarity": 5,
    "pinyin": "yunjianbujianyue",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 2412,
      "defense": 595.35,
      "speed": 109,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "587": {
    "name": "木之本樱",
    "rarity": 4,
    "pinyin": "muzhibenying",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10709.48,
      "attack": 3055.2,
      "defense": 405.72,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0.3,
      "resist": 0
    }
  },
  "588": {
    "name": "李小狼",
    "rarity": 4,
    "pinyin": "lixiaolang",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 3216,
      "defense": 396.9,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "590": {
    "name": "妙主九命猫",
    "rarity": 5,
    "pinyin": "miaozhujiumingmao",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11051.24,
      "attack": 3001.6,
      "defense": 401.31,
      "speed": 109,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.75
    }
  },
  "591": {
    "name": "雪御前",
    "rarity": 4,
    "pinyin": "xueyuqian",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12919.53,
      "attack": 3912.8,
      "defense": 549.49,
      "speed": 117,
      "crit": 0.13,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "592": {
    "name": "平将门",
    "rarity": 4,
    "pinyin": "pingjiangmen",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 4020,
      "defense": 595.35,
      "speed": 116,
      "crit": 0.1,
      "critDamage": 1.6,
      "hit": 0,
      "resist": 0
    }
  },
  "593": {
    "name": "妖刀姬·绯夜猎刃",
    "rarity": 6,
    "pinyin": "yaodaojifeiyelieren",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10595.56,
      "attack": 3269.6,
      "defense": 374.85,
      "speed": 116,
      "crit": 0.12,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "594": {
    "name": "梦引蝴蝶精",
    "rarity": 5,
    "pinyin": "mengyinhudiejing",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 13785.32,
      "attack": 1876,
      "defense": 480.69,
      "speed": 113,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "595": {
    "name": "梦山白藏主",
    "rarity": 5,
    "pinyin": "mengshanbaizangzhu",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 15152.36,
      "attack": 1340,
      "defense": 515.97,
      "speed": 111,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "596": {
    "name": "神无月",
    "rarity": 4,
    "pinyin": "shenwuyue",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 13899.24,
      "attack": 2010,
      "defense": 454.23,
      "speed": 110,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "597": {
    "name": "葛叶",
    "rarity": 4,
    "pinyin": "geye",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12532.2,
      "attack": 3966.4,
      "defense": 493.92,
      "speed": 117,
      "crit": 0.12,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "598": {
    "name": "灼华桃花妖",
    "rarity": 5,
    "pinyin": "zhuohuataohuayao",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 12532.2,
      "attack": 2144,
      "defense": 485.1,
      "speed": 110,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "599": {
    "name": "蚀月吸血姬",
    "rarity": 5,
    "pinyin": "shiyuexixueji",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10937.32,
      "attack": 3216,
      "defense": 441,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "600": {
    "name": "市加美",
    "rarity": 4,
    "pinyin": "shijiamei",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11506.92,
      "attack": 3216,
      "defense": 392.49,
      "speed": 118,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "601": {
    "name": "思金神",
    "rarity": 4,
    "pinyin": "sijinshen",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 14696.68,
      "attack": 2144,
      "defense": 533.61,
      "speed": 110,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.3
    }
  },
  "602": {
    "name": "天火命铃彦姬",
    "rarity": 5,
    "pinyin": "tianhuominglingyanji",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 11506.92,
      "attack": 3510.8,
      "defense": 432.18,
      "speed": 114,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "603": {
    "name": "毗沙门天",
    "rarity": 4,
    "pinyin": "pishamentian",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 11393,
      "attack": 3591.2,
      "defense": 423.36,
      "speed": 115,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0.3
    }
  },
  "604": {
    "name": "不相狐禅",
    "rarity": 4,
    "pinyin": "buxianghuchan",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 9798.12,
      "attack": 3403.6,
      "defense": 383.67,
      "speed": 119,
      "crit": 0.2,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "605": {
    "name": "洛天依",
    "rarity": 4,
    "pinyin": "luotianyi",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 14468.84,
      "attack": 2144,
      "defense": 410.13,
      "speed": 116,
      "crit": 0.09,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "606": {
    "name": "言和",
    "rarity": 4,
    "pinyin": "yanhe",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 16291.66,
      "attack": 2010,
      "defense": 418.95,
      "speed": 110,
      "crit": 0.08,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "607": {
    "name": "百羽凤凰火",
    "rarity": 5,
    "pinyin": "baiyufenghuanghuo",
    "awake": false,
    "awakeStatus": "awake0-complete",
    "kind": "shikigami",
    "base": {
      "hp": 10253.8,
      "attack": 2680,
      "defense": 352.8,
      "speed": 112,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  },
  "608": {
    "name": "石长姬",
    "rarity": 4,
    "pinyin": "shizhangji",
    "awake": true,
    "awakeStatus": "awake1",
    "kind": "shikigami",
    "base": {
      "hp": 12839.78,
      "attack": 3899.4,
      "defense": 551.25,
      "speed": 120,
      "crit": 0.1,
      "critDamage": 1.5,
      "hit": 0,
      "resist": 0
    }
  }
};

/** 客户端 heroId -> 目录 id；属性系数与目录行完全一致（安全） */
export const heroBaseAliasStrict: Readonly<Record<number, number>> = {
  200: 200, 201: 201, 202: 202, 203: 203, 205: 205, 206: 206, 207: 207, 208: 208,
  209: 209, 210: 210, 211: 211, 212: 212, 213: 213, 214: 214, 215: 215, 216: 216,
  217: 217, 218: 218, 219: 219, 220: 220, 221: 221, 222: 222, 223: 223, 224: 224,
  225: 225, 226: 226, 227: 227, 228: 228, 230: 230, 231: 231, 232: 232, 233: 233,
  234: 234, 236: 236, 237: 237, 238: 238, 241: 241, 242: 242, 243: 243, 244: 244,
  245: 245, 246: 246, 247: 247, 248: 248, 249: 249, 250: 250, 251: 251, 252: 252,
  253: 253, 254: 254, 255: 255, 256: 256, 257: 257, 258: 258, 259: 259, 260: 260,
  261: 261, 262: 262, 263: 263, 264: 264, 265: 265, 266: 266, 267: 267, 268: 268,
  269: 269, 270: 270, 271: 271, 272: 272, 273: 273, 274: 274, 275: 275, 276: 276,
  277: 277, 278: 278, 279: 279, 280: 280, 281: 281, 282: 282, 283: 283, 285: 285,
  286: 286, 287: 287, 288: 288, 289: 289, 290: 290, 291: 291, 292: 292, 293: 293,
  294: 294, 295: 295, 296: 296, 297: 297, 298: 298, 300: 300, 301: 301, 302: 302,
  303: 303, 304: 304, 305: 305, 306: 306, 307: 307, 308: 308, 309: 309, 310: 310,
  311: 311, 312: 312, 313: 313, 314: 314, 315: 315, 316: 316, 317: 317, 318: 318,
  319: 319, 320: 320, 321: 321, 322: 322, 323: 323, 324: 324, 325: 325, 326: 326,
  327: 327, 328: 328, 329: 329, 330: 330, 331: 331, 332: 332, 333: 333, 334: 334,
  335: 335, 336: 336, 337: 337, 338: 338, 339: 339, 340: 340, 341: 341, 342: 342,
  343: 343, 344: 344, 345: 345, 346: 346, 347: 347, 348: 348, 349: 349, 350: 350,
  351: 351, 352: 352, 353: 353, 354: 354, 355: 355, 356: 356, 357: 357, 358: 358,
  359: 359, 360: 360, 361: 361, 362: 362, 363: 363, 364: 364, 365: 365, 366: 366,
  367: 367, 368: 368, 369: 369, 370: 370, 371: 371, 372: 372, 373: 373, 375: 375,
  376: 376, 377: 377, 378: 378, 379: 379, 382: 382, 383: 383, 384: 384, 385: 385,
  386: 386, 387: 387, 388: 388, 389: 389, 390: 390, 391: 391, 392: 392, 393: 393,
  394: 394, 395: 395, 396: 396, 397: 397, 398: 398, 399: 399, 400: 400, 401: 401,
  403: 403, 404: 404, 405: 405, 406: 406, 407: 407, 408: 408, 409: 409, 410: 410,
  411: 411, 412: 412, 413: 413, 414: 414, 415: 415, 416: 416, 417: 417, 418: 418,
  419: 419, 420: 420, 421: 421, 422: 422, 423: 423, 424: 424, 425: 425, 426: 426,
  427: 427, 428: 428, 429: 429, 430: 430, 431: 350, 433: 433, 499: 499, 500: 500,
  550: 550, 551: 551, 552: 552, 553: 553, 554: 554, 555: 555, 556: 556, 557: 557,
  558: 558, 559: 559, 561: 561, 562: 562, 563: 563, 564: 564, 565: 565, 566: 566,
  567: 567, 568: 568, 569: 569, 570: 570, 571: 571, 572: 572, 573: 573, 574: 574,
  575: 575, 576: 576, 577: 577, 578: 578, 579: 579, 580: 580, 581: 581, 582: 582,
  583: 583, 584: 584, 585: 585, 586: 586, 587: 587, 588: 588, 590: 590, 591: 591,
  592: 592, 593: 593, 594: 594, 595: 595, 596: 596, 597: 597, 598: 598, 599: 599,
  600: 600, 601: 601, 602: 602, 603: 603, 604: 604, 605: 605, 606: 606, 607: 607,
  608: 608, 1250: 250, 1259: 209, 1305: 257, 1306: 220, 1354: 569, 1356: 577, 1437: 201,
  1559: 307, 1590: 259, 1591: 280, 1593: 296, 1595: 347, 1597: 370, 1600: 200, 1601: 247,
  1602: 297, 1603: 307, 1604: 295, 1605: 290, 1606: 350, 1607: 205, 1608: 207, 1609: 232,
  1610: 237, 1611: 241, 1612: 323, 1613: 361, 1712: 287, 1792: 295, 1830: 296, 1833: 368,
  1846: 219, 1847: 283, 1848: 252, 1849: 234, 1851: 264, 1852: 238, 1853: 266, 1855: 202,
  1857: 201, 1858: 209, 1859: 248, 1860: 223, 1861: 208, 1862: 259, 1863: 254, 1864: 249,
  1895: 264, 1933: 596, 2012: 277, 2211: 211, 2386: 228, 2427: 210, 2433: 211, 2890: 433,
  3020: 302, 10206: 206, 10211: 211, 10215: 215, 10218: 218, 10219: 219, 10221: 221, 10234: 234,
  10237: 237, 10238: 238, 10248: 248, 10261: 261, 10266: 266, 10279: 279, 10300: 300, 10329: 329,
  10499: 499, 21217: 217, 21322: 322, 21327: 327, 21346: 346, 23302: 233, 59200: 200, 59230: 230,
  59241: 241, 59306: 306, 59323: 323, 60345: 345, 73586: 288, 73587: 231, 73588: 345, 73589: 223,
  73590: 211, 73592: 251, 73593: 266, 73594: 321, 73595: 216, 73596: 253, 73597: 269, 73598: 227,
  73599: 222,
};

/** 同名但属性系数不同（SP / 皮肤 / 其他形态）；仅在 strict 未命中时回退 */
export const heroBaseAliasLoose: Readonly<Record<number, number>> = {
  76: 325, 77: 316, 78: 325, 80: 325, 116: 332, 117: 333, 118: 335, 501: 379,
  514: 414, 515: 415, 516: 416, 517: 417, 518: 418, 519: 419, 520: 420, 521: 421,
  522: 422, 523: 423, 524: 424, 525: 425, 526: 426, 527: 427, 901: 316, 1003: 585,
  1101: 282, 1112: 282, 1213: 300, 1214: 339, 1216: 262, 1217: 238, 1218: 205, 1220: 237,
  1221: 412, 1233: 342, 1234: 265, 1235: 219, 1236: 312, 1237: 341, 1241: 312, 1242: 343,
  1256: 312, 1258: 345, 1260: 330, 1261: 347, 1262: 339, 1263: 339, 1264: 347, 1265: 348,
  1266: 252, 1267: 348, 1268: 351, 1273: 352, 1274: 353, 1275: 256, 1276: 406, 1277: 237,
  1278: 215, 1279: 353, 1280: 354, 1281: 238, 1282: 237, 1283: 356, 1284: 351, 1286: 356,
  1287: 562, 1288: 565, 1289: 351, 1292: 410, 1293: 411, 1294: 412, 1295: 413, 1296: 499,
  1297: 566, 1298: 566, 1299: 556, 1300: 556, 1316: 316, 1331: 352, 1332: 327, 1350: 573,
  1351: 574, 1352: 572, 1353: 570, 1355: 575, 1357: 578, 1358: 579, 1359: 580, 1424: 351,
  1444: 351, 1450: 356, 1451: 351, 1454: 357, 1491: 334, 1501: 357, 1503: 358, 1504: 359,
  1530: 341, 1531: 322, 1561: 215, 1562: 237, 1580: 369, 1581: 370, 1592: 292, 1594: 316,
  1596: 353, 1598: 348, 1614: 353, 1615: 347, 1616: 335, 1617: 333, 1621: 280, 1629: 370,
  1630: 377, 1631: 367, 1632: 372, 1633: 366, 1634: 362, 1635: 369, 1636: 370, 1638: 358,
  1639: 237, 1640: 377, 1641: 377, 1642: 377, 1643: 377, 1644: 377, 1670: 385, 1710: 300,
  1713: 351, 1715: 390, 1716: 554, 1718: 391, 1719: 385, 1720: 330, 1721: 561, 1725: 399,
  1760: 386, 1770: 389, 1771: 389, 1772: 389, 1773: 389, 1774: 283, 1775: 304, 1776: 347,
  1777: 376, 1785: 389, 1788: 237, 1789: 377, 1790: 289, 1805: 392, 1811: 393, 1815: 394,
  1820: 217, 1822: 389, 1823: 205, 1824: 347, 1825: 252, 1826: 265, 1829: 259, 1831: 551,
  1832: 259, 1850: 217, 1854: 262, 1856: 265, 1865: 372, 1866: 396, 1881: 377, 1886: 410,
  1887: 499, 1888: 499, 1889: 410, 1890: 499, 1891: 556, 1892: 389, 1893: 390, 1894: 555,
  1910: 550, 1913: 389, 1915: 385, 1922: 585, 1925: 591, 1934: 597, 1935: 598, 1937: 603,
  1938: 604, 1939: 607, 1940: 608, 2000: 394, 2006: 579, 2007: 579, 2008: 330, 2009: 550,
  2010: 376, 2020: 410, 2021: 257, 2024: 596, 2101: 397, 2102: 347, 2103: 554, 2205: 205,
  2263: 226, 2306: 306, 2312: 556, 2313: 557, 2380: 372, 2387: 556, 2394: 556, 2395: 389,
  2396: 390, 2409: 566, 2420: 303, 2421: 551, 2422: 372, 2423: 565, 2424: 355, 2425: 562,
  2426: 568, 2434: 232, 2435: 250, 2436: 569, 2437: 353, 2438: 570, 2439: 572, 2440: 221,
  2441: 573, 2442: 574, 2443: 384, 2447: 575, 2448: 577, 2449: 312, 2450: 341, 2451: 322,
  2452: 578, 2453: 353, 2454: 579, 2455: 391, 2456: 580, 2457: 364, 2458: 559, 2462: 206,
  2463: 209, 2466: 581, 2468: 338, 2469: 583, 2470: 583, 2471: 338, 2472: 583, 2501: 591,
  2503: 312, 2504: 269, 2505: 591, 2506: 603, 2507: 603, 2582: 582, 2583: 583, 2585: 591,
  2586: 563, 2831: 247, 2851: 285, 2853: 556, 2854: 389, 2856: 554, 2857: 260, 2858: 395,
  2888: 341, 2889: 551, 2901: 606, 2902: 605, 3024: 570, 3025: 570, 3321: 321, 4581: 581,
  6456: 277, 10201: 201, 10205: 205, 10217: 217, 10224: 224, 10227: 227, 10252: 252, 10260: 260,
  10262: 262, 10265: 265, 10269: 269, 10272: 272, 10280: 280, 10311: 311, 10347: 347, 10594: 594,
  10604: 604, 10608: 608, 10901: 316, 10908: 394, 11585: 585, 11586: 586, 11594: 594, 12016: 592,
  12293: 293, 12573: 573, 12586: 586, 20219: 219, 20300: 300, 20556: 556, 21362: 362, 22110: 211,
  22111: 211, 22585: 231, 25831: 583, 30608: 608, 52599: 599, 52600: 600, 54561: 561, 58412: 205,
  58434: 583, 58512: 205, 59225: 225, 59286: 286, 59295: 295, 59301: 593, 59332: 332, 59335: 335,
  59501: 595, 59556: 556, 59573: 573, 59583: 583, 60201: 201, 60205: 205, 60206: 206, 60220: 220,
  60227: 227, 60234: 234, 60238: 238, 60255: 255, 60266: 266, 60268: 268, 60269: 269, 60280: 280,
  60283: 283, 60295: 295, 60324: 324, 60330: 330, 60347: 347, 60363: 363, 60389: 389, 60556: 556,
  61316: 591, 61320: 602, 61577: 577, 62578: 597, 63578: 597, 71575: 575, 72575: 575, 73575: 575,
  73580: 585, 73591: 585, 87260: 260,
};

/** 解析任意 heroId（含 SP / 皮肤 / 变体 id）到六星 40 级基础面板。 */
export function heroBaseOf(heroId: number): HeroBaseEntry | undefined {
  return heroBaseById[heroId]
    ?? heroBaseById[heroBaseAliasStrict[heroId]]
    ?? heroBaseById[heroBaseAliasLoose[heroId]];
}

/** 该 heroId 是否可作为战斗式神（排除 NPC / 素材）。 */
export function isPlayableHero(heroId: number): boolean {
  const entry = heroBaseOf(heroId);
  return Boolean(entry) && entry!.kind !== 'npc' && !NPC_ID_SET.has(heroId);
}
