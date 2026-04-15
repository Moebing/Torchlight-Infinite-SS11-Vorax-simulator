/**
 * engine.js - 游戏逻辑引擎（纯逻辑，无DOM依赖）
 * 
 * 核心RL接口:
 *   reset()           -> 初始化游戏，返回初始状态
 *   step(action)      -> 执行动作，返回 {state, reward, done, info}
 *   getState()        -> 获取当前完整状态（Observation）
 *   getValidActions() -> 获取当前合法动作掩码（Action Mask）
 *
 * 供SB3 PPO训练使用，可直接封装为Gymnasium环境
 */

class GameEngine {
  /**
   * 构造函数
   * @param {Object} config 配置参数
   * @param {number} config.toolRefreshes 手术用具刷新次数 (0-2)
   * @param {number} config.potionRefreshes 药剂刷新次数 (默认3)
   * @param {number} config.seed 随机种子（暂未实现，预留接口）
   */
  constructor(config = {}) {
    // ===== 可配置参数（预留RL接口） =====
    this.config = {
      toolRefreshes: config.toolRefreshes ?? 0,    // 手术用具刷新次数
      potionRefreshes: config.potionRefreshes ?? 3, // 药剂刷新次数
      seed: config.seed ?? null                     // 随机种子（预留）
    };

    // ===== 游戏状态 =====
    this.dishes = new Array(DISH_COUNT).fill(null);  // 6个培养皿
    this.equippedTools = [];                          // 已装备的手术用具ID列表
    this.currentRound = 0;                            // 当前回合数
    this.phase = PHASE.INIT;                          // 当前游戏阶段
    this.totalRounds = TOTAL_ROUNDS;                  // 总回合数

    // ===== 选择相关状态 =====
    this.currentCards = [];       // 当前可选的卡牌（药剂或工具）
    this.selectedTargets = [];    // 已选择的目标培养皿索引
    this.pendingPotion = null;    // 待执行的药剂（需要选目标时暂存）
    this.isBoxOpen = false;       // 是否正在处理药剂箱

    // ===== 刷新次数 =====
    this.toolRefreshesLeft = this.config.toolRefreshes;
    this.potionRefreshesLeft = this.config.potionRefreshes;

    // ===== 阈值触发状态 =====
    this.hasTriggered8000 = false;   // 8000分阈值是否已触发
    this.hasTriggered28000 = false;  // 28000分阈值是否已触发

    // ===== 回合事件日志（供手术用具结算使用） =====
    this.roundEvents = [];  // [{type, data}]

    // ===== 待处理的手术用具选择队列 =====
    this.pendingToolSelections = [];  // ['basic'] 或 ['advanced']

    // ===== 手术用具获取回合记录（用于周期性触发计算） =====
    this.toolAcquiredRound = {};  // {toolId: roundAcquired}

    // ===== 上回合开始时的培养皿快照（用于显示变化量） =====
    this.previousDishStats = [];  // [{activity, quantity} | null]

    // ===== 回调函数接口（供UI层监听） =====
    this.onStateChange = null;  // 状态变更回调
    this.onLog = null;          // 日志输出回调
  }

  // =====================================================================
  // ===== 游戏初始化 =====
  // =====================================================================

  /**
   * 重置游戏到初始状态
   * @returns {Object} 初始状态（Observation）
   */
  reset() {
    // 清空培养皿
    this.dishes = new Array(DISH_COUNT).fill(null);
    this.equippedTools = [];
    this.currentRound = 1;
    this.currentCards = [];
    this.selectedTargets = [];
    this.pendingPotion = null;
    this.isBoxOpen = false;
    this.toolRefreshesLeft = this.config.toolRefreshes;
    this.potionRefreshesLeft = this.config.potionRefreshes;
    this.hasTriggered8000 = false;
    this.hasTriggered28000 = false;
    this.roundEvents = [];
    this.pendingToolSelections = [];
    this.toolAcquiredRound = {};
    this.previousDishStats = new Array(DISH_COUNT).fill(null);

    // 初始化3-4组随机怪物到最左边的空培养皿
    const initialCount = INITIAL_MONSTER_RANGE[0] +
      Math.floor(Math.random() * (INITIAL_MONSTER_RANGE[1] - INITIAL_MONSTER_RANGE[0] + 1));
    for (let i = 0; i < initialCount; i++) {
      const species = randomSpecies();
      const rarity = randomRarity();
      this.dishes[i] = createMonster(species, rarity);
    }

    this._log(`游戏初始化：添加了${initialCount}组初始怪物`);

    // 第1回合开始，先进行手术用具选择（从基础池1-8抽取）
    this.pendingToolSelections = ['basic'];
    this._startToolSelection();

    return this.getState();
  }

  // =====================================================================
  // ===== RL核心接口: step =====
  // =====================================================================

  /**
   * 执行一个动作
   * @param {number} actionId 动作ID（参见ACTION枚举）
   * @returns {Object} {state, reward, done, info}
   */
  step(actionId) {
    const validActions = this.getValidActions();
    if (!validActions[actionId]) {
      this._log(`无效动作: ${actionId}`);
      return {
        state: this.getState(),
        reward: 0,
        done: this.phase === PHASE.GAME_OVER,
        info: { error: 'invalid_action' }
      };
    }

    let info = {};

    switch (this.phase) {
      case PHASE.TOOL_SELECT:
        info = this._handleToolSelectAction(actionId);
        break;
      case PHASE.POTION_SELECT:
        info = this._handlePotionSelectAction(actionId);
        break;
      case PHASE.TARGET_SELECT:
        info = this._handleTargetSelectAction(actionId);
        break;
      default:
        info = { error: 'invalid_phase' };
    }

    const state = this.getState();
    const reward = this.getTotalActivity();
    const done = this.phase === PHASE.GAME_OVER;

    // 通知UI层
    if (this.onStateChange) this.onStateChange(state);

    return { state, reward, done, info };
  }

  // =====================================================================
  // ===== RL核心接口: getState =====
  // =====================================================================

  /**
   * 获取当前完整游戏状态（Observation）
   * 返回一个纯数据对象，易于序列化和传递给RL agent
   * @returns {Object} 当前状态
   */
  getState() {
    return {
      // 培养皿状态（6个）
      dishes: this.dishes.map((m, i) => ({
        index: i,
        monster: m ? {
          species: m.species,
          rarity: m.rarity,
          activity: m.activity,
          quantity: m.quantity,
          totalActivity: getDishTotal(m),
          displayName: getDisplayName(m.species, m.rarity)
        } : null
      })),
      // 已装备的手术用具
      equippedTools: this.equippedTools.map(id => {
        const tool = TOOLS.find(t => t.id === id);
        return { id, name: tool ? tool.name : 'unknown', description: tool ? tool.description : '' };
      }),
      // 当前可选卡牌
      currentCards: this.currentCards.map(c => ({ ...c })),
      // 游戏进度
      currentRound: this.currentRound,
      totalRounds: this.totalRounds,
      phase: this.phase,
      // 刷新次数
      toolRefreshesLeft: this.toolRefreshesLeft,
      potionRefreshesLeft: this.potionRefreshesLeft,
      // 阈值状态
      hasTriggered8000: this.hasTriggered8000,
      hasTriggered28000: this.hasTriggered28000,
      // 总活性
      totalActivity: this.getTotalActivity(),
      // 目标选择状态
      selectedTargets: [...this.selectedTargets],
      pendingPotion: this.pendingPotion ? { ...this.pendingPotion } : null,
      isBoxOpen: this.isBoxOpen,
      // 回合事件日志
      roundEvents: [...this.roundEvents],
      // 上回合状态快照（用于显示变化量）
      previousDishStats: this.previousDishStats.map(s => s ? { ...s } : null)
    };
  }

  // =====================================================================
  // ===== RL核心接口: getValidActions (Action Mask) =====
  // =====================================================================

