/**
 * ui.js - 界面交互逻辑层
 * 负责将GameEngine的状态渲染到DOM，以及将用户操作转化为engine.step()调用
 */

// ===== 全局引擎实例 =====
let engine = null;

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
  initGame();
});

/**
 * 初始化游戏
 * @param {Object} config 配置项（可选）
 */
function initGame(config = {}) {
  // 创建引擎实例
  engine = new GameEngine({
    toolRefreshes: config.toolRefreshes ?? 0,
    potionRefreshes: config.potionRefreshes ?? 3
  });

  // 绑定引擎回调
  engine.onStateChange = (state) => renderState(state);
  engine.onLog = (message) => addLogEntry(message);

  // 重置并获取初始状态
  const initialState = engine.reset();
  renderState(initialState);
}

/**
 * 重新开始游戏
 */
function restartGame() {
  document.getElementById('game-over-overlay').classList.remove('visible');
  // 保留当前配置重新初始化
  initGame({
    toolRefreshes: engine.config.toolRefreshes,
    potionRefreshes: engine.config.potionRefreshes
  });
}

// =====================================================================
// ===== 渲染函数 =====
// =====================================================================

/**
 * 根据游戏状态渲染整个界面
 * @param {Object} state 游戏状态对象（来自engine.getState()）
 */
function renderState(state) {
  renderHeader(state);
  renderPhaseBanner(state);
  renderDishes(state);
  renderCards(state);
  renderTools(state);
  renderConfirmButton(state);
  renderGameOver(state);
}

/**
 * 渲染顶部状态栏
 */
function renderHeader(state) {
  document.getElementById('round-display').textContent =
    `${state.currentRound}/${state.totalRounds}`;
  document.getElementById('potion-refresh-display').textContent =
    state.potionRefreshesLeft;
  document.getElementById('tool-refresh-display').textContent =
    state.toolRefreshesLeft;
  document.getElementById('total-activity-display').textContent =
    state.totalActivity.toLocaleString();
}

/**
 * 渲染阶段提示条
 */
function renderPhaseBanner(state) {
  const textEl = document.getElementById('phase-text');
  const phaseMessages = {
    [PHASE.INIT]: '初始化中...',
    [PHASE.TOOL_SELECT]: `🔧 回合${state.currentRound} - 请选择一件手术用具`,
    [PHASE.POTION_SELECT]: `💉 回合${state.currentRound} - 请选择一张药剂卡使用`,
    [PHASE.TARGET_SELECT]: `🎯 请选择目标培养皿（${state.selectedTargets.length}/${state.pendingPotion ? state.pendingPotion.maxTargets : '?'}）`,
    [PHASE.ROUND_END]: `⏳ 回合${state.currentRound} 结算中...`,
    [PHASE.GAME_OVER]: '🏆 实验完成！'
  };
  textEl.textContent = phaseMessages[state.phase] || state.phase;
}

/**
 * 渲染6个培养皿
 */
function renderDishes(state) {
  const container = document.getElementById('dishes-container');
  container.innerHTML = '';

  const validActions = engine.getValidActions();

  for (let i = 0; i < DISH_COUNT; i++) {
    const dish = state.dishes[i];
    const monster = dish.monster;
    const div = document.createElement('div');
    div.className = 'dish';
    div.id = `dish-${i}`;

    // 是否可被选为目标
    const isSelectable = state.phase === PHASE.TARGET_SELECT &&
      validActions[ACTION.TARGET_0 + i];
    const isSelected = state.selectedTargets.includes(i);

    if (!monster) {
      div.classList.add('empty');
      div.innerHTML = `
        <span class="dish-index">#${i + 1}</span>
        <span class="dish-empty-label">空培养皿</span>
      `;
    } else {
      // 添加稀有度和种群样式类
      div.classList.add(`rarity-${monster.rarity}`, `species-${monster.species}`);

      // 计算变化量（与上回合对比）
      const prev = state.previousDishStats && state.previousDishStats[i];
      let actDelta = '', qtyDelta = '', totalDelta = '';
      if (prev) {
        const da = monster.activity - prev.activity;
        const dq = monster.quantity - prev.quantity;
        const prevTotal = prev.activity * prev.quantity;
        const dt = monster.totalActivity - prevTotal;
        if (da !== 0) actDelta = `<span class="delta ${da > 0 ? 'pos' : 'neg'}">(${da > 0 ? '+' : ''}${da})</span>`;
        if (dq !== 0) qtyDelta = `<span class="delta ${dq > 0 ? 'pos' : 'neg'}">(${dq > 0 ? '+' : ''}${dq})</span>`;
        if (dt !== 0) totalDelta = `<span class="delta ${dt > 0 ? 'pos' : 'neg'}">(${dt > 0 ? '+' : ''}${dt.toLocaleString()})</span>`;
      }

      div.innerHTML = `
        <span class="dish-index">#${i + 1}</span>
        <div class="dish-content">
          <span class="monster-rarity-badge">${RARITY_NAMES[monster.rarity]}</span>
          <span class="monster-name">${monster.displayName}</span>
          <div class="monster-stats">
            <div class="stat-row activity">
              <span class="label">活性</span>
              <span class="value">${monster.activity} ${actDelta}</span>
            </div>
            <div class="stat-row quantity">
              <span class="label">数量</span>
              <span class="value">${monster.quantity} ${qtyDelta}</span>
            </div>
          </div>
          <div class="total-activity">总活: ${monster.totalActivity.toLocaleString()} ${totalDelta}</div>
        </div>
      `;
    }

    // 可选/已选状态
    if (isSelectable) div.classList.add('selectable');
    if (isSelected) div.classList.add('selected');

    // 点击事件
    if (isSelectable) {
      div.addEventListener('click', () => onDishClicked(i));
    }

    container.appendChild(div);
  }
}

