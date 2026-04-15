/**
 * debug.js - 调试面板
 * 提供自由修改培养皿怪物参数、卡牌池、已装备手术用具的功能
 * 所有操作通过engine的debug接口实现
 */

// ===== Debug面板状态 =====
let debugOpen = false;

/**
 * 切换Debug面板的显示/隐藏
 */
function toggleDebug() {
  debugOpen = !debugOpen;
  const panel = document.getElementById('debug-panel');
  panel.classList.toggle('open', debugOpen);
  if (debugOpen) {
    renderDebugPanel();
  }
}

/**
 * 渲染整个Debug面板内容
 */
function renderDebugPanel() {
  const panel = document.getElementById('debug-panel');
  if (!engine) return;

  const state = engine.getState();

  panel.innerHTML = `
    <h3 style="color: var(--danger); font-family: 'Orbitron', monospace; margin-bottom: 16px; font-size: 1rem;">
      ⚠ 调试面板
    </h3>

    <!-- ===== 游戏控制 ===== -->
    <div class="debug-section">
      <div class="debug-section-title">🎮 游戏控制</div>
      <div class="debug-row">
        <span class="debug-label">回合:</span>
        <input type="number" class="debug-input" id="debug-round" value="${state.currentRound}" min="1" max="13" style="width:60px">
        <button class="debug-btn" onclick="debugSetRound()">设置</button>
      </div>
      <div class="debug-row">
        <span class="debug-label">药剂刷新:</span>
        <input type="number" class="debug-input" id="debug-potion-refresh" value="${state.potionRefreshesLeft}" min="0" max="99" style="width:60px">
        <button class="debug-btn" onclick="debugSetPotionRefresh()">设置</button>
      </div>
      <div class="debug-row">
        <span class="debug-label">工具刷新:</span>
        <input type="number" class="debug-input" id="debug-tool-refresh" value="${state.toolRefreshesLeft}" min="0" max="99" style="width:60px">
        <button class="debug-btn" onclick="debugSetToolRefresh()">设置</button>
      </div>
      <div class="debug-row">
        <button class="debug-btn success" onclick="debugRestart(0)" style="flex:1;">重开(0刷新)</button>
        <button class="debug-btn success" onclick="debugRestart(1)" style="flex:1;">重开(1刷新)</button>
        <button class="debug-btn success" onclick="debugRestart(2)" style="flex:1;">重开(2刷新)</button>
      </div>
    </div>

    <!-- ===== 培养皿编辑 ===== -->
    <div class="debug-section">
      <div class="debug-section-title">🧪 培养皿编辑</div>
      ${renderDebugDishes(state)}
      <div class="debug-row" style="margin-top:8px;">
        <button class="debug-btn success" onclick="debugAddNewMonster()" style="flex:1;">+ 添加怪物到空位</button>
      </div>
    </div>

    <!-- ===== 手术用具管理 ===== -->
    <div class="debug-section">
      <div class="debug-section-title">🔧 手术用具管理</div>
      <div style="margin-bottom:8px;">
        <span style="font-size:0.65rem;color:var(--text-muted);">已装备: ${state.equippedTools.map(t => t.name).join(', ') || '无'}</span>
      </div>
      <div class="debug-row">
        <select class="debug-select" id="debug-add-tool">
          ${TOOLS.filter(t => !engine.equippedTools.includes(t.id))
            .map(t => `<option value="${t.id}">${t.id}. ${t.name}</option>`).join('')}
        </select>
        <button class="debug-btn success" onclick="debugAddTool()">装备</button>
      </div>
      <div class="debug-row">
        <select class="debug-select" id="debug-remove-tool">
          ${state.equippedTools.map(t => `<option value="${t.id}">${t.id}. ${t.name}</option>`).join('')}
        </select>
        <button class="debug-btn" onclick="debugRemoveTool()">卸下</button>
      </div>
    </div>

    <!-- ===== 药剂卡修改 ===== -->
    <div class="debug-section">
      <div class="debug-section-title">💉 当前药剂卡修改</div>
      <div class="debug-row">
        <select class="debug-select" id="debug-set-potion">
          ${POTIONS.map(p => `<option value="${p.id}">${p.name} (${p.potionRarity})</option>`).join('')}
        </select>
        <select class="debug-select" id="debug-set-potion-slot" style="width:70px">
          <option value="0">位置1</option>
          <option value="1">位置2</option>
          <option value="2">位置3</option>
          <option value="3">位置4</option>
          <option value="4">位置5</option>
        </select>
        <button class="debug-btn success" onclick="debugSetPotionCard()">替换</button>
      </div>
      <div class="debug-row">
        <button class="debug-btn" onclick="debugForcePhase('potion_select')" style="flex:1;">强制进入药剂选择</button>
      </div>
      <div class="debug-row">
        <button class="debug-btn" onclick="debugForcePhase('tool_select')" style="flex:1;">强制进入工具选择</button>
      </div>
    </div>

    <!-- ===== 导出状态（RL调试） ===== -->
    <div class="debug-section">
      <div class="debug-section-title">📊 RL调试</div>
      <div class="debug-row">
        <button class="debug-btn success" onclick="debugExportState()" style="flex:1;">导出当前状态(JSON)</button>
      </div>
      <div class="debug-row">
        <button class="debug-btn" onclick="debugLogActionMask()" style="flex:1;">输出动作掩码</button>
      </div>
    </div>
  `;
}