  /**
   * 获取当前合法动作的掩码数组
   * @returns {boolean[]} 长度为ACTION_COUNT的布尔数组，true=该动作合法
   */
  getValidActions() {
    const mask = new Array(ACTION_COUNT).fill(false);

    switch (this.phase) {
      case PHASE.TOOL_SELECT:
        // 可以选择当前展示的工具（0-2）
        for (let i = 0; i < this.currentCards.length; i++) {
          mask[ACTION.SELECT_0 + i] = true;
        }
        // 如果还有手术用具刷新次数，可以刷新
        if (this.toolRefreshesLeft > 0) {
          mask[ACTION.REFRESH] = true;
        }
        break;

      case PHASE.POTION_SELECT:
        // 可以选择当前展示的药剂
        for (let i = 0; i < this.currentCards.length; i++) {
          mask[ACTION.SELECT_0 + i] = true;
        }
        // 如果还有药剂刷新次数，可以刷新
        if (this.potionRefreshesLeft > 0) {
          mask[ACTION.REFRESH] = true;
        }
        break;

      case PHASE.TARGET_SELECT:
        // 可以选择非空且未被选中的培养皿
        for (let i = 0; i < DISH_COUNT; i++) {
          if (this.dishes[i] && !this.selectedTargets.includes(i)) {
            mask[ACTION.TARGET_0 + i] = true;
          }
        }
        // 如果已选择了足够的最小目标数，可以确认
        if (this.pendingPotion && this.selectedTargets.length >= this.pendingPotion.minTargets) {
          mask[ACTION.CONFIRM] = true;
        }
        break;

      case PHASE.GAME_OVER:
        // 游戏结束，无合法动作
        break;
    }

    return mask;
  }

  // =====================================================================
  // ===== 总活性计算 =====
  // =====================================================================

  /**
   * 计算所有培养皿的总活性之和
   * @returns {number} 总活性值（所有培养皿的 活性×数量 之和）
   */
  getTotalActivity() {
    return this.dishes.reduce((sum, m) => sum + getDishTotal(m), 0);
  }

  // =====================================================================
  // ===== 内部动作处理 =====
  // =====================================================================

  /**
   * 处理手术用具选择阶段的动作
   */
  _handleToolSelectAction(actionId) {
    if (actionId === ACTION.REFRESH) {
      // 刷新手术用具
      this.toolRefreshesLeft--;
      const pool = this.pendingToolSelections[0];
      this._drawTools(pool);
      this._log(`刷新手术用具（剩余${this.toolRefreshesLeft}次）`);
      return { action: 'refresh_tools' };
    }

    // 选择手术用具
    const cardIndex = actionId - ACTION.SELECT_0;
    const selectedCard = this.currentCards[cardIndex];
    if (!selectedCard) return { error: 'invalid_tool_index' };

    this.equippedTools.push(selectedCard.id);
    this.toolAcquiredRound[selectedCard.id] = this.currentRound; // 记录获取回合
    this._log(`装备手术用具: ${selectedCard.name}`);

    // 移除已处理的选择请求
    this.pendingToolSelections.shift();

    // 检查是否还有更多手术用具需要选择
    if (this.pendingToolSelections.length > 0) {
      this._startToolSelection();
    } else if (this.currentRound > POTION_ROUNDS) {
      // 额外回合：无药剂阶段，直接进入回合结算
      this._endRound();
    } else {
      // 进入药剂选择阶段
      this._startPotionPhase();
    }

    return { action: 'select_tool', toolId: selectedCard.id, toolName: selectedCard.name };
  }

  /**
   * 处理药剂选择阶段的动作
   */
  _handlePotionSelectAction(actionId) {
    if (actionId === ACTION.REFRESH) {
      // 刷新药剂：统一从全池重新抽3张（不会再触发药剂箱效果）
      this.potionRefreshesLeft--;
      this.isBoxOpen = false; // 重置药剂箱状态
      this._drawPotions(POTIONS_PER_DRAW, false);
      this._log(`刷新药剂（剩余${this.potionRefreshesLeft}次）`);
      return { action: 'refresh_potions' };
    }

    // 选择药剂
    const cardIndex = actionId - ACTION.SELECT_0;
    const selectedCard = this.currentCards[cardIndex];
    if (!selectedCard) return { error: 'invalid_potion_index' };

    this._log(`选择药剂: ${selectedCard.name}`);

    // 如果选择的是药剂箱
    if (selectedCard.isBox) {
      this.isBoxOpen = true;
      this._drawPotions(selectedCard.boxSize, true); // 不含药剂箱的抽取
      this._log(`打开${selectedCard.name}，抽取${selectedCard.boxSize}张药剂`);
      return { action: 'open_box', boxName: selectedCard.name };
    }

    // 普通药剂选择
    this.pendingPotion = selectedCard;
    this.isBoxOpen = false;

    // 检查是否需要选择目标
    if (selectedCard.targetType === 'select_1' || selectedCard.targetType === 'select_1_or_2') {
      // 检查是否有可选目标（非空培养皿）
      const nonEmpty = this._getNonEmptyDishIndices();
      if (nonEmpty.length === 0) {
        // 没有可选目标，直接执行（效果可能为空）
        this._executePotion(selectedCard, []);
        this._afterPotionExecuted();
        return { action: 'use_potion', potionName: selectedCard.name, targets: [] };
      }
      this.selectedTargets = [];
      this.phase = PHASE.TARGET_SELECT;
      return { action: 'select_targets', potionName: selectedCard.name };
    }

    // 无需选择目标，直接执行
    this._executePotion(selectedCard, []);
    this._afterPotionExecuted();
    return { action: 'use_potion', potionName: selectedCard.name, targets: [] };
  }

  /**
   * 处理目标选择阶段的动作
   */
  _handleTargetSelectAction(actionId) {
    if (actionId === ACTION.CONFIRM) {
      // 确认目标选择，执行药剂效果
      const targets = [...this.selectedTargets];
      this._executePotion(this.pendingPotion, targets);
      this._afterPotionExecuted();
      return { action: 'confirm_targets', targets };
    }

    // 选择培养皿作为目标
    const dishIndex = actionId - ACTION.TARGET_0;
    if (dishIndex < 0 || dishIndex >= DISH_COUNT) return { error: 'invalid_target' };

    this.selectedTargets.push(dishIndex);
    this._log(`选择目标培养皿: ${dishIndex + 1}号`);

    // 检查是否已达到最大目标数，自动确认
    if (this.pendingPotion && this.selectedTargets.length >= this.pendingPotion.maxTargets) {
      const targets = [...this.selectedTargets];
      this._executePotion(this.pendingPotion, targets);
      this._afterPotionExecuted();
      return { action: 'auto_confirm_targets', targets };
    }

    return { action: 'add_target', dishIndex };
  }

  // =====================================================================
  // ===== 阶段转换逻辑 =====
  // =====================================================================

  /**
   * 开始手术用具选择阶段
   */
  _startToolSelection() {
    const pool = this.pendingToolSelections[0];
    this._drawTools(pool);
    this.phase = PHASE.TOOL_SELECT;
    this._log(`进入手术用具选择阶段（${pool === 'basic' ? '基础池1-8' : '高级池9-24'}）`);
  }

  /**
   * 开始药剂选择阶段
   */
  _startPotionPhase() {
    this._savePreviousStats(); // 保存当前状态快照，用于显示变化量
    this._drawPotions(POTIONS_PER_DRAW, false);
    this.phase = PHASE.POTION_SELECT;
    this._log(`回合${this.currentRound}：进入药剂选择阶段`);
  }

  /**
   * 药剂使用完毕后的处理
   */
  _afterPotionExecuted() {
    this.pendingPotion = null;
    this.selectedTargets = [];

    // 执行回合结算
    this._endRound();
  }

