/**
 * data.js - 游戏数据定义层
 * 包含所有常量、枚举、药剂数据和手术用具数据
 * 此文件无DOM依赖，可直接用于Node.js环境进行RL训练
 */

// =====================================================================
// ===== 种群枚举 (Species Enum) =====
// =====================================================================
const SPECIES = {
  YIMO: 'yimo',             // 异魔
  GUCHONG: 'guchong',       // 蛊虫
  JUEXINGZHE: 'juexingzhe', // 觉醒者
  GUWEBING: 'guwebing'      // 骨卫兵
};

/** 种群显示名称映射 */
const SPECIES_NAMES = {
  [SPECIES.YIMO]: '异魔',
  [SPECIES.GUCHONG]: '蛊虫',
  [SPECIES.JUEXINGZHE]: '觉醒者',
  [SPECIES.GUWEBING]: '骨卫兵'
};

/** 种群列表（用于随机选取） */
const SPECIES_LIST = [SPECIES.YIMO, SPECIES.GUCHONG, SPECIES.JUEXINGZHE, SPECIES.GUWEBING];

// =====================================================================
// ===== 稀有度枚举 (Rarity Enum) =====
// =====================================================================
const RARITY = {
  COMMON: 'common', // 普通
  MAGIC: 'magic',   // 魔法
  RARE: 'rare',     // 稀有
  BOSS: 'boss'      // 首领
};

/** 稀有度显示名称映射 */
const RARITY_NAMES = {
  [RARITY.COMMON]: '普通',
  [RARITY.MAGIC]: '魔法',
  [RARITY.RARE]: '稀有',
  [RARITY.BOSS]: '首领'
};

/** 稀有度层级顺序（低→高），用于觉醒和升阶判断 */
const RARITY_ORDER = [RARITY.COMMON, RARITY.MAGIC, RARITY.RARE, RARITY.BOSS];

/** 各稀有度怪物的初始属性值 */
const RARITY_STATS = {
  [RARITY.COMMON]: { activity: 1, quantity: 36 },
  [RARITY.MAGIC]:  { activity: 5, quantity: 24 },
  [RARITY.RARE]:   { activity: 15, quantity: 12 },
  [RARITY.BOSS]:   { activity: 300, quantity: 1 }
};

/** 各稀有度出现的权重（百分比形式） */
const RARITY_WEIGHTS = {
  [RARITY.COMMON]: 30,
  [RARITY.MAGIC]:  40,
  [RARITY.RARE]:   20,
  [RARITY.BOSS]:   10
};

/** 觉醒时的活性加成值（按觉醒后的稀有度） */
const AWAKEN_BONUS = {
  [RARITY.MAGIC]: 60,
  [RARITY.RARE]:  120,
  [RARITY.BOSS]:  120
};

// =====================================================================
// ===== 游戏常量 (Game Constants) =====
// =====================================================================

/** 培养皿数量 */
const DISH_COUNT = 6;
/** 总回合数（含3个无药剂的额外回合） */
const TOTAL_ROUNDS = 13;
/** 有药剂选择的回合数（前10回合有药剂，后3回合仅结算手术用具） */
const POTION_ROUNDS = 10;
/** 每回合抽取药剂数 */
const POTIONS_PER_DRAW = 3;
/** 每次手术用具选择时抽取数 */
const TOOLS_PER_DRAW = 3;
/** 初始怪物数量范围 [min, max] */
const INITIAL_MONSTER_RANGE = [3, 4];
/** 总活性阈值：触发第二次手术用具选择 */
const TOOL_THRESHOLD_1 = 8000;
/** 总活性阈值：触发第三次手术用具选择 */
const TOOL_THRESHOLD_2 = 28000;

// =====================================================================
// ===== 游戏阶段枚举 (Phase Enum) =====
// =====================================================================
const PHASE = {
  INIT: 'init',                     // 初始化阶段
  TOOL_SELECT: 'tool_select',       // 选择手术用具
  POTION_SELECT: 'potion_select',   // 选择药剂
  TARGET_SELECT: 'target_select',   // 选择目标培养皿
  ROUND_END: 'round_end',           // 回合结算中
  GAME_OVER: 'game_over'            // 游戏结束
};