/**
 * 渲染培养皿编辑卡片
 */
function renderDebugDishes(state) {
  let html = '';
  for (let i = 0; i < DISH_COUNT; i++) {
    const dish = state.dishes[i];
    const m = dish.monster;

    html += `<div class="debug-dish-card">`;
    html += `<div class="debug-dish-header">#${i + 1}号培养皿 ${m ? `- ${m.displayName}` : '- 空'}</div>`;

    if (m) {
      html += `
        <div class="debug-row">
          <span class="debug-label">种群:</span>
          <select class="debug-select" id="debug-dish-${i}-species">
            ${SPECIES_LIST.map(s => `<option value="${s}" ${s === m.species ? 'selected' : ''}>${SPECIES_NAMES[s]}</option>`).join('')}
          </select>
        </div>
        <div class="debug-row">
          <span class="debug-label">稀有度:</span>
          <select class="debug-select" id="debug-dish-${i}-rarity">
            ${RARITY_ORDER.map(r => `<option value="${r}" ${r === m.rarity ? 'selected' : ''}>${RARITY_NAMES[r]}</option>`).join('')}
          </select>
        </div>
        <div class="debug-row">
          <span class="debug-label">活性:</span>
          <input type="number" class="debug-input" id="debug-dish-${i}-activity" value="${m.activity}" style="width:80px">
        </div>
        <div class="debug-row">
          <span class="debug-label">数量:</span>
          <input type="number" class="debug-input" id="debug-dish-${i}-quantity" value="${m.quantity}" style="width:80px">
        </div>
        <div class="debug-row">
          <button class="debug-btn success" onclick="debugUpdateDish(${i})">应用修改</button>
          <button class="debug-btn" onclick="debugDeleteDish(${i})">删除怪物</button>
        </div>
      `;
    } else {
      html += `
        <div class="debug-row">
          <span class="debug-label">种群:</span>
          <select class="debug-select" id="debug-dish-${i}-species">
            ${SPECIES_LIST.map(s => `<option value="${s}">${SPECIES_NAMES[s]}</option>`).join('')}
          </select>
        </div>
        <div class="debug-row">
          <span class="debug-label">稀有度:</span>
          <select class="debug-select" id="debug-dish-${i}-rarity">
            ${RARITY_ORDER.map(r => `<option value="${r}">${RARITY_NAMES[r]}</option>`).join('')}
          </select>
        </div>
        <div class="debug-row">
          <span class="debug-label">活性:</span>
          <input type="number" class="debug-input" id="debug-dish-${i}-activity" value="1" style="width:80px">
        </div>
        <div class="debug-row">
          <span class="debug-label">数量:</span>
          <input type="number" class="debug-input" id="debug-dish-${i}-quantity" value="36" style="width:80px">
        </div>
        <div class="debug-row">
          <button class="debug-btn success" onclick="debugUpdateDish(${i})">添加怪物</button>
        </div>
      `;
    }

    html += `</div>`;
  }
  return html;
}

// =====================================================================
// ===== Debug操作函数 =====
// =====================================================================

/**
 * 设置回合数
 */
function debugSetRound() {
  const round = parseInt(document.getElementById('debug-round').value);
  engine.debugSetRound(round);
  renderDebugPanel();
  renderState(engine.getState());
}

/**
 * 设置药剂刷新次数
 */
function debugSetPotionRefresh() {
  const count = parseInt(document.getElementById('debug-potion-refresh').value);
  engine.potionRefreshesLeft = Math.max(0, count);
  renderState(engine.getState());
  renderDebugPanel();
}

/**
 * 设置工具刷新次数
 */