  /**
   * 回合结算
   */
  _endRound() {
    this.phase = PHASE.ROUND_END;

    // 额外回合（无药剂的回合）也需要保存快照
    if (this.currentRound > POTION_ROUNDS) {
      this._savePreviousStats();
    }

    this._log(`===== 回合${this.currentRound} 结算开始 =====`);

    // 结算所有已装备手术用具的效果
    this._processToolEffects();

    this._log(`===== 回合${this.currentRound} 结算完成，总活性: ${this.getTotalActivity()} =====`);

    // 检查游戏是否结束
    if (this.currentRound >= this.totalRounds) {
      this.phase = PHASE.GAME_OVER;
      this._log(`游戏结束！最终总活性: ${this.getTotalActivity()}`);
      if (this.onStateChange) this.onStateChange(this.getState());
      return;
    }

    // 进入下一回合
    this.currentRound++;
    this.roundEvents = []; // 清空事件日志

    // 检查是否需要进行手术用具选择（阈值检查）
    this.pendingToolSelections = [];
    const totalAct = this.getTotalActivity();

    if (!this.hasTriggered8000 && totalAct >= TOOL_THRESHOLD_1) {
      this.hasTriggered8000 = true;
      this.pendingToolSelections.push('advanced');
      this._log(`总活性首次超过${TOOL_THRESHOLD_1}，触发高级手术用具选择`);
    }
    if (!this.hasTriggered28000 && totalAct >= TOOL_THRESHOLD_2) {
      this.hasTriggered28000 = true;
      this.pendingToolSelections.push('advanced');
      this._log(`总活性首次超过${TOOL_THRESHOLD_2}，触发高级手术用具选择`);
    }

    if (this.pendingToolSelections.length > 0) {
      this._startToolSelection();
    } else if (this.currentRound > POTION_ROUNDS) {
      // 额外回合：无药剂选择，直接结算工具效果
      this._log(`回合${this.currentRound}：无药剂阶段，直接结算手术用具效果`);
      this._endRound(); // 递归处理额外回合
    } else {
      this._startPotionPhase();
    }
  }

  /**
   * 保存当前培养皿状态快照（用于显示变化量）
   */
  _savePreviousStats() {
    this.previousDishStats = this.dishes.map(m =>
      m ? { activity: m.activity, quantity: m.quantity } : null
    );
  }

  // =====================================================================
  // ===== 卡牌抽取 =====
  // =====================================================================

  /**
   * 抽取手术用具
   * @param {string} pool 'basic' 或 'advanced'
   */
  _drawTools(pool) {
    const poolTools = pool === 'basic' ? TOOLS_BASIC : TOOLS_ADVANCED;
    // 排除已装备的工具
    const available = poolTools.filter(t => !this.equippedTools.includes(t.id));
    if (available.length === 0) {
      this.currentCards = [];
      this._log('没有可用的手术用具');
      return;
    }
    this.currentCards = randomSample(available, TOOLS_PER_DRAW);
  }

  /**
   * 抽取药剂（无放回抽取，同次抽取不重复）
   * @param {number} count 抽取数量
   * @param {boolean} excludeBoxes 是否排除药剂箱
   */
  _drawPotions(count, excludeBoxes) {
    const pool = excludeBoxes ? POTIONS_NO_BOX : POTIONS;
    // 无放回抽取（同次抽出的药剂不会重复）
    this.currentCards = randomSample(pool, Math.min(count, pool.length)).map(p => ({ ...p }));
  }

  // =====================================================================
  // ===== 怪物基础操作 =====
  // =====================================================================

  /**
   * 添加怪物到第一个空培养皿
   * @param {string} species 种群
   * @param {string} rarity 稀有度
   * @param {number} actBonus 额外活性加成
   * @param {number} qtyBonus 额外数量加成
   * @returns {number} 添加到的培养皿索引，-1表示失败（已满）
   */
  _addMonster(species, rarity, actBonus = 0, qtyBonus = 0) {
    const emptyIdx = this._getEmptyDishIndices();
    if (emptyIdx.length === 0) {
      // 培养皿已满，记录溢出事件
      this._logEvent(EVENT_TYPE.ADD_OVERFLOW, { species, rarity });
      // 检查二寸颅骨钉(#16)的效果
      if (this.equippedTools.includes(16)) {
        this._toolEffect_16_overflow();
      }
      this._log(`添加怪物失败：培养皿已满（${getDisplayName(species, rarity)}）`);
      return -1;
    }

    const idx = emptyIdx[0]; // 添加到最左边的空位
    const monster = createMonster(species, rarity, actBonus, qtyBonus);
    this.dishes[idx] = monster;

    // 记录添加事件
    this._logEvent(EVENT_TYPE.ADD, { dishIndex: idx, monster: { ...monster } });
    this._log(`添加怪物到${idx + 1}号培养皿: ${getDisplayName(species, rarity)} (活性${monster.activity} 数量${monster.quantity})`);

    return idx;
  }

  /**
   * 移除指定培养皿中的怪物
   * @param {number} dishIndex 培养皿索引
   * @returns {Object|null} 被移除的怪物对象
   */
  _removeMonster(dishIndex) {
    const monster = this.dishes[dishIndex];
    if (!monster) return null;

    this.dishes[dishIndex] = null;

    // 记录移除事件
    this._logEvent(EVENT_TYPE.REMOVE, {
      dishIndex,
      monster: { ...monster },
      species: monster.species
    });
    this._log(`移除${dishIndex + 1}号培养皿的怪物: ${getDisplayName(monster.species, monster.rarity)}`);

    return monster;
  }

  /**
   * 变异怪物（改变种群和/或稀有度，保留活性和数量）
   * @param {number} dishIndex 培养皿索引
   * @param {string} toSpecies 目标种群（null则随机）
   * @param {string} toRarity 目标稀有度（null则随机）
   * @returns {boolean} 是否成功
   */
  _mutateMonster(dishIndex, toSpecies = null, toRarity = null) {
    const monster = this.dishes[dishIndex];
    if (!monster) return false;

    const fromSpecies = monster.species;
    const fromRarity = monster.rarity;
    monster.species = toSpecies || randomSpecies();
    monster.rarity = toRarity || randomRarity();

    // 记录变异事件
    this._logEvent(EVENT_TYPE.MUTATE, {
      dishIndex,
      fromSpecies, fromRarity,
      toSpecies: monster.species,
      toRarity: monster.rarity
    });
    this._log(`${dishIndex + 1}号培养皿怪物变异: ${getDisplayName(fromSpecies, fromRarity)} → ${getDisplayName(monster.species, monster.rarity)}`);

    return true;
  }

  /**
   * 觉醒怪物（升级稀有度并获得活性加成）
   * @param {number} dishIndex 培养皿索引
   * @param {string} toRarity 目标稀有度（null则自动提升一级）
   * @returns {boolean} 是否成功
   */
  _awakenMonster(dishIndex, toRarity = null) {
    const monster = this.dishes[dishIndex];
    if (!monster) return false;

    const fromRarity = monster.rarity;
    // 觉醒无上限：首领→首领也会生效（+120活性）
    const nextRarity = toRarity || getNextRarity(fromRarity) || fromRarity;

    monster.rarity = nextRarity;
    // 觉醒活性加成（首领→首领按+120计算）
    const bonus = AWAKEN_BONUS[nextRarity] || 120;
    monster.activity += bonus;

    // 记录觉醒事件
    this._logEvent(EVENT_TYPE.AWAKEN, {
      dishIndex,
      fromRarity,
      toRarity: nextRarity,
      activityBonus: bonus
    });
    this._log(`${dishIndex + 1}号培养皿怪物觉醒: ${RARITY_NAMES[fromRarity]} → ${RARITY_NAMES[nextRarity]} (+${bonus}活性)`);

    return true;
  }