// =====================================================================
// ===== 事件类型枚举 (Event Type Enum) =====
// =====================================================================
const EVENT_TYPE = {
  ADD: 'add',                // 添加怪物
  REMOVE: 'remove',          // 移除怪物
  MUTATE: 'mutate',          // 变异
  AWAKEN: 'awaken',          // 觉醒
  FUSE: 'fuse',              // 融合
  DEVOUR: 'devour',          // 吞噬
  ADD_OVERFLOW: 'add_overflow' // 添加溢出（培养皿已满）
};

// =====================================================================
// ===== RL动作空间枚举 (RL Action Space) =====
// =====================================================================
const ACTION = {
  SELECT_0: 0,   // 选择第1个选项（卡牌/工具）
  SELECT_1: 1,   // 选择第2个选项
  SELECT_2: 2,   // 选择第3个选项
  SELECT_3: 3,   // 选择第4个选项（药剂箱展开时）
  SELECT_4: 4,   // 选择第5个选项（药剂箱展开时）
  TARGET_0: 5,   // 选择1号培养皿作为目标
  TARGET_1: 6,   // 选择2号培养皿
  TARGET_2: 7,   // 选择3号培养皿
  TARGET_3: 8,   // 选择4号培养皿
  TARGET_4: 9,   // 选择5号培养皿
  TARGET_5: 10,  // 选择6号培养皿
  REFRESH: 11,   // 刷新当前选项
  CONFIRM: 12    // 确认目标选择
};

/** 动作空间总大小（供RL框架使用） */
const ACTION_COUNT = 13;

