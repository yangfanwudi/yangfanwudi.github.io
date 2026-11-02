/* 不烧心鉴定所 · 前端应用
 * 零依赖、零后端、纯静态。路由用 hash，结果编码进 URL，刷新和分享都能还原。
 */
(function () {
  'use strict';

  var D = window.DATA || {};
  var V = Array.isArray(window.VERDICTS) ? window.VERDICTS : [];
  var app = document.getElementById('app');
  var modalRoot = document.getElementById('modal-root');

  var state = {
    name: '',
    answers: [],
    qi: 0,
    result: null,
    skin: 'paper',
    orderText: '',
    unlocked: false
  };
  try { state.unlocked = localStorage.getItem('bsx_unlocked') === '1'; } catch (e) { /* 隐私模式忽略 */ }

  var QUAD_NAME = {
    zhen: '良心高 · 烧心低',
    gui: '良心高 · 烧心高',
    pianyi: '良心低 · 烧心低',
    keng: '良心低 · 烧心高'
  };

  /* ---------------- 基础工具 ---------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function b64e(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64d(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }
  function serial() {
    return today() + '-' + String(Math.floor(1000 + Math.random() * 9000));
  }

  function track(event, data) {
    try {
      if (window.umami && typeof window.umami.track === 'function') window.umami.track(event, data || {});
      if (D.trackEndpoint && navigator.sendBeacon) {
        navigator.sendBeacon(D.trackEndpoint, JSON.stringify({ event: event, data: data || {}, t: Date.now() }));
      }
    } catch (e) { /* 统计失败不影响主流程 */ }
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () {
        toast('已复制');
      }).catch(function () { fallbackCopy(text); });
    }
    fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制'); }
    catch (e) { toast('复制失败，请手动选中'); }
    ta.remove();
  }

  /* ---------------- 结果编码 ---------------- */

  function encodeResult(o) {
    return b64e(JSON.stringify({ v: 1, n: o.n, s: o.s, h: o.h, t: o.t, d: o.d, k: o.k }));
  }
  function decodeResult(raw) {
    try {
      var o = JSON.parse(b64d(raw));
      if (!o || typeof o.n !== 'string' || typeof o.s !== 'number' || typeof o.h !== 'number') return null;
      return {
        n: String(o.n).slice(0, 24),
        s: clamp(Math.round(o.s), 0, 100),
        h: clamp(Math.round(o.h), 0, 100),
        t: String(o.t || ''),
        d: String(o.d || today()),
        k: String(o.k || 'paper')
      };
    } catch (e) { return null; }
  }
  function shareUrl() {
    var base = location.href.split('#')[0];
    return base + '#r=' + encodeResult(state.result || {});
  }
  function shareText() {
    var r = state.result;
    return '我给我的「' + r.n + '」做了个不烧心鉴定：良心 ' + r.s + '，烧心 ' + r.h +
      '。' + r.verdict.title + '。你也来测测 → ';
  }

  /* ---------------- 结论挑选 ---------------- */

  function quadrantOf(s, h) {
    return s >= 50 ? (h < 50 ? 'zhen' : 'gui') : (h < 50 ? 'pianyi' : 'keng');
  }
  function verdictFor(q, id) {
    if (id) {
      for (var i = 0; i < V.length; i++) if (V[i].id === id) return V[i];
    }
    var pool = V.filter(function (v) { return v.quadrant === q; });
    if (!pool.length) {
      return {
        id: 'fallback', quadrant: q, title: '待复核',
        lines: ['{name}的鉴定结果还在路上。', '先别急着下结论。', '建议：再测一次。'],
        stamp: '待复核', tags: []
      };
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function fill(text, name) {
    return String(text == null ? '' : text).replace(/\{name\}/g, name);
  }

  /* ---------------- 路由 ---------------- */

  function route() {
    var h = location.hash || '#/';
    if (window.scrollY) window.scrollTo(0, 0);
    if (h.indexOf('#r=') === 0) {
      var r = decodeResult(h.slice(3));
      if (!r) { location.replace('#/'); return; }
      return renderResult(r);
    }
    switch (h.split('?')[0]) {
      case '#/quiz': return renderQuiz();
      case '#/shop': return renderShop();
      case '#/merchant': return renderMerchant();
      case '#/about': return renderAbout();
      case '#/privacy': return renderPrivacy();
      case '#/daily': return renderDaily();
      case '#/result': location.replace('#/'); return;
      default: return renderHome();
    }
  }

  /* ---------------- 通用外壳 ---------------- */

  function header() {
    return '' +
      '<header class="topbar">' +
      '  <a class="brand" href="#/">' +
      '    <span class="brand-seal" aria-hidden="true">不</span>' +
      '    <span class="brand-text"><b>' + esc(D.brand) + '</b><i>' + esc(D.subtitle) + '</i></span>' +
      '  </a>' +
      '  <nav class="nav">' +
      '    <a href="#/daily">今日鉴定</a>' +
      '    <a href="#/shop">价目表</a>' +
      '    <a href="#/merchant" class="nav-cta">商家版</a>' +
      '  </nav>' +
      '</header>';
  }

  function footer() {
    return '' +
      '<footer class="footer">' +
      '  <p class="footer-line">玩梗向内容，非鉴定 / 检测 / 认证机构，不构成医疗、消费或法律建议。</p>' +
      '  <p class="footer-line muted">本所只有一个人，姓陈（虚构）· 与任何短剧、品牌、机构无关</p>' +
      '  <p class="footer-line muted">© ' + new Date().getFullYear() + ' ' + esc(D.brand) + ' · <a href="#/about">关于与举报</a> · <a href="#/privacy">隐私说明</a></p>' +
      '</footer>';
  }

  function shell(inner) {
    app.innerHTML = header() + inner + footer();
  }

  /* ---------------- 首页 ---------------- */

  function renderHome() {
    state.name = '';
    state.answers = [];
    state.qi = 0;

    var chips = (D.samples || []).map(function (s) {
      return '<button type="button" class="chip" data-action="sample" data-value="' + esc(s) + '">' + esc(s) + '</button>';
    }).join('');

    shell('' +
      '<main class="home">' +
      '  <section class="hero">' +
      '    <p class="kicker"><span class="dot"></span>自封的 · 只鉴定一件事 · 玩梗，不是健康测试</p>' +
      '    <h1>最近，什么让你<br class="only-m">有点<em>烧心</em>？</h1>' +
      '    <p class="lede">5 道题，30 秒，出张「烧不烧心」结果卡。<br>工作、对象、外卖、城市，都能写。</p>' +
      '    <form class="judge" id="judge-form" novalidate>' +
      '      <label class="sr-only" for="judge-input">要鉴定的对象</label>' +
      '      <input id="judge-input" name="name" maxlength="24" placeholder="写你私下怎么叫它，别写全名" autocomplete="off" enterkeyhint="go">' +
      '      <button type="submit" class="btn btn-primary">开始鉴定<span class="arrow">→</span></button>' +
      '    </form>' +
      '    <div class="chips" aria-label="试试这些">' + chips + '</div>' +
      '    <p class="counter" data-counter-line>今日营业中 · 全程约 30 秒</p>' +
      '  </section>' +

      '  <section class="sample">' +
      '    <div class="sample-card"><canvas id="sample-card" width="1080" height="1440" aria-label="证书样张"></canvas></div>' +
      '    <div class="sample-copy">' +
      '      <h3>结果卡长这样</h3>' +
      '      <p>1080×1440，存相册、发群、发朋友圈都够用。免费版带一层水印，1 块钱给三张无水印。</p>' +
      '      <p class="sample-note">样张对象：楼下那家牛肉面（虚构）</p>' +
      '    </div>' +
      '  </section>' +

      '  <section class="how">' +
      '    <div class="how-item"><span>01</span><h3>写个东西</h3><p>工作、对象、外卖、城市、存款，什么都行。</p></div>' +
      '    <div class="how-item"><span>02</span><h3>答 5 道题</h3><p>关于钱、后悔、良心和推荐，30 秒。</p></div>' +
      '    <div class="how-item"><span>03</span><h3>领一张卡</h3><p>良心指数 + 烧心值，可保存、可发群、可对线。</p></div>' +
      '  </section>' +

      '  <section class="proof">' +
      '    <div class="proof-card"><p>“贵是贵了点，但这钱花得不烧心。”</p><span>—— 本所的金牌评语</span></div>' +
      '    <div class="proof-card"><p>“又贵又烧心，建议止损。”</p><span>—— 本所的黑榜评语，几乎天天出现</span></div>' +
      '  </section>' +

      '  <section class="notice">' +
      '    <p><b>说明：</b>本站是玩梗工具，不是鉴定、检测或认证机构，内容随机生成，没有证明效力；不评价任何真实商家，也不构成医疗建议。真烧心、反酸、胸痛，请去医院消化内科。</p>' +
      '  </section>' +
      '</main>');

    var form = document.getElementById('judge-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = document.getElementById('judge-input').value.trim();
      if (!v) {
        toast('先写个要鉴定的东西');
        document.getElementById('judge-input').focus();
        return;
      }
      state.name = v.slice(0, 24);
      state.answers = [];
      state.qi = 0;
      track('start_quiz', { name: state.name });
      location.hash = '#/quiz';
    });

    loadCounter();

    var sampleCanvas = document.getElementById('sample-card');
    if (sampleCanvas) {
      var sv = verdictFor('zhen', 'consume-01');
      drawCard(sampleCanvas, {
        n: '楼下那家牛肉面', s: 86, h: 21, t: sv.id, d: today(), k: 'paper',
        serial: today() + '-0001', verdict: sv
      });
    }
  }

  function loadCounter() {
    var el = document.querySelector('[data-counter-line]');
    if (!el || !D.counter || !D.counter.namespace) return;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 2500);
    fetch('https://abacus.jasoncameron.dev/get/' + encodeURIComponent(D.counter.namespace) + '/' + encodeURIComponent(D.counter.key), { signal: ctrl.signal, cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && typeof j.value === 'number' && j.value >= 10) {
          el.innerHTML = '已出证 <b>' + j.value.toLocaleString('zh-CN') + '</b> 份 · 全程约 30 秒';
        }
      })
      .catch(function () { /* 静默降级 */ })
      .then(function () { clearTimeout(timer); });
  }

  function bumpCounter() {
    if (!D.counter || !D.counter.namespace) return;
    try {
      fetch('https://abacus.jasoncameron.dev/hit/' + encodeURIComponent(D.counter.namespace) + '/' + encodeURIComponent(D.counter.key), { cache: 'no-store' })
        .catch(function () {});
    } catch (e) { /* 不影响出证 */ }
  }

  /* ---------------- 答题 ---------------- */

  function renderQuiz() {
    var qs = D.questions || [];
    if (!state.name) { location.replace('#/'); return; }
    if (state.qi >= qs.length) { finishQuiz(); return; }

    var q = qs[state.qi];
    var pct = Math.round(((state.qi + 1) / qs.length) * 100);
    var opts = q.options.map(function (o, i) {
      return '<button type="button" class="option" data-action="answer" data-index="' + i + '">' +
        '<span class="option-key">' + String.fromCharCode(65 + i) + '</span>' +
        '<span class="option-text">' + esc(o.text) + '</span>' +
        '</button>';
    }).join('');

    shell('' +
      '<main class="quiz">' +
      '  <div class="quiz-head">' +
      '    <a class="back" href="#/" data-action="back">← 重来</a>' +
      '    <span class="quiz-object">鉴定对象：<b>' + esc(state.name) + '</b></span>' +
      '    <span class="quiz-count">' + (state.qi + 1) + ' / ' + qs.length + '</span>' +
      '  </div>' +
      '  <div class="progress"><i style="width:' + pct + '%"></i></div>' +
      '  <h2 class="q-title">' + esc(q.text) + '</h2>' +
      '  <div class="options">' + opts + '</div>' +
      '  <p class="quiz-tip">没有标准答案，凭直觉答。</p>' +
      '</main>');
  }

  function answer(index) {
    var qs = D.questions || [];
    var q = qs[state.qi];
    if (!q) return;
    state.answers[state.qi] = index;
    state.qi++;
    if (state.qi >= qs.length) finishQuiz();
    else renderQuiz();
  }

  function finishQuiz() {
    var qs = D.questions || [];
    var L = 50, H = 50;
    for (var i = 0; i < qs.length; i++) {
      var o = qs[i].options[state.answers[i]];
      if (!o) continue;
      L += o.l || 0;
      H += o.h || 0;
    }
    L = clamp(Math.round(L), 5, 99);
    H = clamp(Math.round(H), 5, 99);
    var q = quadrantOf(L, H);
    var v = verdictFor(q);
    var payload = {
      n: state.name || '无名之物',
      s: L, h: H, t: v.id, d: today(), k: state.skin
    };
    track('finish_quiz', { quadrant: q, s: L, h: H });
    bumpCounter();
    state.qi = 0;
    state.answers = [];
    location.hash = '#r=' + encodeResult(payload);
  }

  /* ---------------- 结果 ---------------- */

  function renderResult(raw) {
    var q = quadrantOf(raw.s, raw.h);
    var v = verdictFor(q, raw.t);
    state.result = {
      n: raw.n, s: raw.s, h: raw.h, t: v.id, d: raw.d, k: raw.k,
      serial: serial(), quadrant: q, verdict: v
    };
    state.skin = raw.k || 'paper';
    if (!D.skins.some(function (s) { return s.id === state.skin; })) state.skin = 'paper';

    var lines = v.lines.map(function (l) {
      return '<li>' + esc(fill(l, raw.n)) + '</li>';
    }).join('');

    var skinTabs = (D.skins || []).map(function (s) {
      return '<button type="button" class="skin-tab' + (s.id === state.skin ? ' is-on' : '') + '" data-action="skin" data-skin="' + s.id + '">' + esc(s.name) + '</button>';
    }).join('');

    shell('' +
      '<main class="result">' +
      '  <div class="result-head">' +
      '    <p class="kicker"><span class="dot"></span>鉴定完成 · ' + esc(raw.d) + '</p>' +
      '    <h1 class="result-title">' + esc(v.title) + '</h1>' +
      '    <p class="result-sub">' + esc(QUAD_NAME[q]) + ' · 鉴定对象「' + esc(raw.n) + '」</p>' +
      '  </div>' +
      '  <div class="card-stage">' +
      '    <canvas id="card" width="1080" height="1440" aria-label="鉴定证书"></canvas>' +
      '  </div>' +
      '  <div class="skin-tabs" role="tablist" aria-label="证书皮肤">' + skinTabs + '</div>' +
      '  <div class="scores">' +
      '    <div class="score"><div class="score-top"><span>良心指数</span><b>' + raw.s + '</b></div><div class="bar"><i style="width:' + raw.s + '%"></i></div><p>' + scoreNote('l', raw.s) + '</p></div>' +
      '    <div class="score"><div class="score-top"><span>烧心值</span><b class="hot">' + raw.h + '</b></div><div class="bar bar-hot"><i style="width:' + raw.h + '%"></i></div><p>' + scoreNote('h', raw.h) + '</p></div>' +
      '  </div>' +
      '  <p class="score-note">分数由 5 道题随机组合，娱乐用，不是测评数据。</p>' +
      '  <div class="verdict"><h3>鉴定意见</h3><ol>' + lines + '</ol></div>' +
      '  <div class="actions">' +
      '    <button type="button" class="btn btn-primary" data-action="save">保存图片</button>' +
      '    <button type="button" class="btn" data-action="share">发给朋友</button>' +
      '    <button type="button" class="btn btn-ghost" data-action="again">再鉴定一个</button>' +
      '    <button type="button" class="btn btn-ghost" data-action="pay" data-id="hd">1 元三件套</button>' +
      '  </div>' +
      '  <p class="unlock-line">' + (state.unlocked
        ? '已解锁：保存和换皮肤都是无水印。'
        : '<button type="button" class="link-btn" data-action="unlock">已付款？输入兑换码，自动出三张</button>') + '</p>' +
      '  <p class="wechat-tip">微信里打开？保存图片请长按证书。</p>' +
      '  <section class="afters">' +
      '    <h3>然后呢</h3>' +
      '    <p>把这张证发到群里，看谁的对象烧心值更离谱。想给公司/门店做一版，看 <a href="#/merchant">商家版</a>。</p>' +
      '  </section>' +
      '</main>');

    drawCard(document.getElementById('card'), state.result, { clean: state.unlocked });
    if (/MicroMessenger/i.test(navigator.userAgent)) {
      var tip = document.querySelector('.wechat-tip');
      if (tip) tip.classList.add('show');
    }
    track('view_result', { quadrant: q });
  }

  function scoreNote(kind, n) {
    if (kind === 'l') {
      if (n >= 80) return '这年头，算稀缺资源。';
      if (n >= 60) return '基本靠谱，可以处。';
      if (n >= 40) return '不好说，看你运气。';
      return '建议重新考虑。';
    }
    if (n >= 80) return '已经烧到嗓子眼了。';
    if (n >= 60) return '有点上头，注意止损。';
    if (n >= 40) return '偶尔隐隐作痛。';
    return '清爽，难得。';
  }

  /* ---------------- 画布 ---------------- */

  function font(size, weight, serif) {
    return (weight ? weight + ' ' : '') + size + 'px ' + (serif
      ? '"Songti SC","Noto Serif SC","SimSun",serif'
      : '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif');
  }

  function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
    var chars = String(text).split('');
    var line = '';
    var lines = [];
    for (var i = 0; i < chars.length; i++) {
      var next = line + chars[i];
      if (ctx.measureText(next).width > maxW && line) {
        lines.push(line);
        line = chars[i];
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1].replace(/.$/, '…');
    }
    for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], x, y + j * lh);
    return y + (lines.length - 1) * lh;
  }

  function drawCard(canvas, r, opts) {
    if (!canvas) return;
    var W = 1080, H = 1440;
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    var skin = (D.skins || []).filter(function (s) { return s.id === r.k; })[0] || (D.skins || [])[0] || { bg: '#F5EFE1', ink: '#1B1A17', sub: '#6B6558', accent: '#B5342A', line: '#D9CFB8' };

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = skin.bg;
    ctx.fillRect(0, 0, W, H);

    // 纸纹
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = skin.ink;
    for (var y = 0; y < H; y += 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y + 2);
      ctx.stroke();
    }
    ctx.restore();

    // 双线框
    ctx.strokeStyle = skin.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.strokeRect(52, 52, W - 104, H - 104);

    // 四角十字
    ctx.strokeStyle = skin.accent;
    ctx.lineWidth = 2;
    [[64, 64], [W - 64, 64], [64, H - 64], [W - 64, H - 64]].forEach(function (p) {
      ctx.beginPath();
      ctx.moveTo(p[0] - 10, p[1]);
      ctx.lineTo(p[0] + 10, p[1]);
      ctx.moveTo(p[0], p[1] - 10);
      ctx.lineTo(p[0], p[1] + 10);
      ctx.stroke();
    });

    // 抬头
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = skin.ink;
    ctx.font = font(34, 700, true);
    ctx.fillText('不烧心鉴定所', 88, 132);
    ctx.fillStyle = skin.sub;
    ctx.font = font(18, 400, false);
    ctx.fillText('BU SHAO XIN  ·  MEME  STUDIO', 88, 164);

    ctx.textAlign = 'right';
    ctx.fillStyle = skin.sub;
    ctx.font = font(20, 400, false);
    ctx.fillText('NO. ' + (r.serial || serial()), W - 88, 128);
    ctx.fillText('日期 ' + r.d, W - 88, 164);

    ctx.strokeStyle = skin.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(88, 198);
    ctx.lineTo(W - 88, 198);
    ctx.stroke();

    // 鉴定对象
    ctx.textAlign = 'left';
    ctx.fillStyle = skin.accent;
    ctx.font = font(20, 700, false);
    ctx.fillText('鉴 定 对 象', 88, 250);
    ctx.fillStyle = skin.ink;
    ctx.font = font(58, 700, true);
    var nameEnd = wrapText(ctx, '「' + r.n + '」', 88, 320, W - 176 - 40, 68, 2);

    ctx.fillStyle = skin.sub;
    ctx.font = font(21, 400, false);
    ctx.fillText('用户自述 · 未经核实 · 玩梗', 88, nameEnd + 58);

    // 分数框
    var bx = 88, by = 470, bw = W - 176, bh = 240;
    ctx.strokeStyle = skin.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.beginPath();
    ctx.moveTo(bx + bw / 2, by);
    ctx.lineTo(bx + bw / 2, by + bh);
    ctx.stroke();

    ctx.fillStyle = skin.sub;
    ctx.font = font(22, 400, false);
    ctx.fillText('良 心 指 数', bx + 36, by + 56);
    ctx.fillText('烧 心 值', bx + bw / 2 + 36, by + 56);

    ctx.fillStyle = skin.ink;
    ctx.font = font(104, 700, true);
    var wS = ctx.measureText(String(r.s)).width;
    var wH = ctx.measureText(String(r.h)).width;
    ctx.fillText(String(r.s), bx + 34, by + 180);
    ctx.fillStyle = r.h >= 60 ? skin.accent : skin.ink;
    ctx.fillText(String(r.h), bx + bw / 2 + 34, by + 180);

    ctx.fillStyle = skin.sub;
    ctx.font = font(20, 400, false);
    ctx.fillText('/ 100', bx + 34 + wS + 14, by + 180);
    ctx.fillText('/ 100', bx + bw / 2 + 34 + wH + 14, by + 180);

    ctx.fillStyle = skin.sub;
    ctx.font = font(17, 400, false);
    ctx.fillText('分数由 5 道题随机组合，娱乐用，非测评数据', bx + 34, by + 268);

    // 结论标题
    ctx.fillStyle = skin.accent;
    ctx.font = font(18, 700, false);
    ctx.fillText('鉴 定 意 见', 88, 790);

    ctx.fillStyle = skin.ink;
    var title = String(r.verdict.title || '');
    var tsize = Math.max(60, Math.min(92, Math.floor(660 / Math.max(4, title.length))));
    ctx.font = font(tsize, 700, true);
    wrapText(ctx, title, 88, 890, 660, tsize + 12, 2);

    // 印章：虚线圆 + 「玩梗」字样，避免像真实公章
    ctx.save();
    ctx.translate(W - 210, 930);
    ctx.rotate(-Math.PI / 14);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = skin.accent;
    ctx.lineWidth = 5;
    ctx.setLineDash([12, 9]);
    ctx.beginPath();
    ctx.arc(0, 0, 102, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    var stamp = String(r.verdict.stamp || '已鉴定');
    var size = Math.min(44, Math.floor(190 / Math.max(3, stamp.length)));
    ctx.fillStyle = skin.accent;
    ctx.font = font(size, 700, true);
    ctx.textAlign = 'center';
    ctx.fillText(stamp, 0, 4);
    ctx.font = font(16, 400, false);
    ctx.fillText('玩梗 · 非鉴定', 0, 52);
    ctx.restore();

    // 三行意见：太长就自动缩字号，保证一行放得下
    ctx.textAlign = 'left';
    ctx.fillStyle = skin.ink;
    var lines = (r.verdict.lines || []).map(function (l) { return fill(l, r.n); });
    for (var i = 0; i < lines.length && i < 3; i++) {
      var fs = 36;
      ctx.font = font(fs, 400, false);
      while (fs > 22 && ctx.measureText(lines[i]).width > W - 176) {
        fs -= 2;
        ctx.font = font(fs, 400, false);
      }
      ctx.fillText(lines[i], 88, 1092 + i * 62);
    }

    // 页脚
    ctx.strokeStyle = skin.line;
    ctx.beginPath();
    ctx.moveTo(88, 1262);
    ctx.lineTo(W - 88, 1262);
    ctx.stroke();

    ctx.fillStyle = skin.sub;
    ctx.font = font(20, 400, false);
    ctx.fillText('玩梗向 · 非鉴定 / 检测机构 · 不构成医疗或消费建议', 88, 1306);
    ctx.textAlign = 'right';
    var cardHost = D.siteUrl;
    if (!cardHost) {
      var hn = location.hostname;
      cardHost = (hn && hn !== 'localhost' && hn !== '127.0.0.1') ? hn : '不烧心鉴定所 · 玩梗';
    }
    ctx.fillText(cardHost, W - 88, 1306);
    ctx.textAlign = 'center';
    ctx.fillStyle = skin.accent;
    ctx.font = font(20, 400, true);
    ctx.fillText('本所与任何短剧、品牌无关 · 只鉴定一件事', W / 2, 1352);

    // 免费版水印：斜向平铺；付费版（opts.clean）跳过
    if (!(opts && opts.clean)) {
      ctx.save();
      ctx.globalAlpha = 0.035;
      ctx.fillStyle = skin.ink;
      ctx.font = font(32, 700, false);
      ctx.textAlign = 'center';
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-Math.PI / 7);
      for (var wy = -720; wy <= 720; wy += 210) {
        ctx.fillText('不烧心鉴定所 · 玩梗 · 非鉴定机构', 0, wy);
      }
      ctx.restore();
    }
  }

  /* ---------------- 商店 / 商家 / 关于 / 今日 ---------------- */

  function renderShop() {
    var cards = (D.shop || []).map(function (p) {
      var inc = (p.includes && p.includes.length)
        ? '<ul class="includes">' + p.includes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
        : '';
      return '<article class="product">' +
        '<div class="product-head"><h3>' + esc(p.name) + '</h3><span class="tag">' + esc(p.tag) + '</span></div>' +
        '<p class="price">¥' + p.price + '</p>' +
        '<p class="desc">' + esc(p.desc) + '</p>' + inc +
        '<button type="button" class="btn btn-primary btn-block" data-action="pay" data-id="' + p.id + '">立即解锁</button>' +
        '</article>';
    }).join('');

    shell('' +
      '<main class="page">' +
      '  <p class="kicker"><span class="dot"></span>价目表</p>' +
      '  <h1 class="page-title">免费出证，1 块钱三张。</h1>' +
      '  <p class="page-lede">不卖课、不卖焦虑。三张图 1 块，做号工具 3 块，定制 6 块；不满意原样退。</p>' +
      '  <div class="products">' + cards + '</div>' +
      '  <section class="notice"><p><b>交付方式：</b>加微信 → 转 1 块 → 发你兑换码 → 回结果页输入「兑换码」→ 自动解锁三张，自己保存。不满意原样退。</p></section>' +
      '</main>');
  }

  function renderMerchant() {
    var m = D.merchant || { packages: [] };
    var rows = (m.packages || []).map(function (p) {
      return '<article class="pkg">' +
        '<div class="pkg-head"><h3>' + esc(p.name) + '</h3><p class="price">¥' + p.price + '</p></div>' +
        '<ul>' + p.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' +
        '<button type="button" class="btn btn-block" data-action="merchant" data-name="' + esc(p.name) + '">咨询这档</button>' +
        '</article>';
    }).join('');

    shell('' +
      '<main class="page">' +
      '  <p class="kicker"><span class="dot"></span>商家版</p>' +
      '  <h1 class="page-title">' + esc(m.headline || '给老板的蹭梗套餐') + '</h1>' +
      '  <p class="page-lede">' + esc(m.sub || '') + '</p>' +
      '  <div class="pkgs">' + rows + '</div>' +
      '  <section class="notice"><p><b>为什么不建议你自己拍短剧：</b>同款剧情已经铺满平台，再拍一条很难被看见；一张能拍照的立牌，反而更可能出现在顾客的朋友圈。</p></section>' +
      '  <section class="notice warm"><p>' + esc((m.note || '')) + '</p></section>' +
      '</main>');
  }

  function renderAbout() {
    shell('' +
      '<main class="page about">' +
      '  <p class="kicker"><span class="dot"></span>关于</p>' +
      '  <h1 class="page-title">我们只做一件事：帮你把「说不清」说清楚。</h1>' +
      '  <p>「不烧心」原本是胃食管反流的症状，后来因为 AI 短剧里摊主的台词「贵是贵了点，但吃了不烧心」变成了公共评价体系：靠不靠谱、亏不亏心、后不后悔。</p>' +
      '  <p>本所借用这个说法，做了个 30 秒的小工具。你写一个对象，答 5 道题，我们给你一张结果卡。它不科学，但你懂。</p>' +
      '  <h3>边界</h3>' +
      '  <ul>' +
      '    <li><b>不是鉴定、检测或认证机构</b>，没有资质，也不出具任何有证明效力的文件；结果由 5 道题随机组合。</li>' +
      '    <li>不是医疗机构，不提供诊断、筛查或治疗建议；真烧心、反酸、胸痛，请去医院消化内科。</li>' +
      '    <li>不与任何短剧、品牌、机构合作或关联，也不是官方。</li>' +
      '    <li>不评价真实商家；请勿填写具体店名、人名、电话，写了也会被打码处理。</li>' +
      '    <li>不构成消费决策依据。贵不贵、值不值，最后还得你自己掏钱。</li>' +
      '    <li>建议 16 岁以上使用；未成年人请在监护人陪同下玩。</li>' +
      '  </ul>' +
      '  <h3>你的数据</h3>' +
      '  <p>你写的内容只存在当前浏览器和分享链接里，不上传服务器；关掉页面就没了。统计只记录「有人生成了一张」这类匿名事件，不含你输入的文字，也不做用户画像。想删除：关页即可，或把分享链接删掉。</p>' +
      '  <h3>联系与举报</h3>' +
      '  <p>商务 / 侵权 / 举报：<b>' + esc((D.links && D.links.wechat) || 'yang_fan_wudi') + '</b>（微信同号），我们 24 小时内处理。</p>' +
      '  <p class="muted">如果你是被鉴定的商家：发我链接，我删。</p>' +
      '</main>');
  }

  function renderPrivacy() {
    shell('' +
      '<main class="page about">' +
      '  <p class="kicker"><span class="dot"></span>隐私</p>' +
      '  <h1 class="page-title">隐私说明</h1>' +
      '  <p class="page-lede">这是一个纯前端的玩梗工具。你写的内容默认不上传；关掉页面就没了。</p>' +
      '  <h3>你写的内容</h3>' +
      '  <p>你输入的对象、答案和结果只存在当前浏览器的 localStorage 和分享链接里。分享链接会把答案编码进 URL：拿到链接的人能看到结果，所以别填真实姓名、电话、店名或任何敏感信息。</p>' +
      '  <p>清除浏览器数据、换浏览器或删除分享链接，对应内容就不再由本站保存。我们不建账号、不做用户画像。</p>' +
      '  <h3>访问日志</h3>' +
      '  <p>本站托管在 Cloudflare Pages。Cloudflare 可能为安全、防滥用和可用性记录 IP、User-Agent 等访问日志；这些日志不由本站直接读取，也不用于广告画像。</p>' +
      '  <h3>Cookie 与广告</h3>' +
      '  <p>当前没有启用广告或第三方追踪；只使用 localStorage 记住解锁状态等本地设置。</p>' +
      '  <p>如果未来接入 Google AdSense：Google 及其合作伙伴可能使用 Cookie，根据你访问本站和其他网站的情况展示广告、限制频次、衡量效果和防止欺诈。EEA/英国用户会先通过 Google 认证的 CMP 征得同意；你可以通过 <a href="https://adssettings.google.com/" target="_blank" rel="noopener">Google 广告设置</a> 或 <a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener">aboutads.info</a> 管理个性化广告。</p>' +
      '  <h3>你的选择</h3>' +
      '  <p>不想留下本地数据：关页后清除本站 localStorage；不想让分享链接继续可读：删除链接即可。16 岁以下请在监护人陪同下使用。</p>' +
      '  <h3>联系</h3>' +
      '  <p>隐私 / 侵权 / 举报：<b>' + esc((D.links && D.links.wechat) || 'yang_fan_wudi') + '</b>（微信同号）。</p>' +
      '  <p class="muted">更新日期：2026-10-29</p>' +
      '</main>');
  }

  function renderDaily() {
    var list = (D.daily || []).map(function (d) {
      return '<article class="daily">' +
        '<div class="daily-top"><span class="daily-name">' + esc(d.name) + '</span><span class="daily-stamp">' + esc(d.stamp) + '</span></div>' +
        '<p class="daily-title">' + esc(d.title) + '</p>' +
        '<p class="daily-note">' + esc(d.note) + '</p>' +
        '<div class="daily-scores"><span>良心 ' + d.s + '</span><span>烧心 ' + d.h + '</span></div>' +
        '</article>';
    }).join('');

    shell('' +
      '<main class="page">' +
      '  <p class="kicker"><span class="dot"></span>今日鉴定</p>' +
      '  <h1 class="page-title">今天被鉴定的三样东西。</h1>' +
      '  <p class="page-lede">每天挑三条有意思的放上来。想上榜，去测一个，截图发我。</p>' +
      '  <div class="dailies">' + list + '</div>' +
      '  <p class="center"><a class="btn btn-primary" href="#/">我也要鉴定</a></p>' +
      '</main>');
  }

  /* ---------------- 弹窗 ---------------- */

  function openModal(html) {
    modalRoot.innerHTML = '<div class="modal-mask" data-action="close-modal">' +
      '<div class="modal" role="dialog" aria-modal="true">' +
      '<button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">×</button>' +
      html +
      '</div></div>';
    document.body.classList.add('modal-open');
  }
  function closeModal() {
    modalRoot.innerHTML = '';
    document.body.classList.remove('modal-open');
  }
  function wechatBlock(title, body) {
    var wx = (D.links && D.links.wechat) || 'yang_fan_wudi';
    return '<h3>' + esc(title) + '</h3><p>' + body + '</p>' +
      '<div class="wx">微信：<b>' + esc(wx) + '</b></div>' +
      '<button type="button" class="btn btn-primary btn-block" data-action="copy-wechat">复制微信号</button>' +
      '<p class="modal-tip">备注「鉴定」，转完发你兑换码；码不对/发不出原样退。</p>';
  }

  function openUnlock() {
    openModal('<h3>输入兑换码</h3>' +
      '<p>付款后你会拿到一个码（微信发你，或在自动发货平台里），输进去就解锁无水印三张。</p>' +
      '<input class="code-input" id="unlock-code" placeholder="BSX-XXXX" autocomplete="off" autocapitalize="characters">' +
      '<button type="button" class="btn btn-primary btn-block" data-action="do-unlock">解锁</button>' +
      '<p class="modal-tip">码不对、发不出，原样退。</p>');
    setTimeout(function () { var i = document.getElementById('unlock-code'); if (i) i.focus(); }, 60);
  }

  function openPay(id) {
    if (id === 'hd' && !state.result) {
      openModal('<h3>先做一张卡</h3><p>1 块钱那档是给「已经有结果卡」的人解锁无水印。先回首页测一张，再回来买码。</p>' +
        '<a class="btn btn-primary btn-block" href="#/">去测一张</a>');
      return;
    }
    var p = (D.shop || []).filter(function (x) { return x.id === id; })[0];
    var title = p ? p.name : '解锁';
    var price = p ? p.price : 1;
    track('pay_click', { id: id });
    if (D.links && D.links.afdian) {
      openModal('<h3>' + esc(title) + '</h3><p>¥' + price + '，付款后自动发兑换码。</p>' +
        '<a class="btn btn-primary btn-block" href="' + esc(D.links.afdian) + '" target="_blank" rel="noopener">去爱发电付款</a>' +
        '<p class="modal-tip">付完回结果页，点「已付款？输入兑换码」。</p>');
      return;
    }
    openModal(wechatBlock(title + ' · ¥' + price, '加微信转 ¥' + price + '，发你兑换码；回结果页输入就解锁三张，不用发链接。'));
  }

  function openMerchant(name) {
    track('merchant_click', { name: name });
    if (D.links && D.links.merchantForm) {
      openModal('<h3>' + esc(name || '商家咨询') + '</h3><p>填一下店名、城市、想要什么，我 2 小时内回。</p>' +
        '<a class="btn btn-primary btn-block" href="' + esc(D.links.merchantForm) + '" target="_blank" rel="noopener">填写需求表</a>');
      return;
    }
    openModal(wechatBlock(name || '商家咨询', '加微信发我：城市 + 店名 + 想要的物料，我先给你出个样。'));
  }

  /* ---------------- 事件 ---------------- */

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var a = el.getAttribute('data-action');

    if (a === 'sample') {
      var input = document.getElementById('judge-input');
      if (input) { input.value = el.getAttribute('data-value'); input.focus(); }
      return;
    }
    if (a === 'answer') { answer(parseInt(el.getAttribute('data-index'), 10)); return; }
    if (a === 'back') { state.answers = []; state.qi = 0; return; }
    if (a === 'skin') {
      state.skin = el.getAttribute('data-skin');
      if (state.result) {
        state.result.k = state.skin;
        drawCard(document.getElementById('card'), state.result, { clean: state.unlocked });
        Array.prototype.forEach.call(document.querySelectorAll('.skin-tab'), function (b) {
          b.classList.toggle('is-on', b.getAttribute('data-skin') === state.skin);
        });
        track('switch_skin', { skin: state.skin });
      }
      return;
    }
    if (a === 'unlock') { openUnlock(); return; }
    if (a === 'do-unlock') {
      var codeEl = document.getElementById('unlock-code');
      var val = codeEl ? codeEl.value.trim().toUpperCase() : '';
      var code = String(D.unlockCode || '').toUpperCase();
      if (!code || val !== code) { toast('码不对，看一下付款时发的消息'); return; }
      state.unlocked = true;
      try { localStorage.setItem('bsx_unlocked', '1'); } catch (e) { /* 隐私模式忽略 */ }
      closeModal();
      toast('已解锁：保存 / 换皮肤都是无水印');
      if (state.result) {
        state.result.k = state.skin;
        drawCard(document.getElementById('card'), state.result, { clean: true });
      }
      var line = document.querySelector('.unlock-line');
      if (line) line.textContent = '已解锁：保存和换皮肤都是无水印。';
      return;
    }
    if (a === 'save') { saveCard(); return; }
    if (a === 'share') { shareResult(); return; }
    if (a === 'again') { state.name = ''; state.answers = []; state.qi = 0; location.hash = '#/'; return; }
    if (a === 'pay') { openPay(el.getAttribute('data-id')); return; }
    if (a === 'merchant') { openMerchant(el.getAttribute('data-name')); return; }
    if (a === 'close-modal') {
      if (el.classList.contains('modal-mask') && e.target.closest('.modal')) return;
      closeModal(); return;
    }
    if (a === 'copy-wechat') {
      copyText(((D.links && D.links.wechat) || 'yang_fan_wudi')); return;
    }
    if (a === 'copy-order') {
      copyText(state.orderText || '没有结果链接，让对方重新打开结果页'); return;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  /* ---------------- 保存 / 分享 ---------------- */

  function saveCard() {
    var c = document.getElementById('card');
    if (!c) return;
    var isWeChat = /MicroMessenger/i.test(navigator.userAgent);
    var name = (state.result && state.result.n) || '匿名';
    var fname = '不烧心鉴定_' + name.replace(/[\\/:*?"<>|]/g, '') + '.png';

    function done() {
      track('download', {});
      if (isWeChat) toast('已生成，长按图片保存');
      else toast('已保存到下载');
    }
    if (c.toBlob) {
      c.toBlob(function (blob) {
        if (!blob) { openImageFallback(); return; }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        done();
      }, 'image/png');
      return;
    }
    openImageFallback();
  }

  function openImageFallback() {
    var c = document.getElementById('card');
    var w = window.open('', '_blank');
    if (w && c) {
      w.document.write('<title>长按保存</title><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center"><img src="' + c.toDataURL('image/png') + '" style="max-width:100%"></body>');
      w.document.close();
      toast('长按图片保存');
    } else {
      toast('保存失败，试试截图');
    }
  }

  function shareResult() {
    var r = state.result;
    if (!r) return;
    var url = shareUrl();
    var text = shareText();
    if (navigator.share) {
      navigator.share({ title: '不烧心鉴定所', text: text, url: url }).then(function () {
        track('share', { via: 'web' });
      }).catch(function () { /* 用户取消 */ });
      return;
    }
    copyText(text + url);
    track('share', { via: 'copy' });
  }

  /* ---------------- 启动 ---------------- */

  window.addEventListener('hashchange', route);
  route();

  // 调试用：控制台里可以 __drawCard(canvas, {...}) 单独出图
  window.__drawCard = drawCard;
})();