  /**
   * 融合多组怪物为一组新怪物
   * @param {number[]} sourceIndices 源培养皿索引数组
   * @param {string} resultSpecies 结果怪物种群
   * @param {string} resultRarity 结果怪物稀有度
   * @returns {number} 新怪物所在培养皿索引，-1表示失败
   */
  _fuseMonsters(sourceIndices, resultSpecies, resultRarity) {
    // 计算合并后的活性和数量
    let totalActivity = 0;
    let totalQuantity = 0;
    const removedMonsters = [];

    for (const idx of sourceIndices) {
      const m = this.dishes[idx];
      if (m) {
        totalActivity += m.activity;
        totalQuantity += m.quantity;
        removedMonsters.push({ ...m, dishIndex: idx });
      }
    }

    // 移除源怪物（不触发移除事件，融合有专属事件）
    for (const idx of sourceIndices) {
      // 手动移除，记录移除事件（融合中的移除也可触发效果）
      this._removeMonster(idx);
    }

    // 创建融合后的新怪物
    const emptyIdx = this._getEmptyDishIndices();
    if (emptyIdx.length === 0) return -1;

    const newMonster = {
      species: resultSpecies,
      rarity: resultRarity,
      activity: totalActivity,
      quantity: totalQuantity
    };
    this.dishes[emptyIdx[0]] = newMonster;

    // 记录融合事件和添加事件
    this._logEvent(EVENT_TYPE.FUSE, {
      sources: removedMonsters,
      result: { ...newMonster },
      dishIndex: emptyIdx[0]
    });
    this._logEvent(EVENT_TYPE.ADD, {
      dishIndex: emptyIdx[0],
      monster: { ...newMonster }
    });

    this._log(`融合完成: ${sourceIndices.map(i => i + 1).join('+')}号 → ${emptyIdx[0] + 1}号 ${getDisplayName(resultSpecies, resultRarity)} (活性${totalActivity} 数量${totalQuantity})`);

    return emptyIdx[0];
  }

  /**
   * 吞噬操作（吞噬者获得被吞噬者的属性）
   * @param {number} devourerIdx 吞噬者培养皿索引
   * @param {number} preyIdx 被吞噬者培养皿索引
   */
  _devourMonster(devourerIdx, preyIdx) {
    const devourer = this.dishes[devourerIdx];
    const prey = this.dishes[preyIdx];
    if (!devourer || !prey) return;

    devourer.activity += prey.activity;
    devourer.quantity += prey.quantity;

    // 移除被吞噬者
    this._removeMonster(preyIdx);

    this._logEvent(EVENT_TYPE.DEVOUR, {
      devourerIdx,
      preyIdx,
      gained: { activity: prey.activity, quantity: prey.quantity }
    });
    this._log(`${devourerIdx + 1}号怪物吞噬了${preyIdx + 1}号怪物 (+${prey.activity}活性 +${prey.quantity}数量)`);
  }

  // =====================================================================
  // ===== 药剂效果实现（36种药剂） =====
  // =====================================================================

  /**
   * 执行药剂效果
   * @param {Object} potion 药剂对象
   * @param {number[]} targets 目标培养皿索引数组
   */
  _executePotion(potion, targets) {
    this._log(`--- 使用药剂: ${potion.name} ---`);
    const handler = this._potionHandlers[potion.id];
    if (handler) {
      handler.call(this, targets);
    } else {
      this._log(`警告: 未实现的药剂效果 - ${potion.name}`);
    }
  }

  /** 药剂效果处理函数映射表 */
  get _potionHandlers() {
    return {
      // [0] 益生霉溶液 - 每拥有1组蛊虫，使所有蛊虫+11活性
      0: function (targets) {
        const guchongCount = this._getDishesBySpecies(SPECIES.GUCHONG).length;
        if (guchongCount === 0) return;
        const guchongDishes = this._getDishesBySpecies(SPECIES.GUCHONG);
        for (const idx of guchongDishes) {
          this.dishes[idx].activity += 11 * guchongCount;
        }
        this._log(`益生霉溶液: ${guchongCount}组蛊虫，所有蛊虫+${11 * guchongCount}活性`);
      },

      // [1] 蜕生皮溶液 - 选择1-2组怪物融合为1组蛊虫
      1: function (targets) {
        if (targets.length === 0) return;
        this._fuseMonsters(targets, SPECIES.GUCHONG, RARITY.COMMON);
      },

      // [2] 软脑膜溶液 - 选择1组怪物+30活性，魔法觉醒者2次，稀有/首领觉醒者3次
      2: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        const m = this.dishes[idx];
        if (!m) return;
        let times = 1;
        if (m.species === SPECIES.JUEXINGZHE) {
          if (m.rarity === RARITY.MAGIC) times = 2;
          else if (m.rarity === RARITY.RARE || m.rarity === RARITY.BOSS) times = 3;
        }
        m.activity += 30 * times;
        this._log(`软脑膜溶液: ${idx + 1}号怪物+${30 * times}活性（生效${times}次）`);
      },

      // [3] 化骨油膏 - 至少1组骨卫兵时，随机移除至多3组非骨卫兵，每移除1组全体+28活+28数
      3: function (targets) {
        const guweiDishes = this._getDishesBySpecies(SPECIES.GUWEBING);
        if (guweiDishes.length === 0) return;
        const nonGuwei = this._getNonEmptyDishIndices().filter(
          i => this.dishes[i].species !== SPECIES.GUWEBING
        );
        const toRemove = randomSample(nonGuwei, Math.min(3, nonGuwei.length));
        for (const idx of toRemove) {
          this._removeMonster(idx);
          // 每移除一组，全体+28活性+28数量
          for (const dish of this._getNonEmptyDishIndices()) {
            this.dishes[dish].activity += 28;
            this.dishes[dish].quantity += 28;
          }
        }
        this._log(`化骨油膏: 移除${toRemove.length}组非骨卫兵怪物`);
      },

      // [4] 清疽油膏 - 选择1组+20活性；骨卫兵额外+41数量并移除右侧
      4: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        const m = this.dishes[idx];
        if (!m) return;
        m.activity += 20;
        this._log(`清疽油膏: ${idx + 1}号怪物+20活性`);
        if (m.species === SPECIES.GUWEBING) {
          m.quantity += 41;
          this._log(`清疽油膏: 骨卫兵额外+41数量`);
          // 移除右侧第一个有怪物的培养皿
          for (let i = idx + 1; i < DISH_COUNT; i++) {
            if (this.dishes[i]) {
              this._removeMonster(i);
              break;
            }
          }
        }
      },

      // [5] 鲜脊髓药粉 - 随机至多3组非异魔变异为异魔，每变异1组使随机3组异魔+42数量
      5: function (targets) {
        const nonYimo = this._getNonEmptyDishIndices().filter(
          i => this.dishes[i].species !== SPECIES.YIMO
        );
        const toMutate = randomSample(nonYimo, Math.min(3, nonYimo.length));
        for (const idx of toMutate) {
          this._mutateMonster(idx, SPECIES.YIMO, null);
          // 随机3组异魔+42数量
          const yimoDishes = this._getDishesBySpecies(SPECIES.YIMO);
          const bonus3 = randomSample(yimoDishes, Math.min(3, yimoDishes.length));
          for (const si of bonus3) {
            this.dishes[si].quantity += 42;
          }
        }
      },