// =====================================================================
// ===== 药剂数据定义 (Potion Definitions) =====
// 共36种药剂，每种包含元数据和目标选择信息
// targetType: 'none'=自动/随机, 'select_1'=选1个, 'select_1_or_2'=选1-2个, 'box'=药剂箱
// =====================================================================
const POTIONS = [
  // ---------- 稀有药剂 (Rare Potions) ----------
  {
    id: 0, name: '益生霉溶液', potionRarity: 'rare',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '每拥有1组蛊虫，使所有蛊虫+11活性'
  },
  {
    id: 1, name: '蜕生皮溶液', potionRarity: 'rare',
    targetType: 'select_1_or_2', minTargets: 1, maxTargets: 2,
    description: '选择1-2组怪物融合为1组蛊虫'
  },
  {
    id: 2, name: '软脑膜溶液', potionRarity: 'rare',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物+30活性，魔法觉醒者生效2次，稀有和首领觉醒者生效3次'
  },
  {
    id: 3, name: '化骨油膏', potionRarity: 'rare',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '至少拥有1组骨卫兵时，随机移除至多3组非骨卫兵怪物，每移除1组，使所有怪物+28活性+28数量'
  },
  {
    id: 4, name: '清疽油膏', potionRarity: 'rare',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物+20活性；骨卫兵额外+41数量并移除右侧怪物'
  },
  {
    id: 5, name: '鲜脊髓药粉', potionRarity: 'rare',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '随机至多3组非异魔怪物变异为异魔，每变异1组，使随机3组异魔+42数量'
  },
  {
    id: 6, name: '石化脊髓溶液', potionRarity: 'rare',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物+20活性，如果不是异魔则变异为异魔，并使其额外+30活性'
  },

  // ---------- 魔法药剂 (Magic Potions) ----------
  {
    id: 7, name: '活性育卵激素', potionRarity: 'magic',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '添加1组蛊虫，50%概率额外添加2组'
  },
  {
    id: 8, name: '卵壳药粉', potionRarity: 'magic',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '随机1组怪物+25数量，如果是蛊虫，添加1组同名蛊虫并使其+25数量'
  },
  {
    id: 9, name: '脑雾酊剂', potionRarity: 'magic',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '随机1组怪物+41活性，如果是觉醒者，觉醒为稀有怪物'
  },
  {
    id: 10, name: '生骨药粉', potionRarity: 'magic',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '随机1组怪物+40数量，如果是骨卫兵，额外+127数量并移除1组非骨卫兵怪物'
  },
  {
    id: 11, name: '灰质脊髓溶液', potionRarity: 'magic',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '随机1组怪物+41活性，变异为随机怪物；有50%概率将其再次变异为异魔并+30活性'
  },
  {
    id: 12, name: '空心脊髓溶液', potionRarity: 'magic',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物+41活性，50%概率使其变异为随机异魔'
  },
  {
    id: 13, name: '青胆汁溶液', potionRarity: 'magic',
    targetType: 'select_1_or_2', minTargets: 1, maxTargets: 2,
    description: '选择1-2组怪物，将其变异为随机魔法怪物，并+31活性'
  },
  {
    id: 14, name: '混合活蛭溶液', potionRarity: 'magic',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物，使2组同稀有度怪物+31活性'
  },
  {
    id: 15, name: '消化酶溶液', potionRarity: 'magic',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物+61活性，移除其左侧怪物'
  },
  {
    id: 16, name: '活殖药粉', potionRarity: 'magic',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '随机4组稀有度各不相同的怪物+32数量'
  },
  {
    id: 17, name: '强效祛异药粉', potionRarity: 'magic',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物+154数量，移除2组与其不同种群的怪物'
  },
  {
    id: 18, name: '祛异药粉', potionRarity: 'magic',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物+127数量，移除1组与其不同种群的怪物'
  },
  {
    id: 19, name: '纯粹活蛭溶液', potionRarity: 'magic',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物，使2组同种群怪物+31活性'
  },
  {
    id: 20, name: '迷魂酊剂', potionRarity: 'magic',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物，觉醒为高1阶稀有度的怪物'
  },
  {
    id: 21, name: '诱变药粉', potionRarity: 'magic',
    targetType: 'select_1_or_2', minTargets: 1, maxTargets: 2,
    description: '选择1-2组怪物+52数量，并使其变异为随机稀有怪物'
  },
  {
    id: 22, name: '黏稠胆汁溶液', potionRarity: 'magic',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物，将其右侧怪物变异为与其相同的怪物，两者各+31活性'
  },

  // ---------- 普通药剂 (Common Potions) ----------
  {
    id: 23, name: '细肢药粉-蛊虫', potionRarity: 'common',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '添加1组蛊虫，使其+73数量'
  },
  {
    id: 24, name: '孪生激素-蛊虫', potionRarity: 'common',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物，变异为蛊虫，并添加1组同名怪物'
  },
  {
    id: 25, name: '脊髓溶液-觉醒者', potionRarity: 'common',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '添加1组觉醒者，使其+31活性'
  },
  {
    id: 26, name: '麻药酊剂-觉醒者', potionRarity: 'common',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物，变异为觉醒者，觉醒为魔法怪物'
  },
  {
    id: 27, name: '细肢药粉-骨卫兵', potionRarity: 'common',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '添加1组骨卫兵，使其+73数量'
  },
  {
    id: 28, name: '孪生激素-骨卫兵', potionRarity: 'common',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物，变异为骨卫兵，使其+62数量'
  },
  {
    id: 29, name: '麻药酊剂-异魔', potionRarity: 'common',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物，变异为异魔，50%概率再将随机1组怪物变异为异魔'
  },
  {
    id: 30, name: '脊髓溶液-异魔', potionRarity: 'common',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '添加1组异魔，使其+31活性'
  },
  {
    id: 31, name: '异种激素', potionRarity: 'common',
    targetType: 'select_1_or_2', minTargets: 1, maxTargets: 2,
    description: '选择1-2组怪物移除，添加4组随机怪物，使其+5活性'
  },
  {
    id: 32, name: '靶向异种激素', potionRarity: 'common',
    targetType: 'select_1', minTargets: 1, maxTargets: 1,
    description: '选择1组怪物移除，添加2组随机种群的魔法怪物，使其+25数量'
  },

  // ---------- 药剂箱 (Potion Boxes) ----------
  {
    id: 33, name: '药剂箱（大）', potionRarity: 'rare',
    targetType: 'box', minTargets: 0, maxTargets: 0,
    isBox: true, boxSize: 5,
    description: '包含5支随机药剂（不含药剂箱）'
  },
  {
    id: 34, name: '稀有药剂箱', potionRarity: 'rare',
    targetType: 'box', minTargets: 0, maxTargets: 0,
    isBox: true, boxSize: 3,
    description: '包含3支随机药剂（不含药剂箱）'
  },

  // ---------- 至臻药剂 (Supreme Potions) ----------
  {
    id: 35, name: '复方焕生丸剂', potionRarity: 'supreme',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '将所有怪物变异为随机异魔并+11活性，魔法异魔额外+11活性，稀有和首领异魔额外+11数量'
  },
  {
    id: 36, name: '速效强心剂', potionRarity: 'supreme',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '选择总活性最低的1组怪物，使其活性+42，数量+42'
  },
  {
    id: 37, name: '疫区泥炭敷料', potionRarity: 'supreme',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '至少拥有1组骨卫兵时，移除所有非骨卫兵怪物，每移除1组，使所有骨卫兵+20活性+39数量'
  },
  {
    id: 38, name: '诱虫剂', potionRarity: 'supreme',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '添加4组蛊虫；每超出1组，使已有蛊虫活性+10，数量+15'
  },
  {
    id: 39, name: '至纯圣水', potionRarity: 'supreme',
    targetType: 'none', minTargets: 0, maxTargets: 0,
    description: '所有觉醒者觉醒为高2阶稀有度的怪物，如果稀有度为首领则变异为随机首领觉醒者'
  }
];