/**
 * 渲染卡牌区域
 */
function renderCards(state) {
  const grid = document.getElementById('cards-grid');
  const titleText = document.getElementById('cards-title-text');
  const refreshBtn = document.getElementById('refresh-btn');
  const refreshCount = document.getElementById('refresh-count');

  grid.innerHTML = '';

  // 根据阶段设置标题和刷新按钮
  if (state.phase === PHASE.TOOL_SELECT) {
    titleText.textContent = '🔧 选择手术用具';
    refreshBtn.disabled = state.toolRefreshesLeft <= 0;
    refreshCount.textContent = state.toolRefreshesLeft;
  } else if (state.phase === PHASE.POTION_SELECT) {
    titleText.textContent = state.isBoxOpen ? '📦 药剂箱内容' : '💉 选择药剂';
    refreshBtn.disabled = state.potionRefreshesLeft <= 0;
    refreshCount.textContent = state.potionRefreshesLeft;
  } else if (state.phase === PHASE.TARGET_SELECT) {
    titleText.textContent = `🎯 ${state.pendingPotion ? state.pendingPotion.name : ''} - 选择目标`;
    refreshBtn.disabled = true;
    refreshCount.textContent = '-';
  } else {
    titleText.textContent = '等待中...';
    refreshBtn.disabled = true;
    refreshCount.textContent = '-';
  }

  // 渲染每张卡牌
  if (state.phase === PHASE.TOOL_SELECT || state.phase === PHASE.POTION_SELECT) {
    state.currentCards.forEach((card, index) => {
      const cardDiv = document.createElement('div');
      cardDiv.className = `card ${state.phase === PHASE.TOOL_SELECT ? 'tool-card' : 'potion-card'}`;
      cardDiv.id = `card-${index}`;

      // 药剂稀有度显示
      let rarityBadge = '';
      if (card.potionRarity) {
        rarityBadge = `<span class="card-rarity ${card.potionRarity}">${
          card.potionRarity === 'rare' ? '稀有药剂' :
          card.potionRarity === 'magic' ? '魔法药剂' : '普通药剂'
        }</span>`;
      }

      cardDiv.innerHTML = `
        <div class="card-name">${card.name}</div>
        ${rarityBadge}
        <div class="card-desc">${card.description}</div>
      `;

      cardDiv.addEventListener('click', () => onCardClicked(index));
      grid.appendChild(cardDiv);
    });
  }
}

/**
 * 渲染已装备的手术用具列表
 */
function renderTools(state) {
  const toolsList = document.getElementById('tools-list');

  if (state.equippedTools.length === 0) {
    toolsList.innerHTML = '<div class="empty-tools">暂无已装备的手术用具</div>';
    return;
  }

  toolsList.innerHTML = state.equippedTools.map(tool => `
    <div class="tool-item" title="${tool.description}">
      <div class="tool-name">${tool.name}</div>
      <div class="tool-desc">${tool.description}</div>
    </div>
  `).join('');
}

/**
 * 渲染确认按钮（目标选择阶段）
 */
function renderConfirmButton(state) {
  const btn = document.getElementById('confirm-btn');
  if (state.phase === PHASE.TARGET_SELECT && state.pendingPotion) {
    const canConfirm = state.selectedTargets.length >= state.pendingPotion.minTargets;
    btn.classList.toggle('visible', canConfirm);
    btn.textContent = `✓ 确认选择 (${state.selectedTargets.length}/${state.pendingPotion.maxTargets})`;
  } else {
    btn.classList.remove('visible');
  }
}

/**
 * 渲染游戏结束画面
 */
function renderGameOver(state) {
  const overlay = document.getElementById('game-over-overlay');
  if (state.phase === PHASE.GAME_OVER) {
    document.getElementById('final-score').textContent =
      state.totalActivity.toLocaleString();
    overlay.classList.add('visible');
  }
}

// =====================================================================
// ===== 用户交互事件处理 =====
// =====================================================================

/**
 * 卡牌被点击
 * @param {number} cardIndex 卡牌索引
 */
function onCardClicked(cardIndex) {
  if (!engine) return;
  const actionId = ACTION.SELECT_0 + cardIndex;
  const result = engine.step(actionId);
  renderState(result.state);
}

/**
 * 培养皿被点击（目标选择阶段）
 * @param {number} dishIndex 培养皿索引
 */
function onDishClicked(dishIndex) {
  if (!engine) return;
  const actionId = ACTION.TARGET_0 + dishIndex;
  const result = engine.step(actionId);
  renderState(result.state);
}

/**
 * 刷新按钮被点击
 */
function onRefreshClicked() {
  if (!engine) return;
  const result = engine.step(ACTION.REFRESH);
  renderState(result.state);
}

/**
 * 确认按钮被点击（目标选择阶段）
 */
function onConfirmClicked() {
  if (!engine) return;
  const result = engine.step(ACTION.CONFIRM);
  renderState(result.state);
}

// =====================================================================
// ===== 日志系统 =====
// =====================================================================

/**
 * 添加一条日志
 * @param {string} message 日志内容
 */
function addLogEntry(message) {
  const panel = document.getElementById('log-panel');
  if (!panel) return;

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  if (message.startsWith('=====') || message.startsWith('---')) {
    entry.classList.add('important');
  }
  entry.textContent = message;
  panel.appendChild(entry);

  // 自动滚动到底部
  panel.scrollTop = panel.scrollHeight;
}