      // [6] 石化脊髓溶液 - 选择1组+20活性，非异魔则变异为异魔并额外+30活性
      6: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        const m = this.dishes[idx];
        if (!m) return;
        m.activity += 20;
        if (m.species !== SPECIES.YIMO) {
          this._mutateMonster(idx, SPECIES.YIMO, null);
          this.dishes[idx].activity += 30;
          this._log(`石化脊髓溶液: 变异为异魔并额外+30活性`);
        }
      },

      // [7] 活性育卵激素 - 添加1组蛊虫，50%概率额外添加2组
      7: function (targets) {
        this._addMonster(SPECIES.GUCHONG, randomRarity());
        if (Math.random() < 0.5) {
          this._addMonster(SPECIES.GUCHONG, randomRarity());
          this._addMonster(SPECIES.GUCHONG, randomRarity());
          this._log(`活性育卵激素: 触发50%概率，额外添加2组蛊虫`);
        }
      },

      // [8] 卵壳药粉 - 随机1组+25数量，蛊虫则添加同名蛊虫+25数量
      8: function (targets) {
        const nonEmpty = this._getNonEmptyDishIndices();
        if (nonEmpty.length === 0) return;
        const idx = randomChoice(nonEmpty);
        const m = this.dishes[idx];
        m.quantity += 25;
        if (m.species === SPECIES.GUCHONG) {
          const newIdx = this._addMonster(SPECIES.GUCHONG, m.rarity);
          if (newIdx >= 0) this.dishes[newIdx].quantity += 25;
        }
      },

      // [9] 脑雾酊剂 - 随机1组+41活性，觉醒者则觉醒为稀有
      9: function (targets) {
        const nonEmpty = this._getNonEmptyDishIndices();
        if (nonEmpty.length === 0) return;
        const idx = randomChoice(nonEmpty);
        const m = this.dishes[idx];
        m.activity += 41;
        if (m.species === SPECIES.JUEXINGZHE) {
          this._awakenMonster(idx, RARITY.RARE);
        }
      },

      // [10] 生骨药粉 - 随机1组+40数量，骨卫兵额外+127数量并移除1组非骨卫兵
      10: function (targets) {
        const nonEmpty = this._getNonEmptyDishIndices();
        if (nonEmpty.length === 0) return;
        const idx = randomChoice(nonEmpty);
        const m = this.dishes[idx];
        m.quantity += 40;
        if (m.species === SPECIES.GUWEBING) {
          m.quantity += 127;
          const nonGuwei = this._getNonEmptyDishIndices().filter(
            i => this.dishes[i] && this.dishes[i].species !== SPECIES.GUWEBING
          );
          if (nonGuwei.length > 0) {
            this._removeMonster(randomChoice(nonGuwei));
          }
        }
      },

      // [11] 灰质脊髓溶液 - 随机1组+41活性，变异为随机；50%再变异为异魔+30活性
      11: function (targets) {
        const nonEmpty = this._getNonEmptyDishIndices();
        if (nonEmpty.length === 0) return;
        const idx = randomChoice(nonEmpty);
        this.dishes[idx].activity += 41;
        this._mutateMonster(idx, null, null);
        if (Math.random() < 0.5) {
          this._mutateMonster(idx, SPECIES.YIMO, null);
          this.dishes[idx].activity += 30;
        }
      },

      // [12] 空心脊髓溶液 - 选择1组+41活性，50%变异为随机异魔
      12: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        const m = this.dishes[idx];
        if (!m) return;
        m.activity += 41;
        if (Math.random() < 0.5) {
          this._mutateMonster(idx, SPECIES.YIMO, null);
        }
      },

      // [13] 青胆汁溶液 - 选择1-2组变异为随机魔法怪物+31活性
      13: function (targets) {
        for (const idx of targets) {
          if (!this.dishes[idx]) continue;
          this._mutateMonster(idx, null, RARITY.MAGIC);
          this.dishes[idx].activity += 31;
        }
      },

      // [14] 混合活蛭溶液 - 选择1组，2组同稀有度+31活性
      14: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        const m = this.dishes[idx];
        if (!m) return;
        const sameRarity = this._getDishesByRarity(m.rarity);
        const toBoost = randomSample(sameRarity, Math.min(2, sameRarity.length));
        for (const si of toBoost) {
          this.dishes[si].activity += 31;
        }
      },

      // [15] 消化酶溶液 - 选择1组+61活性，移除其左侧怪物
      15: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        const m = this.dishes[idx];
        if (!m) return;
        m.activity += 61;
        // 移除左侧最近的怪物
        for (let i = idx - 1; i >= 0; i--) {
          if (this.dishes[i]) {
            this._removeMonster(i);
            break;
          }
        }
      },

      // [16] 活殖药粉 - 随机4组稀有度各不相同的怪物+32数量
      16: function (targets) {
        const nonEmpty = this._getNonEmptyDishIndices();
        // 按稀有度分组，每个稀有度选1组
        const byRarity = {};
        for (const idx of nonEmpty) {
          const r = this.dishes[idx].rarity;
          if (!byRarity[r]) byRarity[r] = [];
          byRarity[r].push(idx);
        }
        const selected = [];
        for (const r of RARITY_ORDER) {
          if (byRarity[r] && byRarity[r].length > 0) {
            selected.push(randomChoice(byRarity[r]));
          }
        }
        for (const idx of selected.slice(0, 4)) {
          this.dishes[idx].quantity += 32;
        }
      },

      // [17] 强效祛异药粉 - 选择1组+154数量，移除2组不同种群怪物
      17: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        const m = this.dishes[idx];
        if (!m) return;
        m.quantity += 154;
        const diffSpecies = this._getNonEmptyDishIndices().filter(
          i => i !== idx && this.dishes[i].species !== m.species
        );
        const toRemove = randomSample(diffSpecies, Math.min(2, diffSpecies.length));
        for (const ri of toRemove) {
          this._removeMonster(ri);
        }
      },

      // [18] 祛异药粉 - 选择1组+127数量，移除1组不同种群
      18: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        const m = this.dishes[idx];
        if (!m) return;
        m.quantity += 127;
        const diffSpecies = this._getNonEmptyDishIndices().filter(
          i => i !== idx && this.dishes[i].species !== m.species
        );
        if (diffSpecies.length > 0) {
          this._removeMonster(randomChoice(diffSpecies));
        }
      },

      // [19] 纯粹活蛭溶液 - 选择1组，2组同种群+31活性
      19: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        const m = this.dishes[idx];
        if (!m) return;
        const sameSpecies = this._getDishesBySpecies(m.species);
        const toBoost = randomSample(sameSpecies, Math.min(2, sameSpecies.length));
        for (const si of toBoost) {
          this.dishes[si].activity += 31;
        }
      },

      // [20] 迷魂酊剂 - 选择1组，觉醒为高1阶稀有度
      20: function (targets) {
        if (targets.length === 0) return;
        this._awakenMonster(targets[0]);
      },

      // [21] 诱变药粉 - 选择1-2组+52数量，变异为随机稀有怪物
      21: function (targets) {
        for (const idx of targets) {
          if (!this.dishes[idx]) continue;
          this.dishes[idx].quantity += 52;
          this._mutateMonster(idx, null, RARITY.RARE);
        }
      },

      // [22] 黏稠胆汁溶液 - 选择1组，右侧变异为与其相同，两者+31活性
      22: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        const m = this.dishes[idx];
        if (!m) return;
        m.activity += 31;
        // 找右侧第一个有怪物的培养皿
        let rightIdx = -1;
        for (let i = idx + 1; i < DISH_COUNT; i++) {
          if (this.dishes[i]) { rightIdx = i; break; }
        }
        if (rightIdx >= 0) {
          this._mutateMonster(rightIdx, m.species, m.rarity);
          this.dishes[rightIdx].activity += 31;
        }
      },

      // [23] 细肢药粉-蛊虫 - 添加1组蛊虫+73数量
      23: function (targets) {
        this._addMonster(SPECIES.GUCHONG, randomRarity(), 0, 73);
      },

      // [24] 孪生激素-蛊虫 - 选择1组变异为蛊虫，添加同名
      24: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        this._mutateMonster(idx, SPECIES.GUCHONG, null);
        const m = this.dishes[idx];
        if (m) {
          this._addMonster(SPECIES.GUCHONG, m.rarity);
        }
      },

      // [25] 脊髓溶液-觉醒者 - 添加1组觉醒者+31活性
      25: function (targets) {
        this._addMonster(SPECIES.JUEXINGZHE, randomRarity(), 31, 0);
      },

      // [26] 麻药酊剂-觉醒者 - 选择1组变异为觉醒者，觉醒为魔法
      26: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        this._mutateMonster(idx, SPECIES.JUEXINGZHE, null);
        this._awakenMonster(idx, RARITY.MAGIC);
      },

      // [27] 细肢药粉-骨卫兵 - 添加1组骨卫兵+73数量
      27: function (targets) {
        this._addMonster(SPECIES.GUWEBING, randomRarity(), 0, 73);
      },

      // [28] 孪生激素-骨卫兵 - 选择1组变异为骨卫兵+62数量
      28: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        this._mutateMonster(idx, SPECIES.GUWEBING, null);
        if (this.dishes[idx]) {
          this.dishes[idx].quantity += 62;
        }
      },

      // [29] 麻药酊剂-异魔 - 选择1组变异为异魔，50%再随机1组变异为异魔
      29: function (targets) {
        if (targets.length === 0) return;
        const idx = targets[0];
        this._mutateMonster(idx, SPECIES.YIMO, null);
        if (Math.random() < 0.5) {
          const others = this._getNonEmptyDishIndices().filter(i => i !== idx);
          if (others.length > 0) {
            this._mutateMonster(randomChoice(others), SPECIES.YIMO, null);
          }
        }
      },

      // [30] 脊髓溶液-异魔 - 添加1组异魔+31活性
      30: function (targets) {
        this._addMonster(SPECIES.YIMO, randomRarity(), 31, 0);
      },

      // [31] 异种激素 - 选择1-2组移除，添加4组随机+5活性
      31: function (targets) {
        for (const idx of targets) {
          this._removeMonster(idx);
        }
        for (let i = 0; i < 4; i++) {
          this._addMonster(randomSpecies(), randomRarity(), 5, 0);
        }
      },

      // [32] 靶向异种激素 - 选择1组移除，添加2组随机种群的魔法怪物+25数量
      32: function (targets) {
        if (targets.length === 0) return;
        this._removeMonster(targets[0]);
        for (let i = 0; i < 2; i++) {
          this._addMonster(randomSpecies(), RARITY.MAGIC, 0, 25);
        }
      }
      // 药剂箱(33-35)在_handlePotionSelectAction中特殊处理
    };
  }

  // =====================================================================
  // ===== 手术用具效果实现（24种手术用具） =====
  // =====================================================================

  /**
   * 处理所有已装备手术用具的回合结算效果
   * 
   * 关键机制：
   * - 回合结算型工具（人蛹标本、增生前额叶等）每回合只触发一次
   * - 事件响应型工具（孵化囊、粘连跖骨等）可以对新产生的事件链式触发
   * - 这样防止周期性工具（疫区圣母像）被循环工具（人蛹标本）带入重复触发
   */
  _processToolEffects() {
    // 事件响应型工具ID集合（这些工具对事件做出反应，可以多轮触发）
    const EVENT_DRIVEN_TOOLS = new Set([2, 5, 6, 7, 8, 12, 16, 22]);

    const sortedTools = [...this.equippedTools].sort((a, b) => a - b);

    // 第一轮：所有工具都处理一次
    let currentEvents = [...this.roundEvents];
    let prevEventCount = this.roundEvents.length;

    for (const toolId of sortedTools) {
      this._processToolEffect(toolId, currentEvents);
    }

    // 后续轮次：仅事件响应型工具处理新产生的事件（最多4轮级联）
    const MAX_CASCADE = 4;
    for (let pass = 0; pass < MAX_CASCADE; pass++) {
      const newEvents = this.roundEvents.slice(prevEventCount);
      if (newEvents.length === 0) break;

      prevEventCount = this.roundEvents.length;
      this._log(`手术用具效果链第${pass + 2}轮处理（${newEvents.length}个新事件）`);

      for (const toolId of sortedTools) {
        // 仅事件响应型工具参与级联
        if (EVENT_DRIVEN_TOOLS.has(toolId)) {
          this._processToolEffect(toolId, newEvents);
        }
      }
    }
  }

  /**
   * 处理单个手术用具的效果
   * @param {number} toolId 工具ID
   * @param {Object[]} events 本轮待处理的事件
   */
  _processToolEffect(toolId, events) {
    switch (toolId) {
      // [1] 人蛹标本 - 蛊虫组数X，随机X组+8数量，重复X次
      case 1: {
        const guchongCount = this._getDishesBySpecies(SPECIES.GUCHONG).length;
        if (guchongCount === 0) break;
        for (let rep = 0; rep < guchongCount; rep++) {
          const nonEmpty = this._getNonEmptyDishIndices();
          const chosen = randomSample(nonEmpty, Math.min(guchongCount, nonEmpty.length));
          for (const idx of chosen) {
            this.dishes[idx].quantity += 8;
          }
        }
        this._log(`[人蛹标本] ${guchongCount}组蛊虫，执行${guchongCount}次，每次随机${guchongCount}组+8数量`);
        break;
      }

      // [2] 孵化囊 - ≥2组蛊虫时，每次添加怪物，全体+45活性
      case 2: {
        const guchongCount = this._getDishesBySpecies(SPECIES.GUCHONG).length;
        if (guchongCount < 2) break;
        const addEvents = events.filter(e => e.type === EVENT_TYPE.ADD);
        if (addEvents.length === 0) break;
        for (const _e of addEvents) {
          for (const idx of this._getNonEmptyDishIndices()) {
            this.dishes[idx].activity += 45;
          }
        }
        this._log(`[孵化囊] ${addEvents.length}次添加事件，全体+${45 * addEvents.length}活性`);
        break;
      }

      // [3] 增生前额叶 - ≥2组觉醒者时，随机1组稀有/首领+80活性
      case 3: {
        const jxzCount = this._getDishesBySpecies(SPECIES.JUEXINGZHE).length;
        if (jxzCount < 2) break;
        const rareOrBoss = this._getNonEmptyDishIndices().filter(
          i => this.dishes[i].rarity === RARITY.RARE || this.dishes[i].rarity === RARITY.BOSS
        );
        if (rareOrBoss.length > 0) {
          const idx = randomChoice(rareOrBoss);
          this.dishes[idx].activity += 80;
          this._log(`[增生前额叶] ${idx + 1}号稀有/首领+80活性`);
        }
        break;
      }

      // [4] 肿大脑垂体 - 拥有稀有/首领觉醒者时，随机1组+80活性
      case 4: {
        const hasRareBossJxz = this._getNonEmptyDishIndices().some(
          i => this.dishes[i].species === SPECIES.JUEXINGZHE &&
            (this.dishes[i].rarity === RARITY.RARE || this.dishes[i].rarity === RARITY.BOSS)
        );
        if (!hasRareBossJxz) break;
        const nonEmpty = this._getNonEmptyDishIndices();
        if (nonEmpty.length > 0) {
          const idx = randomChoice(nonEmpty);
          this.dishes[idx].activity += 80;
          this._log(`[肿大脑垂体] ${idx + 1}号怪物+80活性`);
        }
        break;
      }

      // [5] 粘连跖骨 - ≥2组骨卫兵时，每次移除，随机1组+180数量
      case 5: {
        const guweiCount = this._getDishesBySpecies(SPECIES.GUWEBING).length;
        if (guweiCount < 2) break;
        const removeEvents = events.filter(e => e.type === EVENT_TYPE.REMOVE);
        for (const _e of removeEvents) {
          const nonEmpty = this._getNonEmptyDishIndices();
          if (nonEmpty.length > 0) {
            const idx = randomChoice(nonEmpty);
            this.dishes[idx].quantity += 180;
            this._log(`[粘连跖骨] ${idx + 1}号怪物+180数量`);
          }
        }
        break;
      }

      // [6] 挛缩指爪 - 移除非骨卫兵时，随机1组+150数量
      case 6: {
        const removeEvents = events.filter(
          e => e.type === EVENT_TYPE.REMOVE && e.data.species !== SPECIES.GUWEBING
        );
        for (const _e of removeEvents) {
          const nonEmpty = this._getNonEmptyDishIndices();
          if (nonEmpty.length > 0) {
            const idx = randomChoice(nonEmpty);
            this.dishes[idx].quantity += 150;
            this._log(`[挛缩指爪] ${idx + 1}号怪物+150数量`);
          }
        }
        break;
      }

      // [7] 孽生肉芽 - 变异为异魔时，全体+35活性
      case 7: {
        const mutateToYimo = events.filter(
          e => e.type === EVENT_TYPE.MUTATE && e.data.toSpecies === SPECIES.YIMO
        );
        if (mutateToYimo.length === 0) break;
        for (const _e of mutateToYimo) {
          for (const idx of this._getNonEmptyDishIndices()) {
            this.dishes[idx].activity += 35;
          }
        }
        this._log(`[孽生肉芽] ${mutateToYimo.length}次变异为异魔，全体+${35 * mutateToYimo.length}活性`);
        break;
      }

      // [8] 斑斓肝脏 - ≥2组异魔时，每次变异全体+20活性
      case 8: {
        const yimoCount = this._getDishesBySpecies(SPECIES.YIMO).length;
        if (yimoCount < 2) break;
        const mutateEvents = events.filter(e => e.type === EVENT_TYPE.MUTATE);
        if (mutateEvents.length === 0) break;
        for (const _e of mutateEvents) {
          for (const idx of this._getNonEmptyDishIndices()) {
            this.dishes[idx].activity += 20;
          }
        }
        this._log(`[斑斓肝脏] ${mutateEvents.length}次变异，全体+${20 * mutateEvents.length}活性`);
        break;
      }

      // [9] 簇生虫卵 - ≥3组蛊虫时，添加1组蛊虫+100数量
      case 9: {
        const guchongCount = this._getDishesBySpecies(SPECIES.GUCHONG).length;
        if (guchongCount < 3) break;
        const newIdx = this._addMonster(SPECIES.GUCHONG, randomRarity());
        if (newIdx >= 0) {
          this.dishes[newIdx].quantity += 100;
          this._log(`[簇生虫卵] 添加蛊虫到${newIdx + 1}号+100数量`);
        }
        break;
      }

      // [10] 蜕生脑皮层 - 随机2组魔法怪物融合为稀有觉醒者
      case 10: {
        const magicDishes = this._getNonEmptyDishIndices().filter(
          i => this.dishes[i].rarity === RARITY.MAGIC
        );
        if (magicDishes.length < 2) break;
        const toFuse = randomSample(magicDishes, 2);
        this._fuseMonsters(toFuse, SPECIES.JUEXINGZHE, RARITY.RARE);
        this._log(`[蜕生脑皮层] 融合${toFuse.map(i => i + 1).join('和')}号为稀有觉醒者`);
        break;
      }

      // [11] 兽筋绞肉索 - ≥2组骨卫兵，移除最低非骨卫兵，随机1组骨卫兵获得其属性
      case 11: {
        const guweiDishes = this._getDishesBySpecies(SPECIES.GUWEBING);
        if (guweiDishes.length < 2) break;
        const nonGuwei = this._getNonEmptyDishIndices().filter(
          i => this.dishes[i].species !== SPECIES.GUWEBING
        );
        if (nonGuwei.length === 0) break;
        // 找总活性最低的非骨卫兵
        let lowestIdx = nonGuwei[0];
        for (const idx of nonGuwei) {
          if (getDishTotal(this.dishes[idx]) < getDishTotal(this.dishes[lowestIdx])) {
            lowestIdx = idx;
          }
        }
        const removed = this._removeMonster(lowestIdx);
        if (removed) {
          const targetGuwei = randomChoice(guweiDishes);
          this.dishes[targetGuwei].activity += removed.activity;
          this.dishes[targetGuwei].quantity += removed.quantity;
          this._log(`[兽筋绞肉索] 移除${lowestIdx + 1}号，${targetGuwei + 1}号骨卫兵获得其属性`);
        }
        break;
      }

      // [12] 蠕动脊髓 - 每次添加怪物，75%变异为异魔+80活性
      case 12: {
        const addEvents = events.filter(e => e.type === EVENT_TYPE.ADD);
        for (const e of addEvents) {
          const idx = e.data.dishIndex;
          if (!this.dishes[idx]) continue;
          if (Math.random() < 0.75) {
            this._mutateMonster(idx, SPECIES.YIMO, null);
            this.dishes[idx].activity += 80;
            this._log(`[蠕动脊髓] ${idx + 1}号变异为异魔+80活性`);
          }
        }
        break;
      }

      // [13] 生皮革拘束带 - 3组魔法时，总活性最高+100数量
      case 13: {
        const magicCount = this._getNonEmptyDishIndices().filter(
          i => this.dishes[i].rarity === RARITY.MAGIC
        ).length;
        if (magicCount < 3) break;
        const highest = this._getHighestTotalDish();
        if (highest >= 0) {
          this.dishes[highest].quantity += 100;
          this._log(`[生皮革拘束带] ${highest + 1}号（最高总活性）+100数量`);
        }
        break;
      }

      // [14] 黑山羊肠缝线 - 每3组相同稀有度融合为1组更高稀有度
      case 14: {
        for (const r of RARITY_ORDER) {
          if (r === RARITY.BOSS) continue; // 首领无法再升
          const sameRarity = this._getNonEmptyDishIndices().filter(
            i => this.dishes[i].rarity === r
          );
          while (sameRarity.length >= 3) {
            const toFuse = sameRarity.splice(0, 3);
            const nextR = getNextRarity(r);
            // 保留第一个的种群
            const species = this.dishes[toFuse[0]].species;
            this._fuseMonsters(toFuse, species, nextR || RARITY.BOSS);
            this._log(`[黑山羊肠缝线] 融合3组${RARITY_NAMES[r]}怪物为${RARITY_NAMES[nextR]}怪物`);
          }
        }
        break;
      }

      // [15] 生铁骨锯 - 数量和活性都>150的+15活性+15数量
      case 15: {
        for (const idx of this._getNonEmptyDishIndices()) {
          const m = this.dishes[idx];
          if (m.quantity > 150 && m.activity > 150) {
            m.activity += 15;
            m.quantity += 15;
            this._log(`[生铁骨锯] ${idx + 1}号+15活性+15数量`);
          }
        }
        break;
      }

      // [16] 二寸颅骨钉 - 溢出时在_addMonster中单独处理
      case 16:
        // 效果在 _toolEffect_16_overflow 中处理
        break;

      // [17] 脏污刮骨刀 - 数量>275的+20活性
      case 17: {
        for (const idx of this._getNonEmptyDishIndices()) {
          if (this.dishes[idx].quantity > 275) {
            this.dishes[idx].activity += 20;
            this._log(`[脏污刮骨刀] ${idx + 1}号（数量${this.dishes[idx].quantity}）+20活性`);
          }
        }
        break;
      }

      // [18] 犬牙锉刀 - 活性>255的+30数量
      case 18: {
        for (const idx of this._getNonEmptyDishIndices()) {
          if (this.dishes[idx].activity > 255) {
            this.dishes[idx].quantity += 30;
            this._log(`[犬牙锉刀] ${idx + 1}号（活性${this.dishes[idx].activity}）+30数量`);
          }
        }
        break;
      }

      // [19] 疫区圣母像 - 每2回合，每个稀有度随机1组觉醒（从获取回合开始计算）
      case 19: {
        const acquired = this.toolAcquiredRound[19] || 1;
        const elapsed = this.currentRound - acquired;
        if (elapsed <= 0 || elapsed % 2 !== 0) break;
        for (const r of RARITY_ORDER) {
          // 觉醒无上限，首领也可以觉醒（保持首领+120活性）
          const candidates = this._getNonEmptyDishIndices().filter(
            i => this.dishes[i].rarity === r
          );
          if (candidates.length > 0) {
            this._awakenMonster(randomChoice(candidates));
          }
        }
        this._log(`[疫区圣母像] 第${this.currentRound}回合（获取于第${acquired}回合，间隔${elapsed}），执行觉醒`);
        break;
      }

      // [20] 异形蛰针 - 每3回合，所有怪物变异为随机（从获取回合开始计算）
      case 20: {
        const acquired = this.toolAcquiredRound[20] || 1;
        const elapsed = this.currentRound - acquired;
        if (elapsed <= 0 || elapsed % 3 !== 0) break;
        for (const idx of this._getNonEmptyDishIndices()) {
          this._mutateMonster(idx, null, null);
        }
        this._log(`[异形蛰针] 第${this.currentRound}回合（获取于第${acquired}回合，间隔${elapsed}），全体变异`);
        break;
      }

      // [21] 鞣制皮革拘束带 - 同时有普通/魔法/首领时，全体+20活性
      case 21: {
        const rarities = new Set(
          this._getNonEmptyDishIndices().map(i => this.dishes[i].rarity)
        );
        if (rarities.has(RARITY.COMMON) && rarities.has(RARITY.MAGIC) && rarities.has(RARITY.BOSS)) {
          for (const idx of this._getNonEmptyDishIndices()) {
            this.dishes[idx].activity += 20;
          }
          this._log(`[鞣制皮革拘束带] 条件满足，全体+20活性`);
        }
        break;
      }

      // [22] 眼睑扩张器 - 移除时总活性最高+20活性+20数量
      case 22: {
        const removeEvents = events.filter(e => e.type === EVENT_TYPE.REMOVE);
        for (const _e of removeEvents) {
          const highest = this._getHighestTotalDish();
          if (highest >= 0) {
            this.dishes[highest].activity += 20;
            this.dishes[highest].quantity += 20;
          }
        }
        if (removeEvents.length > 0) {
          this._log(`[眼睑扩张器] ${removeEvents.length}次移除，最高总活性怪物+${20 * removeEvents.length}活性/数量`);
        }
        break;
      }

      // [23] 二度降生者之喙 - 2组怪物则添加1组；6组则最高吞噬最低
      case 23: {
        const count = this._getNonEmptyDishIndices().length;
        if (count === 2) {
          this._addMonster(randomSpecies(), randomRarity());
          this._log(`[二度降生者之喙] 仅2组怪物，添加新怪物`);
        } else if (count === 6) {
          const highest = this._getHighestTotalDish();
          const lowest = this._getLowestTotalDish();
          if (highest >= 0 && lowest >= 0 && highest !== lowest) {
            this._devourMonster(highest, lowest);
            this._log(`[二度降生者之喙] 6组怪物，${highest + 1}号吞噬${lowest + 1}号`);
          }
        }
        break;
      }

      // [24] 荨麻绳扣 - 3组普通时，全体+30数量
      case 24: {
        const commonCount = this._getNonEmptyDishIndices().filter(
          i => this.dishes[i].rarity === RARITY.COMMON
        ).length;
        if (commonCount < 3) break;
        for (const idx of this._getNonEmptyDishIndices()) {
          this.dishes[idx].quantity += 30;
        }
        this._log(`[荨麻绳扣] ${commonCount}组普通怪物，全体+30数量`);
        break;
      }
    }
  }

  /**
   * 二寸颅骨钉(#16)的溢出效果
   * 添加怪物失败时触发
   */
  _toolEffect_16_overflow() {
    const lowest = this._getLowestTotalDish();
    if (lowest >= 0) {
      this.dishes[lowest].activity += 25;
      this.dishes[lowest].quantity += 25;
      this._log(`[二寸颅骨钉] 培养皿溢出，${lowest + 1}号最低总活性+25活性+25数量`);
    }
  }

  // =====================================================================
  // ===== 事件系统 =====
  // =====================================================================

  /**
   * 记录事件到回合事件日志
   * @param {string} type 事件类型
   * @param {Object} data 事件数据
   */
  _logEvent(type, data) {
    this.roundEvents.push({ type, data, round: this.currentRound });
  }

  // =====================================================================
  // ===== 辅助查询方法（供效果和RL使用） =====
  // =====================================================================

  /** 获取所有空培养皿的索引 */
  _getEmptyDishIndices() {
    return this.dishes.reduce((acc, d, i) => {
      if (!d) acc.push(i);
      return acc;
    }, []);
  }

  /** 获取所有非空培养皿的索引 */
  _getNonEmptyDishIndices() {
    return this.dishes.reduce((acc, d, i) => {
      if (d) acc.push(i);
      return acc;
    }, []);
  }

  /** 获取指定种群的培养皿索引 */
  _getDishesBySpecies(species) {
    return this._getNonEmptyDishIndices().filter(i => this.dishes[i].species === species);
  }

  /** 获取指定稀有度的培养皿索引 */
  _getDishesByRarity(rarity) {
    return this._getNonEmptyDishIndices().filter(i => this.dishes[i].rarity === rarity);
  }

  /** 获取总活性最高的培养皿索引 */
  _getHighestTotalDish() {
    const nonEmpty = this._getNonEmptyDishIndices();
    if (nonEmpty.length === 0) return -1;
    return nonEmpty.reduce((best, idx) =>
      getDishTotal(this.dishes[idx]) > getDishTotal(this.dishes[best]) ? idx : best
    , nonEmpty[0]);
  }

  /** 获取总活性最低的培养皿索引 */
  _getLowestTotalDish() {
    const nonEmpty = this._getNonEmptyDishIndices();
    if (nonEmpty.length === 0) return -1;
    return nonEmpty.reduce((best, idx) =>
      getDishTotal(this.dishes[idx]) < getDishTotal(this.dishes[best]) ? idx : best
    , nonEmpty[0]);
  }

  // =====================================================================
  // ===== 日志系统 =====
  // =====================================================================

  /**
   * 输出日志
   * @param {string} message 日志内容
   */
  _log(message) {
    if (this.onLog) this.onLog(message);
  }

  // =====================================================================
  // ===== Debug接口（供调试面板使用） =====
  // =====================================================================

  /**
   * [Debug] 直接设置培养皿中的怪物
   * @param {number} dishIndex 培养皿索引
   * @param {Object|null} monster 怪物对象或null（清空）
   */
  debugSetDish(dishIndex, monster) {
    if (dishIndex < 0 || dishIndex >= DISH_COUNT) return;
    this.dishes[dishIndex] = monster ? { ...monster } : null;
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  /**
   * [Debug] 添加手术用具
   * @param {number} toolId 工具ID
   */
  debugAddTool(toolId) {
    if (!this.equippedTools.includes(toolId)) {
      this.equippedTools.push(toolId);
      if (this.onStateChange) this.onStateChange(this.getState());
    }
  }

  /**
   * [Debug] 移除手术用具
   * @param {number} toolId 工具ID
   */
  debugRemoveTool(toolId) {
    this.equippedTools = this.equippedTools.filter(id => id !== toolId);
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  /**
   * [Debug] 设置当前可选卡牌
   * @param {Object[]} cards 卡牌数组
   */
  debugSetCards(cards) {
    this.currentCards = cards.map(c => ({ ...c }));
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  /**
   * [Debug] 设置回合数
   * @param {number} round 回合数
   */
  debugSetRound(round) {
    this.currentRound = Math.max(1, Math.min(round, this.totalRounds));
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  /**
   * [Debug] 设置游戏阶段
   * @param {string} phase 阶段枚举值
   */
  debugSetPhase(phase) {
    this.phase = phase;
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  /**
   * [Debug] 在指定位置添加怪物
   * @param {number} dishIndex 培养皿索引
   * @param {string} species 种群
   * @param {string} rarity 稀有度
   * @param {number} activity 活性
   * @param {number} quantity 数量
   */
  debugAddMonsterAt(dishIndex, species, rarity, activity, quantity) {
    if (dishIndex < 0 || dishIndex >= DISH_COUNT) return;
    this.dishes[dishIndex] = { species, rarity, activity, quantity };
    if (this.onStateChange) this.onStateChange(this.getState());
  }

  /**
   * [Debug] 删除指定培养皿的怪物
   * @param {number} dishIndex 培养皿索引
   */
  debugRemoveMonsterAt(dishIndex) {
    if (dishIndex < 0 || dishIndex >= DISH_COUNT) return;
    this.dishes[dishIndex] = null;
    if (this.onStateChange) this.onStateChange(this.getState());
  }
}