/** 非药剂箱的药剂列表（用于药剂箱内再次抽取） */
const POTIONS_NO_BOX = POTIONS.filter(p => !p.isBox);

/** 普通药剂池（非至臻、非药剂箱） */
const POTIONS_NORMAL = POTIONS.filter(p => !p.isBox && p.potionRarity !== 'supreme');

/** 至臻药剂池 */
const POTIONS_SUPREME = POTIONS.filter(p => p.potionRarity === 'supreme');

/** 至臻药剂抽取概率（每张卡特1%概率抽到至臻） */
const SUPREME_CHANCE = 0.01;

// =====================================================================
// ===== 手术用具数据定义 (Surgical Tool Definitions) =====
// 共24种，分为基础池(1-8)和高级池(9-24)
// pool: 'basic'=第1回合可选, 'advanced'=总活性超过阈值后可选
// =====================================================================
const TOOLS = [
  {
    id: 1, name: '人蛹标本', pool: 'basic',
    description: '回合结束时，根据当前拥有的蛊虫组数X，随机X组怪物+8数量，重复生效X次'
  },
  {
    id: 2, name: '孵化囊', pool: 'basic',
    description: '拥有至少2组蛊虫时，每次添加怪物时，使所有怪物+45数量'
  },
  {
    id: 3, name: '增生前额叶', pool: 'basic',
    description: '拥有至少2组觉醒者时，每回合使随机1组稀有或首领怪物+80活性'
  },
  {
    id: 4, name: '肿大脑垂体', pool: 'basic',
    description: '拥有稀有或首领觉醒者时，每回合使随机1组怪物+80活性'
  },
  {
    id: 5, name: '粘连跖骨', pool: 'basic',
    description: '拥有至少2组骨卫兵时，每次移除怪物，使随机一组怪物+180数量'
  },
  {
    id: 6, name: '挛缩指爪', pool: 'basic',
    description: '移除非骨卫兵的怪物时，随机1组怪物+150数量'
  },
  {
    id: 7, name: '孽生肉芽', pool: 'basic',
    description: '怪物变异为异魔时，所有怪物+35活性'
  },
  {
    id: 8, name: '斑斓肝脏', pool: 'basic',
    description: '拥有至少2组异魔时，每次变异怪物，使所有怪物+20活性'
  },
  {
    id: 9, name: '簇生虫卵', pool: 'advanced',
    description: '拥有至少3组蛊虫时，每回合添加1组蛊虫，并使其+100数量'
  },
  {
    id: 10, name: '蜕生脑皮层', pool: 'advanced',
    description: '回合结束时，随机2组魔法怪物融合为稀有觉醒者'
  },
  {
    id: 11, name: '兽筋绞肉索', pool: 'advanced',
    description: '回合结束时，如果拥有至少2组骨卫兵，移除总活性最低的非骨卫兵怪物，随机1组骨卫兵获得其活性和数量'
  },
  {
    id: 12, name: '蠕动脊髓', pool: 'advanced',
    description: '每次添加怪物时，75%概率变异为异魔，并使其+80活性'
  },
  {
    id: 13, name: '生皮革拘束带', pool: 'advanced',
    description: '拥有3组魔法怪物时，每回合使总活性最高的1组怪物+100数量'
  },
  {
    id: 14, name: '黑山羊肠缝线', pool: 'advanced',
    description: '回合结束时，每拥有3组相同稀有度的怪物，将其融合为1组更高稀有度的怪物'
  },
  {
    id: 15, name: '生铁骨锯', pool: 'advanced',
    description: '回合结束时，数量和活性都大于150的怪物，使其+15活性和+15数量'
  },
  {
    id: 16, name: '二寸颅骨钉', pool: 'advanced',
    description: '添加怪物时，若超过培养皿数量上限，使总活性最低的1组怪物+25活性+25数量'
  },
  {
    id: 17, name: '脏污刮骨刀', pool: 'advanced',
    description: '回合结束时，所有数量大于275的怪物+20活性'
  },
  {
    id: 18, name: '犬牙锉刀', pool: 'advanced',
    description: '回合结束时，所有活性大于255的怪物+30数量'
  },
  {
    id: 19, name: '疫区圣母像', pool: 'advanced',
    description: '每2回合，每个稀有度内随机1组怪物觉醒为更高一阶稀有度的怪物'
  },
  {
    id: 20, name: '异形蛰针', pool: 'advanced',
    description: '每3回合，所有怪物变异为随机怪物'
  },
  {
    id: 21, name: '鞣制皮革拘束带', pool: 'advanced',
    description: '同时拥有普通、魔法及首领怪物时，每回合使所有怪物+20活性'
  },
  {
    id: 22, name: '眼睑扩张器', pool: 'advanced',
    description: '移除怪物时，使总活性最高的1组怪物+20活性+20数量'
  },
  {
    id: 23, name: '二度降生者之喙', pool: 'advanced',
    description: '回合结束时，如果有2组怪物，添加1组怪物；如果有6组怪物，总活性最高的怪物吞噬总活性最低的怪物'
  },
  {
    id: 24, name: '荨麻绳扣', pool: 'advanced',
    description: '拥有3组普通怪物时，每回合使所有怪物+30数量'
  }
];

