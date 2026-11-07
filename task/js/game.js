/* game.js — 游戏化规则（纯函数与常量，无 DOM、无存储）
 * 内容：难度/类别/重复规则、等级与称号公式、装备、成就、日期工具
 */
(function () {
  'use strict';
  window.MB = window.MB || {}; // 全局命名空间守卫（首个加载的脚本负责创建）
  const G = {};

  /* 难度 → 怪物形象与经验值 */
  G.DIFF = {
    easy:   { name: '简单', xp: 10, icon: 'assets/icons/monster-easy.png',   cls: 'diff-easy' },
    normal: { name: '普通', xp: 20, icon: 'assets/icons/monster-normal.png', cls: 'diff-normal' },
    hard:   { name: '困难', xp: 40, icon: 'assets/icons/monster-hard.png',   cls: 'diff-hard' },
    epic:   { name: '史诗', xp: 80, icon: 'assets/icons/monster-epic.png',   cls: 'diff-epic' }
  };

  /* 任务类别 → 四维属性 */
  G.CATS = {
    focus:  { name: '专注', emoji: '🎯' },
    body:   { name: '体魄', emoji: '💪' },
    study:  { name: '学识', emoji: '📚' },
    create: { name: '创造', emoji: '✨' }
  };
  G.CAT_KEYS = ['focus', 'body', 'study', 'create'];

  G.REPEAT = { once: '仅一次', daily: '每日循环' };

  /* 等级公式：到达 n 级累计需 50*(n-1)*n 经验（L2=100, L3=300, L4=600 …） */
  G.levelFromXp = function (xp) {
    let lv = 1;
    while (xp >= 50 * lv * (lv + 1) && lv < 99) lv++;
    return lv;
  };
  G.xpFloor = function (lv) { return 50 * (lv - 1) * lv; }; // 当前级起点
  G.xpCeil = function (lv) { return 50 * lv * (lv + 1); };  // 下一级门槛

  G.TITLES = [
    { min: 1, name: '见习勇者' },
    { min: 2, name: '青铜讨伐者' },
    { min: 4, name: '白银猎人' },
    { min: 6, name: '黄金骑士' },
    { min: 8, name: '秘银英雄' },
    { min: 10, name: '传说勇者' }
  ];
  G.titleFor = function (lv) {
    let t = G.TITLES[0].name;
    G.TITLES.forEach(function (x) { if (lv >= x.min) t = x.name; });
    return t;
  };

  /* 装备：达到等级自动解锁（可视化里程碑） */
  G.EQUIPMENT = [
    { lv: 1, emoji: '🗡️', name: '新手木剑' },
    { lv: 3, emoji: '🛡️', name: '铁木盾' },
    { lv: 5, emoji: '🥋', name: '秘银轻甲' },
    { lv: 7, emoji: '👟', name: '疾风之靴' },
    { lv: 9, emoji: '👑', name: '勇者王冠' }
  ];

  /* 成就徽章：cond(state, ctx)，ctx 为本次击杀上下文（epicKill 等） */
  G.ACHIEVEMENTS = [
    { id: 'first-kill', emoji: '⚔️', name: '首战告捷', desc: '首次击败一只怪物', cond: function (s) { return s.player.totalKills >= 1; } },
    { id: 'kills-50', emoji: '🎖️', name: '百战老兵', desc: '累计击败 50 只怪物', cond: function (s) { return s.player.totalKills >= 50; } },
    { id: 'kills-200', emoji: '🏅', name: '千锤百炼', desc: '累计击败 200 只怪物', cond: function (s) { return s.player.totalKills >= 200; } },
    { id: 'streak-3', emoji: '🔥', name: '三连击', desc: '连续 3 天有击杀', cond: function (s) { return G.effectiveStreak(s) >= 3; } },
    { id: 'streak-7', emoji: '🌟', name: '周而复始', desc: '连续 7 天有击杀', cond: function (s) { return G.effectiveStreak(s) >= 7; } },
    { id: 'streak-30', emoji: '💎', name: '钢铁意志', desc: '连续 30 天有击杀', cond: function (s) { return G.effectiveStreak(s) >= 30; } },
    { id: 'level-5', emoji: '🚀', name: '崭露头角', desc: '达到 5 级', cond: function (s) { return G.levelFromXp(s.player.xp) >= 5; } },
    { id: 'level-10', emoji: '🏆', name: '传奇之路', desc: '达到 10 级', cond: function (s) { return G.levelFromXp(s.player.xp) >= 10; } },
    { id: 'epic-kill', emoji: '🐉', name: '史诗猎手', desc: '击败一只史诗级怪物', cond: function (s, ctx) { return !!(ctx && ctx.epicKill); } },
    { id: 'boss-slayer', emoji: '🏰', name: '屠龙者', desc: '击败本周 Boss', cond: function (s) { return !!s.boss.defeatedAt && s.boss.weeklyKey === G.isoWeekKey(); } },
    { id: 'well-rounded', emoji: '🌈', name: '全能战士', desc: '四维属性均达到 20', cond: function (s) { return G.CAT_KEYS.every(function (k) { return (s.player.attrs[k] || 0) >= 20; }); } }
  ];

  /* 检查并解锁成就，返回本次新解锁列表（就地写入 state） */
  G.checkAchievements = function (s, ctx) {
    const got = [];
    G.ACHIEVEMENTS.forEach(function (a) {
      if (!s.achievements[a.id]) {
        let ok = false;
        try { ok = !!a.cond(s, ctx || {}); } catch (e) { ok = false; }
        if (ok) { s.achievements[a.id] = Date.now(); got.push(a); }
      }
    });
    return got;
  };

  /* 日期工具（本地时区） */
  const pad = function (n) { return String(n).padStart(2, '0'); };
  G.todayStr = function (d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  G.yesterdayStr = function () {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return G.todayStr(d);
  };
  /* ISO 周键，如 2026-W45 */
  G.isoWeekKey = function (d) {
    d = d || new Date();
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const fday = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
    const week = 1 + Math.round((t - firstThu) / (7 * 86400000));
    return t.getUTCFullYear() + '-W' + pad(week);
  };
  /* 有效连击：最后击杀日在今天或昨天才算数 */
  G.effectiveStreak = function (s) {
    const last = s.player.streak.lastKillDate;
    if (!last) return 0;
    if (last === G.todayStr() || last === G.yesterdayStr()) return s.player.streak.current || 0;
    return 0;
  };

  MB.game = G;
})();
