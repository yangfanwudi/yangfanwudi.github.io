/* app.js — 入口：装载存档、订阅击杀事件、全局操作（changeStatus/deleteTask） */
(function () {
  'use strict';
  window.MB = window.MB || {}; // 全局命名空间守卫

  const App = {};
  MB.app = App;

  App.changeStatus = function (id, status) {
    const t = MB.state.setStatus(id, status);
    if (t) MB.ui.renderAll();
  };

  App.deleteTask = function (id) {
    MB.state.deleteTask(id);
    MB.ui.renderAll();
  };

  /* 击杀事件 → Toast（渲染由触发方完成） */
  MB.state.on('kill', function (e) {
    const d = MB.game.DIFF[e.task.difficulty] || MB.game.DIFF.normal;
    MB.ui.toast('<img class="t-img" src="' + d.icon + '" alt="">',
      '+' + e.xp + ' XP', '击败了「' + e.task.title + '」', 'kill');
    (e.newAch || []).forEach(function (a) {
      MB.ui.toast(a.emoji, '成就解锁 · ' + a.name, a.desc, 'achv');
    });
    if (e.bossDefeated) {
      MB.ui.toast('🏰', 'Boss 已被击败！', '额外奖励 +200 XP', 'boss');
    }
    if (e.levelUp) {
      MB.ui.toast('🎉', '升级到 Lv ' + e.level.to,
        '获得称号「' + MB.game.titleFor(e.level.to) + '」', 'level');
    }
  });

  window.addEventListener('DOMContentLoaded', function () {
    MB.state.load();
    MB.ui.bindOnce();
    MB.ui.renderAll();
    // 载入时补算成就（连击/等级/全能等），跨天打开时可能达成
    const got = MB.game.checkAchievements(MB.state.state, {});
    if (got.length) {
      MB.state.save();
      got.forEach(function (a) {
        MB.ui.toast(a.emoji, '成就解锁 · ' + a.name, a.desc, 'achv');
      });
      MB.ui.renderAll();
    }
  });
})();
