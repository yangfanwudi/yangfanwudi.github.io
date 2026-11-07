/* ui.js — 渲染与交互：头部玩家卡、Boss 横幅、三栏看板（拖拽）、统计图表、成就/装备、模态框、Toast
 * 依赖：MB.game（规则）、MB.state（数据）。事件绑定分两类：
 *  - bindOnce()：绑定在常驻节点（board 容器、模态框、页脚），init 时调用一次
 *  - renderXxx()：每次重绘动态节点后调用 bindCardDnd()（卡片每次重建）
 */
(function () {
  'use strict';
  window.MB = window.MB || {}; // 全局命名空间守卫
  const U = {};
  MB.ui = U;

  const $ = function (sel) { return document.querySelector(sel); };
  const $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.renderAll = function () {
    renderHeader();
    renderBoss();
    renderBoard();
    renderStats();
  };

  /* ---------- 头部玩家卡 ---------- */
  function renderHeader() {
    const s = MB.state.state, g = MB.game;
    const lv = g.levelFromXp(s.player.xp);
    const floor = g.xpFloor(lv), ceil = g.xpCeil(lv);
    const pct = Math.min(100, Math.round((s.player.xp - floor) / Math.max(1, ceil - floor) * 100));
    $('#lvBadge').textContent = 'Lv ' + lv;
    $('#playerTitle').textContent = g.titleFor(lv);
    $('#streakTag').textContent = '🔥 连续 ' + g.effectiveStreak(s) + ' 天 · 最佳 ' + (s.player.streak.best || 0) + ' 天';
    $('#xpFill').style.width = pct + '%';
    $('#xpText').textContent = s.player.xp + ' / ' + ceil + ' XP';
  }

  /* ---------- Boss 横幅 ---------- */
  function renderBoss() {
    const s = MB.state.state, g = MB.game;
    const b = s.boss;
    const aliveWeek = b.weeklyKey === g.isoWeekKey();
    const defeated = !!b.defeatedAt && aliveWeek;
    const dmg = Math.max(0, Math.min(b.maxHp, b.maxHp - b.hp));
    const pct = Math.max(0, Math.min(100, Math.round(b.hp / Math.max(1, b.maxHp) * 100)));
    const el = $('#bossBanner');
    el.classList.toggle('boss-defeated', defeated);
    el.innerHTML =
      '<img class="boss-img" src="assets/icons/boss.png" alt="Boss">' +
      '<div class="boss-info">' +
        '<div class="boss-top"><h2>👑 本周 Boss：' + U.esc(b.title) + '</h2>' +
        '<span class="boss-week">' + U.esc(b.weeklyKey) + '</span></div>' +
        '<div class="boss-desc">' + (defeated
          ? '🏅 已被勇者击败！下周将刷新新的 Boss。'
          : '每击败一只任务怪物，就对 Boss 造成等量经验值的伤害。') + '</div>' +
        '<div class="hpbar"><div class="hpbar-fill' + (pct <= 25 && !defeated ? ' hp-low' : '') + '" style="width:' + (defeated ? 0 : pct) + '%"></div>' +
        '<span class="hpbar-text">' + (defeated ? '已被击败 🎉' : b.hp + ' / ' + b.maxHp + ' HP · 已造成 ' + dmg + ' 伤害') + '</span></div>' +
      '</div>' +
      '<div class="boss-actions"><button class="btn ghost" id="bossEditBtn">编辑 Boss</button></div>';
    $('#bossEditBtn').addEventListener('click', openBossModal);
  }

  /* ---------- 三栏看板 ---------- */
  const COLS = [
    { status: 'todo', title: '🐺 待讨怪物', empty: '今日领地很平静…点击下方按钮召唤任务。', addBtn: true },
    { status: 'doing', title: '⚔️ 战斗中', empty: '没有战斗中的怪物。去「待讨怪物」里开战吧！' },
    { status: 'done', title: '✨ 已击败', empty: '今天还没有战果，击败一只试试！' }
  ];

  function renderBoard() {
    const s = MB.state.state;
    const board = $('#board');
    board.innerHTML = COLS.map(function (col) {
      const list = s.tasks.filter(function (t) { return t.status === col.status; })
        .sort(function (a, b) { return (b.doneAt || b.createdAt) - (a.doneAt || a.createdAt); });
      const cards = list.map(cardHtml).join('');
      const emptyHtml = list.length ? '' :
        '<div class="empty"><img src="assets/icons/empty-state.png" alt=""><p>' + col.empty + '</p></div>';
      return '<section class="col" data-status="' + col.status + '">' +
        '<header class="col-head"><h2>' + col.title + '</h2><span class="col-count">' + list.length + '</span></header>' +
        '<div class="cards">' + cards + emptyHtml + '</div>' +
        (col.addBtn ? '<button class="btn add-btn" id="addTaskBtn">＋ 讨伐新任务</button>' : '') +
        '</section>';
    }).join('');
    bindCardDnd();
  }

  function cardHtml(t) {
    const g = MB.game;
    const d = g.DIFF[t.difficulty] || g.DIFF.normal;
    const c = g.CATS[t.category] || g.CATS.focus;
    let actions = '';
    if (t.status === 'todo') {
      actions = '<button class="btn small primary" data-act="doing" title="进入战斗">▶ 开战</button>';
    } else if (t.status === 'doing') {
      actions = '<button class="btn small danger" data-act="done" title="击败并获得经验">⚔ 击败</button>' +
        '<button class="btn small ghost" data-act="todo" title="退回待讨">↩</button>';
    } else {
      actions = '<button class="btn small ghost" data-act="todo" title="撤销击败并退还经验">↩ 撤销</button>';
    }
    const doneTime = (t.status === 'done' && t.doneAt)
      ? '<span class="tag done-at">' + new Date(t.doneAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' 击败</span>'
      : '';
    return '<article class="card diff-' + U.esc(t.difficulty) + '" draggable="true" data-id="' + U.esc(t.id) + '">' +
      '<img class="card-monster" src="' + d.icon + '" alt="">' +
      '<div class="card-body">' +
        '<div class="card-title">' + U.esc(t.title) + '</div>' +
        (t.note ? '<div class="card-note">' + U.esc(t.note) + '</div>' : '') +
        '<div class="card-tags">' +
          '<span class="tag ' + d.cls + '">' + d.name + ' +' + d.xp + 'XP</span>' +
          '<span class="tag cat">' + c.emoji + ' ' + c.name + '</span>' +
          (t.repeat === 'daily' ? '<span class="tag daily">🔁 每日</span>' : '') +
          doneTime +
        '</div>' +
      '</div>' +
      '<div class="card-actions">' + actions +
        '<button class="btn small ghost icon" data-act="edit" title="编辑">✎</button>' +
        '<button class="btn small ghost icon" data-act="del" title="删除">🗑</button>' +
      '</div>' +
    '</article>';
  }

  /* 卡片每次重建，需重新绑定 dragstart */
  function bindCardDnd() {
    $$('#board .card').forEach(function (card) {
      card.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', card.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
    });
  }

  /* ---------- 统计区 ---------- */
  function renderStats() {
    renderTotals();
    renderBarChart();
    renderRadar();
    renderEquip();
    renderQuick();
    renderAchv();
  }

  /* 战绩速览小卡 */
  function renderQuick() {
    const g = MB.game, s = MB.state.state;
    const today = s.history[g.todayStr()] || { kills: 0, xp: 0 };
    const wk = g.isoWeekKey();
    const weekDamage = s.boss.weeklyKey === wk
      ? Math.max(0, Math.min(s.boss.maxHp, s.boss.maxHp - s.boss.hp)) : 0;
    const lv = g.levelFromXp(s.player.xp);
    const items = [
      { emoji: '📆', label: '今日战果', value: today.kills + ' 杀 · ' + today.xp + ' XP' },
      { emoji: '🔥', label: '最高连击', value: (s.player.streak.best || 0) + ' 天' },
      { emoji: '🏰', label: '本周 Boss 伤害', value: weekDamage + ' / ' + s.boss.maxHp },
      { emoji: '⭐', label: '当前等级', value: 'Lv ' + lv + ' · ' + g.titleFor(lv) }
    ];
    $('#quickStats').innerHTML = items.map(function (it) {
      return '<div class="quick-item"><div class="quick-label">' + it.emoji + ' ' + it.label +
        '</div><div class="quick-value">' + U.esc(it.value) + '</div></div>';
    }).join('');
  }

  function renderTotals() {
    const s = MB.state.state, g = MB.game;
    const unlocked = g.ACHIEVEMENTS.filter(function (a) { return s.achievements[a.id]; }).length;
    $('#totalsRow').textContent =
      '⚔️ 总击杀 ' + s.player.totalKills +
      ' · ⭐ 总经验 ' + s.player.xp +
      ' · 🔥 连续 ' + g.effectiveStreak(s) + ' 天' +
      ' · 🏅 成就 ' + unlocked + '/' + g.ACHIEVEMENTS.length;
  }

  /* 近7日击杀柱状图（手写 SVG，无依赖） */
  function renderBarChart() {
    const g = MB.game, s = MB.state.state;
    const labels = ['日', '一', '二', '三', '四', '五', '六'];
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push(d);
    }
    const data = days.map(function (d) {
      const key = g.todayStr(d);
      const h = s.history[key] || { kills: 0, xp: 0 };
      return { label: labels[d.getDay()], kills: h.kills, xp: h.xp, today: key === g.todayStr() };
    });
    const max = Math.max(4, Math.max.apply(null, data.map(function (x) { return x.kills; })));
    const W = 320, H = 150, padL = 14, padR = 14, bw = 26, baseY = H - 22;
    const gap = (W - padL - padR - bw * 7) / 6;
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="近7日击杀柱状图">';
    svg += '<line x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY + '" stroke="#e5e7eb" stroke-width="1"/>';
    data.forEach(function (x, i) {
      const bh = Math.round(x.kills / max * (baseY - 24));
      const x0 = padL + i * (bw + gap);
      svg += '<rect x="' + x0 + '" y="' + (baseY - Math.max(bh, 2)) + '" width="' + bw + '" height="' + Math.max(bh, 2) + '" rx="4" fill="' + (x.today ? '#4f46e5' : '#a5b4fc') + '">' +
        '<title>' + x.label + '：' + x.kills + ' 杀 · ' + x.xp + ' XP</title></rect>';
      if (x.kills > 0) {
        svg += '<text x="' + (x0 + bw / 2) + '" y="' + (baseY - bh - 6) + '" font-size="10" text-anchor="middle" fill="#4f46e5">' + x.kills + '</text>';
      }
      svg += '<text x="' + (x0 + bw / 2) + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="' + (x.today ? '#4f46e5' : '#9ca3af') + '">' + (x.today ? '今' : x.label) + '</text>';
    });
    svg += '</svg>';
    $('#barChart').innerHTML = svg;
    $('#chartTotal').textContent = '近7日合计 ' + data.reduce(function (a, b) { return a + b.kills; }, 0) +
      ' 杀 · ' + data.reduce(function (a, b) { return a + b.xp; }, 0) + ' XP';
  }

  /* 四维属性雷达图（菱形，手写 SVG） */
  function renderRadar() {
    const g = MB.game, s = MB.state.state;
    const keys = g.CAT_KEYS;
    const vals = keys.map(function (k) { return s.player.attrs[k] || 0; });
    const maxA = Math.max(20, Math.max.apply(null, vals));
    const cx = 85, cy = 82, R = 54;
    const pt = function (i, r) {
      const ang = -Math.PI / 2 + i * Math.PI / 2;
      return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    };
    let svg = '<svg viewBox="0 0 170 170" role="img" aria-label="四维属性雷达图">';
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      const ps = keys.map(function (_, i) { return pt(i, R * f); })
        .map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
      svg += '<polygon points="' + ps + '" fill="none" stroke="#e5e7eb" stroke-width="1"/>';
    });
    keys.forEach(function (_, i) {
      const p = pt(i, R);
      svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="#e5e7eb" stroke-width="1"/>';
    });
    const vp = keys.map(function (_, i) {
      const p = pt(i, R * vals[i] / maxA);
      return p[0].toFixed(1) + ',' + p[1].toFixed(1);
    }).join(' ');
    svg += '<polygon points="' + vp + '" fill="rgba(79,70,229,.22)" stroke="#4f46e5" stroke-width="2" stroke-linejoin="round"/>';
    keys.forEach(function (k, i) {
      const p = pt(i, R + 16);
      svg += '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 4).toFixed(1) + '" font-size="11" text-anchor="middle" fill="#4b5563">' +
        g.CATS[k].emoji + ' ' + vals[i] + '</text>';
    });
    svg += '</svg>';
    $('#radar').innerHTML = svg;
  }

  function renderEquip() {
    const g = MB.game, s = MB.state.state;
    const lv = g.levelFromXp(s.player.xp);
    $('#equipGrid').innerHTML = g.EQUIPMENT.map(function (eq) {
      const unlocked = lv >= eq.lv;
      return '<div class="equip ' + (unlocked ? 'unlocked' : 'locked') + '">' +
        '<div class="equip-emoji">' + (unlocked ? eq.emoji : '🔒') + '</div>' +
        '<div class="equip-name">' + eq.name + '</div>' +
        '<div class="equip-lv">' + (unlocked ? '已装备' : 'Lv ' + eq.lv + ' 解锁') + '</div>' +
      '</div>';
    }).join('');
  }

  function renderAchv() {
    const g = MB.game, s = MB.state.state;
    $('#achvGrid').innerHTML = g.ACHIEVEMENTS.map(function (a) {
      const ts = s.achievements[a.id];
      return '<div class="achv ' + (ts ? 'unlocked' : 'locked') + '" title="' + U.esc(a.desc) + '">' +
        '<div class="achv-emoji">' + (ts ? a.emoji : '🔒') + '</div>' +
        '<div class="achv-name">' + a.name + '</div>' +
        '<div class="achv-desc">' + U.esc(a.desc) + '</div>' +
      '</div>';
    }).join('');
  }

  /* ---------- 模态框 ---------- */
  function openTaskModal(id) {
    const form = $('#taskForm');
    form.reset();
    $('#taskId').value = id || '';
    if (id) {
      const t = MB.state.state.tasks.find(function (x) { return x.id === id; });
      if (!t) return;
      $('#taskTitle').value = t.title;
      $('#taskNote').value = t.note || '';
      form.querySelector('input[name="difficulty"][value="' + t.difficulty + '"]').checked = true;
      form.querySelector('input[name="category"][value="' + t.category + '"]').checked = true;
      form.querySelector('input[name="repeat"][value="' + t.repeat + '"]').checked = true;
      $('#taskModalTitle').textContent = '编辑任务';
    } else {
      $('#taskModalTitle').textContent = '讨伐新任务';
      form.querySelector('input[name="difficulty"][value="normal"]').checked = true;
      form.querySelector('input[name="category"][value="focus"]').checked = true;
      form.querySelector('input[name="repeat"][value="once"]').checked = true;
    }
    $('#taskModal').hidden = false;
    setTimeout(function () { $('#taskTitle').focus(); }, 60);
  }

  function openBossModal() {
    const b = MB.state.state.boss;
    $('#bossTitle').value = b.title;
    $('#bossHp').value = b.maxHp;
    $('#bossModal').hidden = false;
  }

  U.closeModals = function () {
    $('#taskModal').hidden = true;
    $('#bossModal').hidden = true;
  };

  /* ---------- Toast ---------- */
  U.toast = function (icon, title, desc, type) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = '<div class="toast-icon">' + icon + '</div>' +
      '<div class="toast-text"><div class="toast-title">' + U.esc(title) + '</div>' +
      (desc ? '<div class="toast-desc">' + U.esc(desc) + '</div>' : '') + '</div>';
    box.appendChild(el);
    while (box.children.length > 5) box.removeChild(box.firstChild);
    setTimeout(function () { el.classList.add('out'); }, 3300);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3850);
  };

  /* ---------- 一次性事件绑定 ---------- */
  U.bindOnce = function () {
    // 看板：点击（事件委托）+ 拖放
    const board = $('#board');
    board.addEventListener('click', onBoardClick);
    board.addEventListener('dragover', function (e) {
      const col = e.target.closest('.col');
      if (col) { e.preventDefault(); col.classList.add('drag-over'); }
    });
    board.addEventListener('dragleave', function (e) {
      const col = e.target.closest('.col');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    board.addEventListener('drop', function (e) {
      const col = e.target.closest('.col');
      if (!col) return;
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      if (id) MB.app.changeStatus(id, col.dataset.status);
    });

    // 任务表单
    $('#taskForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const f = e.target;
      const title = $('#taskTitle').value.trim();
      if (!title) { $('#taskTitle').focus(); return; }
      const data = {
        title: title,
        note: $('#taskNote').value.trim(),
        difficulty: f.querySelector('input[name="difficulty"]:checked').value,
        category: f.querySelector('input[name="category"]:checked').value,
        repeat: f.querySelector('input[name="repeat"]:checked').value
      };
      const id = $('#taskId').value;
      if (id) { MB.state.updateTask(id, data); } else { MB.state.addTask(data); }
      U.closeModals();
      MB.ui.renderAll();
    });

    // Boss 表单
    $('#bossForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const title = $('#bossTitle').value.trim() || '无名怪物';
      const maxHp = Math.min(2000, Math.max(30, parseInt($('#bossHp').value, 10) || 300));
      const b = MB.state.state.boss;
      const damage = Math.max(0, b.maxHp - b.hp); // 保留本周已造成伤害
      MB.state.updateBoss({ title: title, maxHp: maxHp, hp: Math.max(0, maxHp - damage) });
      U.closeModals();
      MB.ui.renderAll();
    });

    // 关闭模态框：背景点击 / 取消按钮 / Esc
    $$('.modal-backdrop').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) U.closeModals(); });
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) U.closeModals();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') U.closeModals();
    });

    // 页脚：导出 / 导入 / 重置
    $('#exportBtn').addEventListener('click', function () {
      const blob = new Blob([MB.state.export()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'monster-board-backup-' + MB.game.todayStr() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
    });
    $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          MB.state.import(String(reader.result));
          MB.ui.renderAll();
          U.toast('📥', '导入成功', '存档已恢复');
        } catch (err) {
          alert('导入失败：' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    $('#resetBtn').addEventListener('click', function () {
      if (confirm('确定重置全部存档？所有任务、经验与成就将清空。')) {
        if (confirm('再次确认：真的要清空吗？此操作不可恢复。')) {
          MB.state.reset();
          MB.ui.renderAll();
          U.toast('🧹', '存档已重置', '新的冒险开始了');
        }
      }
    });
  };

  function onBoardClick(e) {
    if (e.target.closest('#addTaskBtn')) { openTaskModal(); return; }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.card');
    const id = card && card.dataset.id;
    if (!id) return;
    const act = btn.dataset.act;
    if (act === 'edit') { openTaskModal(id); return; }
    if (act === 'del') {
      if (confirm('确定删除该任务？删除后无法恢复。')) MB.app.deleteTask(id);
      return;
    }
    MB.app.changeStatus(id, act);
  }
})();