function debugSetToolRefresh() {
  const count = parseInt(document.getElementById('debug-tool-refresh').value);
  engine.toolRefreshesLeft = Math.max(0, count);
  renderState(engine.getState());
  renderDebugPanel();
}

/**
 * 重新开始游戏（指定工具刷新次数）
 */
function debugRestart(toolRefreshes) {
  document.getElementById('game-over-overlay').classList.remove('visible');
  document.getElementById('log-panel').innerHTML = '';
  initGame({ toolRefreshes, potionRefreshes: 3 });
  renderDebugPanel();
}

/**
 * 更新/添加培养皿中的怪物
 */
function debugUpdateDish(dishIndex) {
  const species = document.getElementById(`debug-dish-${dishIndex}-species`).value;
  const rarity = document.getElementById(`debug-dish-${dishIndex}-rarity`).value;
  const activity = parseInt(document.getElementById(`debug-dish-${dishIndex}-activity`).value) || 0;
  const quantity = parseInt(document.getElementById(`debug-dish-${dishIndex}-quantity`).value) || 0;

  engine.debugAddMonsterAt(dishIndex, species, rarity, activity, quantity);
  renderDebugPanel();
  renderState(engine.getState());
}

/**
 * 删除培养皿中的怪物
 */
function debugDeleteDish(dishIndex) {
  engine.debugRemoveMonsterAt(dishIndex);
  renderDebugPanel();
  renderState(engine.getState());
}

/**
 * 添加新怪物到第一个空位
 */
function debugAddNewMonster() {
  const emptyDishes = engine._getEmptyDishIndices();
  if (emptyDishes.length === 0) {
    alert('没有空的培养皿！');
    return;
  }
  const idx = emptyDishes[0];
  engine.debugAddMonsterAt(idx, SPECIES.YIMO, RARITY.COMMON, 1, 36);
  renderDebugPanel();
  renderState(engine.getState());
}

/**
 * 装备手术用具
 */
function debugAddTool() {
  const toolId = parseInt(document.getElementById('debug-add-tool').value);
  engine.debugAddTool(toolId);
  renderDebugPanel();
  renderState(engine.getState());
}

/**
 * 卸下手术用具
 */
function debugRemoveTool() {
  const toolId = parseInt(document.getElementById('debug-remove-tool').value);
  engine.debugRemoveTool(toolId);
  renderDebugPanel();
  renderState(engine.getState());
}

/**
 * 替换当前药剂卡
 */
function debugSetPotionCard() {
  const potionId = parseInt(document.getElementById('debug-set-potion').value);
  const slot = parseInt(document.getElementById('debug-set-potion-slot').value);
  const potion = POTIONS.find(p => p.id === potionId);
  if (!potion) return;

  // 确保cards数组足够大
  while (engine.currentCards.length <= slot) {
    engine.currentCards.push({ ...POTIONS[0] });
  }
  engine.currentCards[slot] = { ...potion };
  renderState(engine.getState());
  renderDebugPanel();
}

/**
 * 强制切换游戏阶段
 */
function debugForcePhase(phase) {
  engine.debugSetPhase(phase);
  if (phase === 'potion_select') {
    engine._drawPotions(3, false);
  } else if (phase === 'tool_select') {
    engine._drawTools('basic');
  }
  renderState(engine.getState());
  renderDebugPanel();
}

/**
 * 导出当前状态为JSON（供RL调试使用）
 */
function debugExportState() {
  const state = engine.getState();
  const json = JSON.stringify(state, null, 2);
  console.log('===== Game State Export =====');
  console.log(json);

  // 复制到剪贴板
  navigator.clipboard.writeText(json).then(() => {
    alert('状态已复制到剪贴板并输出到控制台！');
  }).catch(() => {
    // 降级方案：创建下载
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `game_state_round${state.currentRound}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

/**
 * 输出当前动作掩码（供RL调试使用）
 */
function debugLogActionMask() {
  const mask = engine.getValidActions();
  const actionNames = [
    'SELECT_0', 'SELECT_1', 'SELECT_2', 'SELECT_3', 'SELECT_4',
    'TARGET_0', 'TARGET_1', 'TARGET_2', 'TARGET_3', 'TARGET_4', 'TARGET_5',
    'REFRESH', 'CONFIRM'
  ];

  console.log('===== Action Mask =====');
  console.log('Phase:', engine.phase);
  mask.forEach((valid, i) => {
    if (valid) console.log(`  ✓ ${actionNames[i]} (${i})`);
  });
  console.log('Valid actions:', mask.map((v, i) => v ? i : null).filter(v => v !== null));

  alert('动作掩码已输出到浏览器控制台 (F12)');
}