/** 按池子分类的手术用具 */
const TOOLS_BASIC = TOOLS.filter(t => t.pool === 'basic');       // 基础池 1-8
const TOOLS_ADVANCED = TOOLS.filter(t => t.pool === 'advanced'); // 高级池 9-24

// =====================================================================
// ===== 工具函数 (Utility Functions) =====
// =====================================================================

/**
 * 按权重随机选择稀有度
 * @returns {string} 稀有度枚举值
 */
function randomRarity() {
  const rand = Math.random() * 100;
  let cumulative = 0;
  for (const rarity of RARITY_ORDER) {
    cumulative += RARITY_WEIGHTS[rarity];
    if (rand < cumulative) return rarity;
  }
  return RARITY.COMMON; // 兜底
}

/**
 * 随机选择种群
 * @returns {string} 种群枚举值
 */
function randomSpecies() {
  return SPECIES_LIST[Math.floor(Math.random() * SPECIES_LIST.length)];
}

/**
 * 获取下一级稀有度（用于觉醒）
 * @param {string} currentRarity 当前稀有度
 * @returns {string|null} 更高一级稀有度，如果已是最高则返回null
 */
function getNextRarity(currentRarity) {
  const idx = RARITY_ORDER.indexOf(currentRarity);
  if (idx < 0 || idx >= RARITY_ORDER.length - 1) return null;
  return RARITY_ORDER[idx + 1];
}

/**
 * 获取怪物显示名称（稀有度+种群）
 * @param {string} species 种群
 * @param {string} rarity 稀有度
 * @returns {string} 显示名称，如"首领异魔"
 */
function getDisplayName(species, rarity) {
  return RARITY_NAMES[rarity] + SPECIES_NAMES[species];
}

/**
 * 从数组中随机选取n个不重复元素
 * @param {Array} arr 源数组
 * @param {number} n 选取数量
 * @returns {Array} 选取结果
 */
function randomSample(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

/**
 * 从数组中随机选取1个元素
 * @param {Array} arr 源数组
 * @returns {*} 随机元素
 */
function randomChoice(arr) {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 创建一个新的怪物对象
 * @param {string} species 种群
 * @param {string} rarity 稀有度
 * @param {number} activityBonus 额外活性加成
 * @param {number} quantityBonus 额外数量加成
 * @returns {Object} 怪物对象 {species, rarity, activity, quantity}
 */
function createMonster(species, rarity, activityBonus = 0, quantityBonus = 0) {
  const baseStats = RARITY_STATS[rarity];
  return {
    species: species,
    rarity: rarity,
    activity: baseStats.activity + activityBonus,
    quantity: baseStats.quantity + quantityBonus
  };
}

/**
 * 计算单个培养皿的总活性（活性 × 数量）
 * @param {Object|null} monster 怪物对象
 * @returns {number} 总活性值
 */
function getDishTotal(monster) {
  if (!monster) return 0;
  return monster.activity * monster.quantity;
}
