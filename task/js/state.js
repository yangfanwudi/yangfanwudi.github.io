/* state.js — 数据模型、localStorage 持久化、每日/每周重置、任务与击杀操作
 * 存储键：monsterBoard.v1
 * 事件：on/emit（'kill' 事件由 app.js 订阅用于弹 Toast）
 */
(function () {
  'use strict';
  window.MB = window.MB || {}; // 全局命名空间守卫
  const S = {};
  const KEY = 'monsterBoard.v1';
  const BOSS_BONUS_XP = 200; // 击败本周 Boss 的额外奖励

  /* 玩家当前等级 */
  const levelOf = function () { return MB.game.levelFromXp(S.state.player.xp); };

  function defaults() {
    return {
      version: 1,
      lastLoadDate: MB.game.todayStr(),
      player: {
        xp: 0,
        totalKills: 0,
        attrs: { focus: 0, body: 0, study: 0, create: 0 },
        streak: { current: 0, best: 0, lastKillDate: null }
      },
      tasks: [],
      boss: {
        title: '深渊领主',
        maxHp: 300,
        hp: 300,
        weeklyKey: MB.game.isoWeekKey(),
        defeatedAt: null
      },
      achievements: {},
      history: {} // 'YYYY-MM-DD' → { kills, xp }
    };
  }

  /* 简易发布订阅 */
  const listeners = {};
  S.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  S.emit = function (ev, data) { (listeners[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); };

  S.load = function () {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { s = null; }
    if (!s || s.version !== 1 || !s.player) s = defaults();
    // 缺失字段向前兼容
    const d = defaults();
    Object.keys(d).forEach(function (k) { if (s[k] === undefined) s[k] = d[k]; });
    Object.keys(d.player).forEach(function (k) { if (s.player[k] === undefined) s.player[k] = d.player[k]; });
    if (!s.player.attrs) s.player.attrs = d.player.attrs;
    MB.game.CAT_KEYS.forEach(function (k) { if (s.player.attrs[k] === undefined) s.player.attrs[k] = 0; });
    S.state = s;
    rollover();
    return S.state;
  };

  /* 每次打开页面时执行：跨天时重置每日任务 + Boss 每周重置 */
  function rollover() {
    const s = S.state;
    const today = MB.game.todayStr();
    if (s.lastLoadDate !== today) {
      // 仅在真正跨天时重置每日循环任务，同一天内多次刷新不受影响
      s.tasks.forEach(function (t) {
        if (t.repeat === 'daily' && t.status === 'done') { t.status = 'todo'; t.doneAt = null; }
      });
    }
    const wk = MB.game.isoWeekKey();
    if (s.boss.weeklyKey !== wk) {
      s.boss.weeklyKey = wk;
      s.boss.hp = s.boss.maxHp;
      s.boss.defeatedAt = null;
    }
    s.lastLoadDate = today;
    S.save();
  }

  S.save = function () {
    try { localStorage.setItem(KEY, JSON.stringify(S.state)); }
    catch (e) { console.error('save failed', e); }
  };

  /* ---------- 任务操作 ---------- */
  S.addTask = function (data) {
    const t = {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: data.title,
      note: data.note || '',
      difficulty: data.difficulty,
      category: data.category,
      status: 'todo',
      repeat: data.repeat === 'daily' ? 'daily' : 'once',
      createdAt: Date.now(),
      doneAt: null
    };
    S.state.tasks.unshift(t);
    S.save();
    return t;
  };

  S.updateTask = function (id, patch) {
    const t = S.state.tasks.find(function (x) { return x.id === id; });
    if (t) Object.assign(t, patch);
    S.save();
    return t;
  };

  S.deleteTask = function (id) {
    S.state.tasks = S.state.tasks.filter(function (x) { return x.id !== id; });
    S.save();
  };

  /* 状态流转：todo ↔ doing ↔ done。进入 done 记一次击杀；退出 done 回滚 */
  S.setStatus = function (id, status) {
    const t = S.state.tasks.find(function (x) { return x.id === id; });
    if (!t) return null;
    if (status === 'done' && t.status !== 'done') {
      t.status = 'done';
      t.doneAt = Date.now();
      recordKill(t);
    } else if (t.status === 'done' && status !== 'done') {
      revertKill(t);
      t.status = status;
      t.doneAt = null;
    } else {
      t.status = status;
    }
    S.save();
    return t;
  };

  /* ---------- 击杀结算 ---------- */
  function recordKill(t) {
    const s = S.state, g = MB.game;
    const xp = g.DIFF[t.difficulty] ? g.DIFF[t.difficulty].xp : 10;
    const today = g.todayStr();
    const lvBefore = levelOf();

    s.player.xp += xp;
    s.player.totalKills += 1;
    s.player.attrs[t.category] = (s.player.attrs[t.category] || 0) + 1;
    recomputeStreak();

    const h = s.history[today] || (s.history[today] = { kills: 0, xp: 0 });
    h.kills += 1;
    h.xp += xp;

    // Boss 承受等量经验伤害（仅本周且未被击败时）
    const b = s.boss;
    const wasDefeated = !!b.defeatedAt;
    let bossDefeated = false;
    if (b.weeklyKey === g.isoWeekKey() && !b.defeatedAt) {
      b.hp = Math.max(0, b.hp - xp);
      if (b.hp === 0) {
        b.defeatedAt = Date.now();
        bossDefeated = true;
      }
    }
    if (bossDefeated) {
      s.player.xp += BOSS_BONUS_XP;
      h.xp += BOSS_BONUS_XP;
    }
    recomputeStreak();

    const lvAfter = levelOf();
    const newAch = g.checkAchievements(s, { epicKill: t.difficulty === 'epic', bossKill: bossDefeated });
    S.emit('kill', {
      task: t,
      xp: xp,
      level: { from: lvBefore, to: lvAfter },
      levelUp: lvAfter > lvBefore,
      bossDefeated: bossDefeated,
      newAch: newAch
    });
  }

  /* 撤销击败：退还经验/属性/历史，Boss 回血（若 Boss 已被击败则不回血） */
  function revertKill(t) {
    const s = S.state, g = MB.game;
    const xp = g.DIFF[t.difficulty] ? g.DIFF[t.difficulty].xp : 10;
    const today = g.todayStr();

    s.player.xp = Math.max(0, s.player.xp - xp);
    s.player.totalKills = Math.max(0, s.player.totalKills - 1);
    s.player.attrs[t.category] = Math.max(0, (s.player.attrs[t.category] || 0) - 1);

    const h = s.history[today];
    if (h) {
      h.kills = Math.max(0, h.kills - 1);
      h.xp = Math.max(0, h.xp - xp);
    }

    const b = s.boss;
    if (b.weeklyKey === g.isoWeekKey() && !b.defeatedAt) {
      b.hp = Math.min(b.maxHp, b.hp + xp);
    }
    recomputeStreak();
  }

  /* 从 history 重算连击，保证任何增删后数值一致 */
  function recomputeStreak() {
    const s = S.state, g = MB.game;
    const d = new Date();
    let cur = 0, last = null;
    // 今天还没有击杀时，从昨天起算（连击延续）
    const hToday = s.history[g.todayStr()];
    if (!(hToday && hToday.kills > 0)) d.setDate(d.getDate() - 1);
    for (let i = 0; i < 400; i++) {
      const h = s.history[g.todayStr(d)];
      if (h && h.kills > 0) {
        cur += 1;
        last = g.todayStr(d);
        d.setDate(d.getDate() - 1);
      } else break;
    }
    s.player.streak.current = cur;
    s.player.streak.best = Math.max(s.player.streak.best || 0, cur);
    s.player.streak.lastKillDate = last;
  }

  /* ---------- Boss ---------- */
  S.updateBoss = function (patch) {
    Object.assign(S.state.boss, patch);
    S.save();
  };

  /* ---------- 存档导入导出/重置 ---------- */
  S.export = function () { return JSON.stringify(S.state, null, 2); };

  S.import = function (json) {
    const s = JSON.parse(json); // 可能抛异常
    if (!s || s.version !== 1 || !s.player || !Array.isArray(s.tasks)) {
      throw new Error('不是有效的打怪升级存档文件');
    }
    S.state = s;
    S.save();
    rollover();
    return S.state;
  };

  S.reset = function () {
    localStorage.removeItem(KEY);
    S.state = defaults();
    S.save();
    return S.state;
  };

  MB.state = S;
})();
