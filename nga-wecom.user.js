// ==UserScript==
// @name         NGA 企微皮肤 (nga-wecom)
// @namespace    https://github.com/Wangyi/nga-wecom
// @version      0.1.1
// @description  把 NGA 玩家社区伪装成企业微信桌面客户端 —— 登录态只读浏览模式，Alt+W 一键切回原版
// @author       Wangyi
// @match        *://bbs.nga.cn/*
// @match        *://nga.178.com/*
// @match        *://ngabbs.com/*
// @match        *://www.ngabbs.com/*
// @grant        none
// @noframes
// @run-at       document-start
// @license      MIT
// ==/UserScript==

/*
 * 架构（单文件内分层）：
 *   1. 常量与调试统计
 *   2. 纯工具层（无 DOM 依赖，Node 可直接 require 测试）
 *   3. 设置层（localStorage 持久化）
 *   4. 内容清洗层（NGA 楼层 HTML -> 气泡安全 HTML）
 *   5. 适配层（防御性多候选选择器：访客无法直接访问，选择器需在登录页面上校准）
 *   6. UI 壳层（企微三栏 + 深浅色）
 *   7. 行为层（路由 / 无限滚动 / 快捷键 / 设置面板 / 灯箱）
 *   8. 伪装层（标题 / favicon）
 *
 * 约束：顶层不得出现任何 DOM 引用（保证 node --check / require 可用），
 *       所有 DOM 访问都在函数体内并被 boot() 守卫调用。
 */
(function () {
  'use strict';

  // ====================================================================
  // 1. 常量与调试统计
  // ====================================================================

  var VERSION = '0.1.1';
  var LS_KEY = 'ngawecom:settings';
  var WECOM_TITLE = '企业微信';
  var FETCH_MIN_INTERVAL = 800; // 无限滚动两次请求的最小间隔（ms），降低风控风险
  var WAIT_TIMEOUT = 10000;     // 等待 NGA 客户端渲染的超时（ms）

  // 企微风格 favicon（蓝色圆角方块 + 白色气泡）
  var FAVICON_DATAURI =
    "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Crect%20width='64'%20height='64'%20rx='14'%20fill='%230082ef'/%3E%3Cpath%20d='M16%2020h32a4%204%200%200%201%204%204v14a4%204%200%200%201-4%204H32l-9%209v-9h-7a4%204%200%200%201-4-4V24a4%204%200%200%201%204-4z'%20fill='%23fff'/%3E%3C/svg%3E";

  // 调试统计：记录每个候选选择器的命中/未命中次数与启动流程相位，供站内 NGAWECOM.debug() 校准
  var DEBUG_STATS = { hits: {}, misses: {}, counts: {}, phase: 'loaded' };
  function statHit(key) { DEBUG_STATS.hits[key] = (DEBUG_STATS.hits[key] || 0) + 1; }
  function statMiss(key) { DEBUG_STATS.misses[key] = (DEBUG_STATS.misses[key] || 0) + 1; }
  function statCount(key, val) { DEBUG_STATS.counts[key] = val; }

  // ====================================================================
  // 2. 纯工具层（Node 可测）
  // ====================================================================

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // 聊天风格相对时间：今天 -> HH:mm，昨天 -> 昨天，同年 -> M月D日，跨年 -> YYYY-MM-DD
  function relTime(ts, now) {
    if (!ts || ts <= 0) return '';
    now = now == null ? Date.now() / 1000 : now;
    function dayStart(t) {
      var d = new Date(t * 1000);
      d.setHours(0, 0, 0, 0);
      return d.getTime() / 1000;
    }
    var d = new Date(ts * 1000);
    var days = Math.round((dayStart(now) - dayStart(ts)) / 86400);
    if (days <= 0) return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (days === 1) return '昨天';
    if (d.getFullYear() === new Date(now * 1000).getFullYear()) {
      return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // 日期分割线文案：今天/昨天/M月D日/完整日期（与 relTime 保持同一天粒度）
  function dayLabel(ts, now) {
    now = now == null ? Date.now() / 1000 : now;
    function dayStart(t) {
      var d = new Date(t * 1000);
      d.setHours(0, 0, 0, 0);
      return d.getTime() / 1000;
    }
    var d = new Date(ts * 1000);
    var days = Math.round((dayStart(now) - dayStart(ts)) / 86400);
    if (days <= 0) return '今天 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (days === 1) return '昨天 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (d.getFullYear() === new Date(now * 1000).getFullYear()) {
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // 姓名 -> 稳定配色（HSL，饱和度/亮度固定在企微观感范围）
  function hashColor(name) {
    var h = 0;
    var s = String(name == null ? '' : name);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ',58%,52%)';
  }

  function firstChar(name) {
    var s = String(name == null ? '' : name).trim();
    return s ? s.charAt(0).toUpperCase() : '?';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function truncate(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    return s.slice(0, n) + '…';
  }

  // 相对/绝对 URL -> 绝对 URL（基于 URL API，纯函数可测）
  function absolutize(url, base) {
    if (url == null) return url;
    var u = String(url).trim();
    if (!u) return u;
    if (/^(https?:|data:|#|javascript:)/i.test(u)) return u;
    if (u.indexOf('//') === 0) return 'https:' + u;
    try { return new URL(u, base || 'https://bbs.nga.cn/').href; } catch (e) { return u; }
  }

  function parseQueryParam(url, key) {
    var s = String(url == null ? '' : url);
    var qi = s.indexOf('?');
    if (qi < 0) return '';
    var pairs = s.slice(qi + 1).split('#')[0].split('&');
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      if (decodeURIComponent(kv[0] || '') === key) {
        try { return decodeURIComponent((kv[1] || '').replace(/\+/g, ' ')); } catch (e) { return kv[1] || ''; }
      }
    }
    return '';
  }

  function currentPage(url) {
    var p = parseInt(parseQueryParam(url, 'page'), 10);
    return p > 0 ? p : 1;
  }

  function buildPageUrl(url, page) {
    var u = String(url == null ? '' : url);
    if (/[?&]page=\d+/.test(u)) return u.replace(/([?&]page=)\d+/, '$1' + page);
    return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'page=' + page;
  }

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  // 登录墙识别：只认精确标志（NGA 拦截页的标题与正文固定文案），
  // 不使用"请在登录后"这类泛化文案，避免误伤正常页面
  function isGuestWallText(title, bodyHead) {
    return /访客不能直接访问/.test(String(title == null ? '' : title)) ||
           /访客不能直接访问/.test(String(bodyHead == null ? '' : bodyHead));
  }

  // ====================================================================
  // 3. 设置层
  // ====================================================================

  var SETTINGS_DEFAULTS = { enabled: true, theme: 'auto', fakeAvatar: true, selfName: '' };
  var SETTINGS = null;

  function loadSettings() {
    var raw = {};
    try { raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { raw = {}; }
    var out = {};
    for (var k in SETTINGS_DEFAULTS) out[k] = raw[k] !== undefined ? raw[k] : SETTINGS_DEFAULTS[k];
    return out;
  }

  function saveSettings(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* 隐私模式等场景忽略 */ }
  }

  // ====================================================================
  // 4. 内容清洗层（依赖 DOM，仅浏览器执行）
  // ====================================================================

  // NGA 楼层 HTML -> 安全的 DocumentFragment
  // - 移除脚本/iframe/表单等危险或无意义节点
  // - 剥离全部 on* 事件属性
  // - 图片：懒加载属性提升、相对路径绝对化、去内联尺寸交给 CSS 约束
  // - 链接：绝对化并新窗口打开
  function sanitizeContent(html, baseUrl) {
    var tpl = document.createElement('template');
    tpl.innerHTML = String(html || '');
    var frag = tpl.content;

    var kill = frag.querySelectorAll('script,iframe,form,object,embed,link,meta,video,audio');
    Array.prototype.forEach.call(kill, function (el) { el.remove(); });

    var all = frag.querySelectorAll('*');
    Array.prototype.forEach.call(all, function (el) {
      var attrs = Array.prototype.slice.call(el.attributes);
      attrs.forEach(function (attr) {
        var n = attr.name.toLowerCase();
        if (n.indexOf('on') === 0) el.removeAttribute(attr.name);
        else if (n === 'style' && /expression|javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
        else if (n === 'class' && attr.value.length > 120) el.removeAttribute('class'); // commonui 内部样式类过长无意义
      });
    });

    var imgs = frag.querySelectorAll('img');
    Array.prototype.forEach.call(imgs, function (img) {
      var lazy = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-echo');
      if (lazy) img.setAttribute('src', lazy);
      var src = img.getAttribute('src');
      if (src) img.setAttribute('src', absolutize(src, baseUrl));
      img.removeAttribute('width');
      img.removeAttribute('height');
      img.removeAttribute('onclick');
      img.classList.add('ngaw-img');
    });

    var links = frag.querySelectorAll('a');
    Array.prototype.forEach.call(links, function (a) {
      var href = a.getAttribute('href');
      if (href) a.setAttribute('href', absolutize(href, baseUrl));
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    });

    return frag;
  }

  // ====================================================================
  // 5. 适配层（防御性多候选选择器）
  // ====================================================================

  // 依次尝试候选选择器，返回第一个命中的元素
  function q1(root, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var el = null;
      try { el = root.querySelector(candidates[i]); } catch (e) { el = null; }
      if (el) { statHit(candidates[i]); return el; }
      statMiss(candidates[i]);
    }
    return null;
  }

  function qAll(root, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var list = null;
      try { list = root.querySelectorAll(candidates[i]); } catch (e) { list = null; }
      if (list && list.length) { statHit(candidates[i]); return Array.prototype.slice.call(list); }
      statMiss(candidates[i]);
    }
    return [];
  }

  // ---- 楼层提取（read.php，同时用于无限滚动拉取的下一页）----

  var POST_ROW_CANDIDATES = [
    '#m_posts [id^="postcontentandsubject"] [id^="postcontent"]',
    '#m_posts.c [id^="postcontentandsubject"] [id^="postcontent"]',
    '#m_posts [id^="postcontent"]',
    '#m_posts.c [id^="postcontent"]',
    '[id^="postcontentandsubject"]'
  ];

  var AUTHOR_LINK_CANDIDATES = [
    'a[href*="nuke.php?func=ucp&username"]',
    'a[href*="nuke.php?func=ucp&uid"]',
    '[id^="posterinfo"] a',
    '.posterinfo a'
  ];

  var TIME_RE = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T]*(\d{1,2}):(\d{2})/;
  var FLOOR_RE = /(\d+)\s*楼/;

  function parseTimeText(text) {
    var m = TIME_RE.exec(text || '');
    if (!m) return 0;
    var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
      parseInt(m[4], 10), parseInt(m[5], 10));
    var ts = Math.floor(d.getTime() / 1000);
    return isNaN(ts) ? 0 : ts;
  }

  // 找到内容节点所属的“楼层行”（向上爬到 m_posts 直系子节点为止）
  function postRowOf(el) {
    var cur = el;
    var wrap = el.closest ? (el.closest('#m_posts') || document.body) : null;
    while (cur && cur !== wrap) {
      var parent = cur.parentElement;
      if (parent && (parent.id === 'm_posts' || (/^m_posts/.test(parent.id || '') && parent.classList.contains('c')))) {
        return cur;
      }
      cur = parent;
    }
    return el.closest ? (el.closest('table') || el.parentElement) : el.parentElement;
  }

  // 提取楼层 -> [{ key, author, avatarUrl, floor, ts, subject, html }]
  function extractPosts(root, baseUrl) {
    var contents = qAll(root, POST_ROW_CANDIDATES);
    var posts = [];
    var seq = 0;

    contents.forEach(function (contentEl) {
      // 兜底选择器会把 postcontentandsubject 容器也匹配进来（同样以 postcontent 开头），跳过容器只要内容节点
      if (contentEl.id && contentEl.id.indexOf('postcontentandsubject') === 0) return;

      var row = postRowOf(contentEl) || contentEl.parentElement;
      var rowText = row ? (row.textContent || '') : '';

      // 作者
      var authorLink = null;
      for (var i = 0; i < AUTHOR_LINK_CANDIDATES.length && !authorLink; i++) {
        try { authorLink = row.querySelector(AUTHOR_LINK_CANDIDATES[i]); } catch (e) { authorLink = null; }
      }
      var author = authorLink ? (authorLink.textContent || '').trim() : '';
      if (!author) author = /匿名|Anonymous/i.test(rowText) ? '匿名' : '坛友';

      // 真实头像（未开启伪装时用）
      var avatarImg = null;
      try { avatarImg = row.querySelector('[id^="posterinfo"] img, .posterinfo img, td > a > img'); } catch (e) { avatarImg = null; }
      var avatarUrl = avatarImg && /^https?:/.test(avatarImg.getAttribute('src') || '') ? avatarImg.getAttribute('src') : '';

      // 楼层号
      var floorMatch = FLOOR_RE.exec(rowText);
      var floor = floorMatch ? parseInt(floorMatch[1], 10) : ++seq;

      // 标题（仅主楼通常带 postsubject）
      var subject = '';
      var idx = String(contentEl.id || '').replace(/^postcontent/, '');
      var subjectEl = null;
      try { subjectEl = row.querySelector('#postsubject' + idx + ', #postsubjectandsubject' + idx); } catch (e) { subjectEl = null; }
      if (subjectEl) subject = (subjectEl.textContent || '').trim();

      posts.push({
        key: 'f' + floor + '@' + (author || 'x') + '@' + posts.length,
        author: author,
        avatarUrl: avatarUrl,
        floor: floor,
        ts: parseTimeText(rowText),
        subject: subject,
        html: contentEl.innerHTML
      });
    });

    statCount('posts', posts.length);
    return posts;
  }

  // ---- 主题列表提取（thread.php / read.php 侧栏）----

  var THREAD_LINK_CANDIDATES = [
    '#m_threads a[id^="topic"]',
    '#m_threads a[href*="read.php?tid="]',
    '#m_threads.c a[href*="read.php?tid="]',
    'a[href*="read.php?tid="]'
  ];

  var BAD_LINK_TEXT = /^(附件|上一页|下一页|首页|末页|尾页|\.\.\.|«|»|next|prev)$/i;

  function extractThreadRows(root, baseUrl) {
    var links = qAll(root, THREAD_LINK_CANDIDATES);
    var threads = [];
    var seen = {};
    var curBase = baseUrl || (typeof location !== 'undefined' ? location.href : 'https://bbs.nga.cn/');

    links.forEach(function (a) {
      var title = (a.textContent || '').trim();
      if (!title || BAD_LINK_TEXT.test(title)) return;
      var href = a.getAttribute('href') || '';
      var tid = parseQueryParam(href, 'tid');
      if (!tid || seen[tid]) return;
      seen[tid] = 1;

      var row = a.closest('tr') || a.closest('table') || a.parentElement;
      var rowText = row ? (row.textContent || '') : title;

      var authorLink = null;
      for (var i = 0; i < AUTHOR_LINK_CANDIDATES.length && !authorLink; i++) {
        try { if (row) authorLink = row.querySelector(AUTHOR_LINK_CANDIDATES[i]); } catch (e) { authorLink = null; }
      }
      var author = authorLink ? (authorLink.textContent || '').trim() : '';
      if (!author) author = /匿名|Anonymous/i.test(rowText) ? '匿名' : '坛友';

      var rep = /(\d+)\s*(?:条回复|回复|评?论)/.exec(rowText);
      var replies = rep ? parseInt(rep[1], 10) : 0;

      threads.push({
        tid: tid,
        title: truncate(title, 40),
        author: author,
        replies: replies,
        ts: parseTimeText(rowText),
        href: absolutize(href, curBase)
      });
    });

    statCount('threads', threads.length);
    return threads;
  }

  // ---- 版块信息 ----

  function extractBoardInfo(root) {
    var link = q1(root, [
      '#m_nav a[href*="thread.php?fid="]:last-of-type',
      '#m_nav a[href*="thread.php?fid="]',
      '#breadcrumb a[href*="thread.php?fid="]',
      'a[href*="thread.php?fid="]'
    ]);
    if (!link) return null;
    var fid = parseQueryParam(link.getAttribute('href') || '', 'fid');
    if (!fid) return null;
    return { fid: fid, name: (link.textContent || '').trim() || '版块' };
  }

  // 首页版块链接集合（去重）
  function extractBoardLinks(root) {
    var links = [];
    try { links = Array.prototype.slice.call(root.querySelectorAll('a[href*="thread.php?fid="]')); } catch (e) { links = []; }
    var seen = {};
    var boards = [];
    links.forEach(function (a) {
      var name = (a.textContent || '').trim();
      var fid = parseQueryParam(a.getAttribute('href') || '', 'fid');
      if (!name || !fid || seen[fid] || name.length > 16) return;
      seen[fid] = 1;
      boards.push({ fid: fid, name: truncate(name, 14) });
      if (boards.length >= 80) return;
    });
    statCount('boards', boards.length);
    return boards;
  }

  // ---- 登录用户名识别（弱探测，失败则用设置面板手填）----

  function detectSelfName(root) {
    // NGA 页面自身的全局对象优先（防御性访问，不存在则跳过）
    try {
      if (typeof commonui !== 'undefined' && commonui.userInfo && commonui.userInfo.username) {
        var cu = String(commonui.userInfo.username).trim();
        if (cu && cu.length <= 20) return cu;
      }
    } catch (e) { /* 保守跳过 */ }
    var el = q1(root, ['#uame b', '#uame', '#mainmenu .block_txt', '#m_top .block_txt', 'a[href*="nuke.php?func=logout"] b']);
    if (el) {
      var name = (el.textContent || '').trim();
      if (name && name.length <= 20) return name;
    }
    return '';
  }

  // ---- 最大页码（分页链接扫描）----

  function maxPageOf(doc, tid) {
    var max = 1;
    var links = [];
    try { links = Array.prototype.slice.call(doc.querySelectorAll('a[href*="page="]')); } catch (e) { links = []; }
    links.forEach(function (a) {
      var h = a.getAttribute('href') || '';
      // 只统计指向当前主题的分页
      if (tid && h.indexOf('tid=' + tid) < 0 && h.indexOf('read.php') !== 0 && h.charAt(0) !== '&') return;
      var p = parseInt(parseQueryParam(h, 'page'), 10);
      if (p > max && p <= 2000) max = p;
    });
    return max;
  }

  // ====================================================================
  // 6. UI 壳层
  // ====================================================================

  var CSS = [
    'html.ngaw-on{overflow:hidden!important}',
    'html.ngaw-on body>*:not(.ngaw-root){display:none!important}',
    '.ngaw-root{position:fixed;inset:0;z-index:2147483000;display:flex;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;color:#191919;--nav:#2e2e2e;--list-bg:#fff;--panel:#fff;--chat-bg:#f5f5f5;--border:#e7e7e7;--sub:#999;--hover:#f2f2f2;--active:#e8f3ff;--bubble:#fff;--bubble-self:#cfe4ff;--quote-bg:#f7f7f7;--quote-fg:#666;--input-bg:#f2f2f2}',
    '.ngaw-root[data-theme="dark"]{--list-bg:#252525;--panel:#2b2b2b;--chat-bg:#1c1c1c;--border:#383838;--sub:#8a8a8a;--hover:#2f2f2f;--active:#153a5e;--bubble:#333;--bubble-self:#2b5f9e;--quote-bg:#222;--quote-fg:#9a9a9a;--input-bg:#333}',
    // ---- 左侧导航栏 ----
    '.ngaw-nav{width:56px;flex-shrink:0;background:var(--nav);display:flex;flex-direction:column;align-items:center;padding:14px 0 10px;gap:16px}',
    '.ngaw-nav .me{width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#0082ef,#005ed4);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600;user-select:none;cursor:default}',
    '.ngaw-nav button{width:38px;height:38px;border:none;background:transparent;color:#9c9c9c;border-radius:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:color .15s}',
    '.ngaw-nav button:hover{color:#fff}',
    '.ngaw-nav button.active{background:#0082ef;color:#fff}',
    '.ngaw-nav svg{width:21px;height:21px}',
    '.ngaw-nav .spacer{flex:1}',
    // ---- 中栏会话列表 ----
    '.ngaw-list{width:300px;flex-shrink:0;background:var(--list-bg);border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0}',
    '.ngaw-list header{height:56px;flex-shrink:0;padding:0 14px;display:flex;align-items:center;gap:10px}',
    '.ngaw-list h1{font-size:16px;font-weight:600;margin:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ngaw-search{display:flex;align-items:center;gap:6px;height:28px;border-radius:6px;background:var(--input-bg);color:var(--sub);font-size:12px;padding:0 10px;flex:1}',
    '.ngaw-search svg{width:13px;height:13px;flex-shrink:0}',
    '.ngaw-sessions{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:4px 0 12px}',
    '.ngaw-session{display:flex;gap:11px;padding:10px 13px;cursor:pointer;align-items:center}',
    '.ngaw-session:hover{background:var(--hover)}',
    '.ngaw-session.current{background:var(--active)}',
    '.ngaw-session .mid{flex:1;min-width:0}',
    '.ngaw-session .row1{display:flex;align-items:center;gap:6px}',
    '.ngaw-session .t{font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px}',
    '.ngaw-session .time{font-size:12px;color:var(--sub);flex-shrink:0}',
    '.ngaw-session .row2{display:flex;align-items:center;gap:6px;margin-top:3px}',
    '.ngaw-session .preview{flex:1;font-size:12px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ngaw-avatar{width:40px;height:40px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;user-select:none;overflow:hidden}',
    '.ngaw-avatar img{width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block}',
    '.ngaw-hint{padding:18px 16px;font-size:12px;color:var(--sub);line-height:1.8;text-align:center}',
    // ---- 右栏聊天区 ----
    '.ngaw-main{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--chat-bg)}',
    '.ngaw-chat-header{height:56px;flex-shrink:0;background:var(--panel);border-bottom:1px solid var(--border);padding:0 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}',
    '.ngaw-chat-header .title{font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ngaw-chat-header .sub{font-size:12px;color:var(--sub);flex-shrink:0}',
    '.ngaw-msgs{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:6px 0 14px}',
    '.ngaw-day{display:flex;justify-content:center;margin:10px 0 6px}',
    '.ngaw-day span{font-size:11px;color:#fff;background:rgba(0,0,0,.18);border-radius:8px;padding:2px 8px}',
    '.ngaw-msg{display:flex;gap:10px;padding:5px 20px;align-items:flex-start}',
    '.ngaw-msg.self{flex-direction:row-reverse}',
    '.ngaw-msg .body{max-width:62%;min-width:0;display:flex;flex-direction:column}',
    '.ngaw-msg.self .body{align-items:flex-end}',
    '.ngaw-msg .meta{font-size:12px;color:var(--sub);margin:0 6px 3px;display:flex;gap:6px;align-items:baseline}',
    '.ngaw-msg .meta .name{color:var(--sub)}',
    '.ngaw-msg .meta .floor{font-size:11px;opacity:.8}',
    '.ngaw-bubble{background:var(--bubble);border-radius:9px;padding:9px 13px;line-height:1.65;word-break:break-word;overflow-wrap:anywhere;font-size:14px}',
    '.ngaw-msg.self .ngaw-bubble{background:var(--bubble-self)}',
    '.ngaw-bubble .ngaw-subject{font-weight:600;margin-bottom:4px}',
    '.ngaw-bubble p{margin:0 0 .5em}',
    '.ngaw-bubble p:last-child{margin-bottom:0}',
    '.ngaw-bubble img.ngaw-img{max-width:min(420px,100%);max-height:400px;border-radius:6px;display:inline-block;margin:4px 0;cursor:zoom-in;vertical-align:middle}',
    '.ngaw-bubble a{color:#0082ef;text-decoration:none}',
    '.ngaw-bubble a:hover{text-decoration:underline}',
    '.ngaw-bubble .quote,.ngaw-bubble blockquote{border-left:3px solid #cfcfcf;background:var(--quote-bg);color:var(--quote-fg);padding:6px 10px;margin:6px 0;border-radius:4px;font-size:13px}',
    '.ngaw-bubble .quote .quote,.ngaw-bubble blockquote blockquote{margin:4px 0}',
    '.ngaw-bubble table{border-collapse:collapse;max-width:100%}',
    '.ngaw-bubble td,.ngaw-bubble th{border:1px solid var(--border);padding:3px 8px;font-size:13px}',
    '.ngaw-loadtip{display:flex;justify-content:center;padding:10px 0;font-size:12px;color:var(--sub)}',
    '.ngaw-empty{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--sub)}',
    '.ngaw-empty svg{width:52px;height:52px;opacity:.5}',
    '.ngaw-empty .big{font-size:15px;color:inherit}',
    // ---- 假输入栏 ----
    '.ngaw-inputbar{height:64px;flex-shrink:0;background:var(--panel);border-top:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:10px}',
    '.ngaw-inputbar input{flex:1;height:36px;border:none;border-radius:8px;background:var(--input-bg);padding:0 14px;font-size:13px;color:var(--sub);outline:none}',
    '.ngaw-inputbar .k{font-size:11px;color:var(--sub);flex-shrink:0}',
    // ---- 设置弹层 ----
    '.ngaw-pop{position:absolute;left:64px;bottom:16px;width:264px;background:var(--panel);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:14px 16px;display:none;flex-direction:column;gap:12px;color:#191919;z-index:10}',
    '.ngaw-root[data-theme="dark"] .ngaw-pop{color:#e6e6e6}',
    '.ngaw-pop.show{display:flex}',
    '.ngaw-pop h3{margin:0;font-size:14px}',
    '.ngaw-pop label{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px}',
    '.ngaw-pop select,.ngaw-pop input[type=text]{height:28px;border-radius:6px;border:1px solid var(--border);background:var(--input-bg);color:inherit;font-size:12px;padding:0 8px;max-width:140px}',
    '.ngaw-pop .btns{display:flex;gap:8px}',
    '.ngaw-pop button.act{flex:1;height:30px;border:none;border-radius:6px;background:#0082ef;color:#fff;font-size:12px;cursor:pointer}',
    '.ngaw-pop button.plain{flex:1;height:30px;border:1px solid var(--border);border-radius:6px;background:transparent;color:inherit;font-size:12px;cursor:pointer}',
    // ---- 灯箱 ----
    '.ngaw-lightbox{position:absolute;inset:0;background:rgba(0,0,0,.86);display:none;align-items:center;justify-content:center;z-index:20;overflow:hidden}',
    '.ngaw-lightbox.show{display:flex}',
    '.ngaw-lightbox img{max-width:92%;max-height:92%;border-radius:4px;transition:transform .08s linear}',
    '.ngaw-lightbox .tip{position:absolute;bottom:14px;left:0;right:0;text-align:center;color:rgba(255,255,255,.75);font-size:12px}',
    // ---- Toast ----
    '.ngaw-toast{position:absolute;right:20px;bottom:84px;background:rgba(0,0,0,.78);color:#fff;font-size:12px;border-radius:8px;padding:8px 14px;opacity:0;transition:opacity .25s;pointer-events:none;z-index:30}',
    '.ngaw-toast.show{opacity:1}',
    // ---- 滚动条 ----
    '.ngaw-sessions::-webkit-scrollbar,.ngaw-msgs::-webkit-scrollbar{width:6px}',
    '.ngaw-sessions::-webkit-scrollbar-thumb,.ngaw-msgs::-webkit-scrollbar-thumb{background:rgba(0,0,0,.18);border-radius:3px}',
    '.ngaw-root[data-theme="dark"] .ngaw-sessions::-webkit-scrollbar-thumb,.ngaw-root[data-theme="dark"] .ngaw-msgs::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18)}'
  ].join('\n');

  var ICONS = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    contacts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
  };

  function h(tag, cls, html) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  }

  var ROOT = null; // .ngaw-root 元素

  function injectCss() {
    var style = document.createElement('style');
    style.id = 'ngaw-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function buildShell() {
    ROOT = h('div', 'ngaw-root');
    ROOT.style.display = 'none'; // 内容就绪后再显示，避免空壳闪烁

    var nav = h('nav', 'ngaw-nav');
    var me = h('div', 'me', escapeHtml(firstChar(SETTINGS.selfName || '我')));
    me.title = '企业微信';
    nav.appendChild(me);

    var btnChat = h('button', 'active');
    btnChat.innerHTML = ICONS.chat;
    btnChat.title = '消息';
    btnChat.onclick = function () { location.href = '/index.php'; };

    var btnContacts = h('button');
    btnContacts.innerHTML = ICONS.contacts;
    btnContacts.title = '版块';
    btnContacts.onclick = function () { toggleBoardPanel(); };

    var spacer = h('div', 'spacer');
    var btnGear = h('button');
    btnGear.innerHTML = ICONS.gear;
    btnGear.title = '设置';
    btnGear.onclick = function () { toggleSettings(); };

    nav.appendChild(btnChat);
    nav.appendChild(btnContacts);
    nav.appendChild(spacer);
    nav.appendChild(btnGear);

    var list = h('section', 'ngaw-list');
    var listHeader = h('header', null, '<h1>消息</h1>');
    var search = h('div', 'ngaw-search', ICONS.search + '<span>搜索</span>');
    listHeader.appendChild(search);
    var sessions = h('div', 'ngaw-sessions');
    sessions.id = 'ngaw-sessions';
    sessions.innerHTML = '<div class="ngaw-hint">正在加载…</div>';
    list.appendChild(listHeader);
    list.appendChild(sessions);

    var main = h('main', 'ngaw-main');
    var chatHeader = h('div', 'ngaw-chat-header');
    chatHeader.id = 'ngaw-chat-header';
    var msgs = h('div', 'ngaw-msgs');
    msgs.id = 'ngaw-msgs';
    var inputbar = h('div', 'ngaw-inputbar');
    var input = document.createElement('input');
    input.disabled = true;
    input.placeholder = '只读模式，仅浏览';
    inputbar.appendChild(input);
    inputbar.appendChild(h('span', 'k', 'Alt+W 切回原版'));

    main.appendChild(chatHeader);
    main.appendChild(msgs);
    main.appendChild(inputbar);

    // 设置弹层
    var pop = h('div', 'ngaw-pop');
    pop.id = 'ngaw-pop';
    buildSettingsBody(pop);

    // 灯箱
    var lb = h('div', 'ngaw-lightbox');
    lb.id = 'ngaw-lightbox';
    var lbImg = document.createElement('img');
    lbImg.id = 'ngaw-lightbox-img';
    lb.appendChild(lbImg);
    lb.appendChild(h('div', 'tip', '滚轮缩放 · 点击或 Esc 关闭'));

    // Toast
    var toastEl = h('div', 'ngaw-toast');
    toastEl.id = 'ngaw-toast';

    ROOT.appendChild(nav);
    ROOT.appendChild(list);
    ROOT.appendChild(main);
    ROOT.appendChild(pop);
    ROOT.appendChild(lb);
    ROOT.appendChild(toastEl);
    document.body.appendChild(ROOT);

    setupLightbox(lb, lbImg);
    return ROOT;
  }

  function showRoot() {
    if (ROOT && SETTINGS.enabled) ROOT.style.display = '';
  }

  // ---- 主题 ----

  function applyTheme() {
    if (!ROOT) return;
    var theme = SETTINGS.theme;
    if (theme === 'auto') {
      try {
        theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch (e) { theme = 'light'; }
    }
    ROOT.dataset.theme = theme;
  }

  function watchSystemTheme() {
    try {
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
          if (SETTINGS.theme === 'auto') applyTheme();
        });
      }
    } catch (e) { /* 老浏览器忽略 */ }
  }

  // ---- 头像 / 消息 / 会话渲染 ----

  function avatarEl(name, url) {
    var d = h('div', 'ngaw-avatar');
    if (!SETTINGS.fakeAvatar && url) {
      var img = document.createElement('img');
      img.src = url;
      img.alt = '';
      d.appendChild(img);
    } else {
      d.textContent = firstChar(name);
      d.style.background = hashColor(name);
    }
    return d;
  }

  var lastDayKey = '';

  function msgEl(post, selfName) {
    var isSelf = !!selfName && post.author === selfName;
    var row = h('div', 'ngaw-msg' + (isSelf ? ' self' : ''));
    row.appendChild(avatarEl(post.author, post.avatarUrl));

    var body = h('div', 'body');
    var meta = h('div', 'meta');
    if (!isSelf) meta.appendChild(h('span', 'name', escapeHtml(truncate(post.author, 16))));
    meta.appendChild(h('span', 'floor', (post.ts ? relTime(post.ts) : '') + (post.floor ? ' · ' + post.floor + '楼' : '')));
    body.appendChild(meta);

    var bubble = h('div', 'ngaw-bubble');
    if (post.subject) bubble.appendChild(h('div', 'ngaw-subject', escapeHtml(truncate(post.subject, 60))));
    bubble.appendChild(sanitizeContent(post.html, location.href));
    body.appendChild(bubble);

    row.appendChild(body);
    return row;
  }

  function appendMessages(posts, selfName) {
    var box = document.getElementById('ngaw-msgs');
    if (!box) return 0;
    var sentinel = box.querySelector('.ngaw-sentinel');
    var n = 0;
    posts.forEach(function (p) {
      var el = msgEl(p, selfName);
      if (sentinel) box.insertBefore(el, sentinel);
      else box.appendChild(el);
      if (p.ts) {
        // 分隔线插在消息前
        var key = new Date(p.ts * 1000).toDateString();
        if (key !== lastDayKey) {
          lastDayKey = key;
          box.insertBefore(h('div', 'ngaw-day', '<span>' + escapeHtml(dayLabel(p.ts)) + '</span>'), el);
        }
      }
      n++;
    });
    return n;
  }

  function sessionEl(item, currentTid) {
    var s = h('div', 'ngaw-session' + (currentTid && item.tid === currentTid ? ' current' : ''));
    s.appendChild(avatarEl(item.author || item.name));
    var mid = h('div', 'mid');
    var row1 = h('div', 'row1');
    row1.appendChild(h('div', 't', escapeHtml(item.title || item.name)));
    if (item.ts) row1.appendChild(h('div', 'time', escapeHtml(relTime(item.ts))));
    var row2 = h('div', 'row2');
    var preview = item.replies ? (item.author + '：' + item.replies + ' 条回复') : (item.author || '');
    row2.appendChild(h('div', 'preview', escapeHtml(truncate(preview, 26))));
    mid.appendChild(row1);
    mid.appendChild(row2);
    s.appendChild(mid);
    s.onclick = function () {
      if (item.tid) location.href = '/read.php?tid=' + encodeURIComponent(item.tid);
      else if (item.fid) location.href = '/thread.php?fid=' + encodeURIComponent(item.fid);
    };
    return s;
  }

  function renderSessionList(items, currentTid, headerTitle) {
    var box = document.getElementById('ngaw-sessions');
    if (!box) return;
    box.innerHTML = '';
    if (headerTitle) {
      var h1 = ROOT ? ROOT.querySelector('.ngaw-list h1') : null;
      if (h1) h1.textContent = truncate(headerTitle, 12);
    }
    if (!items.length) {
      box.innerHTML = '<div class="ngaw-hint">没有抓到会话列表<br>运行 NGAWECOM.debug() 检查选择器命中</div>';
      return;
    }
    items.forEach(function (it) { box.appendChild(sessionEl(it, currentTid)); });
  }

  function renderChatHeader(title, sub) {
    var el = document.getElementById('ngaw-chat-header');
    if (!el) return;
    el.innerHTML = '';
    el.appendChild(h('div', 'title', escapeHtml(truncate(title || '加载中…', 30))));
    el.appendChild(h('div', 'sub', escapeHtml(sub || '')));
  }

  function renderEmptyMain(iconSvg, bigText, subText) {
    var msgs = document.getElementById('ngaw-msgs');
    if (!msgs) return;
    msgs.innerHTML = '';
    var empty = h('div', 'ngaw-empty', iconSvg +
      '<div class="big">' + escapeHtml(bigText) + '</div>' +
      '<div style="font-size:12px">' + escapeHtml(subText || '') + '</div>');
    msgs.appendChild(empty);
  }

  // ====================================================================
  // 7. 行为层
  // ====================================================================

  function routeOf(win) {
    var p = win.location.pathname;
    var s = win.location.search;
    if (/read\.php/.test(p) || /read\.php/.test(s)) return 'thread';
    if (/thread\.php|forumdisplay/.test(p + s)) return 'board';
    return 'home';
  }

  function waitFor(selector, timeout) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var el = null;
        try { el = document.querySelector(selector); } catch (e) { el = null; }
        if (el) return resolve(el);
        if (Date.now() - t0 > (timeout || WAIT_TIMEOUT)) return resolve(null);
        setTimeout(poll, 200);
      })();
    });
  }

  function fetchAndParse(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (html) {
      return new DOMParser().parseFromString(html, 'text/html');
    });
  }

  var SELF_NAME = '';

  // ---- read.php：帖子页 -> 聊天流 + 同版块会话列表 ----

  var SCROLL = { next: 2, max: 1, loading: false, lastFetch: 0, seen: {} };

  function initThreadPage() {
    var tid = parseQueryParam(location.search, 'tid');
    renderChatHeader('正在加载…', '');

    waitFor('#m_posts', WAIT_TIMEOUT / 2).then(function () {
      return waitFor('#m_posts [id^="postcontent"]', WAIT_TIMEOUT);
    }).then(function () {
      var posts = extractPosts(document, location.href);
      if (!posts.length) {
        DEBUG_STATS.phase = 'empty:thread';
        renderEmptyMain(ICONS.chat, '没有解析到楼层', 'F12 运行 NGAWECOM.debug() 查看选择器命中情况');
        showRoot();
        return;
      }

      // 标题：主楼 subject 或页面标题
      var title = posts[0].subject || cleanPageTitle(document.title);
      renderChatHeader(title, posts.length + '+ 条消息 · 只读');
      var box = document.getElementById('ngaw-msgs');
      if (box) box.innerHTML = '';
      lastDayKey = '';
      SCROLL.seen = {};
      posts.forEach(function (p) { if (p.floor > 0) SCROLL.seen[p.floor] = 1; });
      appendMessages(posts, SELF_NAME);
      appendSentinel();
      SCROLL.max = maxPageOf(document, tid);
      SCROLL.next = currentPage(location.href) + 1;
      setupInfiniteScroll(tid, title);
      DEBUG_STATS.phase = 'rendered:thread';
      showRoot();
    });

    // 侧栏：同版块主题列表
    var board = extractBoardInfo(document);
    if (board) {
      renderSessionList([], 0, board.name);
      fetchAndParse('/thread.php?fid=' + encodeURIComponent(board.fid)).then(function (doc) {
        var threads = extractThreadRows(doc, location.origin + '/');
        if (threads.length) renderSessionList(threads, tid, board.name);
        else renderSessionList([{ tid: tid, title: cleanPageTitle(document.title), author: '', ts: 0 }], tid, board.name);
      }).catch(function () {
        renderSessionList([{ tid: tid, title: cleanPageTitle(document.title), author: '', ts: 0 }], tid, board.name);
      });
    } else {
      renderSessionList([{ tid: tid, title: cleanPageTitle(document.title), author: '', ts: 0 }], tid, '');
    }
  }

  function cleanPageTitle(t) {
    return String(t || '').replace(/\s*[-_|–]\s*NGA.*$/i, '').replace(/_NGA玩家社区.*$/i, '').trim() || '会话';
  }

  function appendSentinel() {
    var box = document.getElementById('ngaw-msgs');
    if (!box || box.querySelector('.ngaw-sentinel')) return;
    var tip = h('div', 'ngaw-loadtip ngaw-sentinel', SCROLL.next <= SCROLL.max ? '上滑加载更多…' : '没有更多消息了');
    box.appendChild(tip);
  }

  function setupInfiniteScroll(tid) {
    var box = document.getElementById('ngaw-msgs');
    if (!box || SCROLL.next > SCROLL.max) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || SCROLL.loading) return;
        if (SCROLL.next > SCROLL.max) return;
        if (Date.now() - SCROLL.lastFetch < FETCH_MIN_INTERVAL) return;
        loadNextPage(tid);
      });
    }, { root: box, rootMargin: '400px' });
    var sentinel = box.querySelector('.ngaw-sentinel');
    if (sentinel) observer.observe(sentinel);
  }

  function loadNextPage(tid) {
    SCROLL.loading = true;
    SCROLL.lastFetch = Date.now();
    var url = buildPageUrl(location.pathname + location.search, SCROLL.next);
    var tip = document.querySelector('#ngaw-msgs .ngaw-sentinel');
    if (tip) tip.textContent = '正在加载…';

    fetchAndParse(url).then(function (doc) {
      var posts = extractPosts(doc, location.origin + '/');
      var fresh = posts.filter(function (p) {
        if (p.floor > 0 && SCROLL.seen[p.floor]) return false;
        if (p.floor > 0) SCROLL.seen[p.floor] = 1;
        return true;
      });
      SCROLL.next++;
      appendMessages(fresh, SELF_NAME);
      if (SCROLL.next > SCROLL.max) {
        if (tip) tip.textContent = '没有更多消息了';
      } else if (tip) {
        tip.textContent = '上滑加载更多…';
      }
      SCROLL.loading = false;
    }).catch(function () {
      SCROLL.loading = false;
      if (tip) tip.textContent = '加载失败，稍后重试…';
    });
  }

  // ---- thread.php：版块页 -> 会话列表 ----

  function initBoardPage() {
    var board = extractBoardInfo(document) || { fid: parseQueryParam(location.search, 'fid'), name: '版块' };
    waitFor('#m_threads', WAIT_TIMEOUT).then(function () {
      var threads = extractThreadRows(document, location.href);
      renderSessionList(threads, 0, board.name);
      DEBUG_STATS.phase = threads.length ? 'rendered:board' : 'empty:board';
    });
    renderChatHeader(board.name, '');
    renderEmptyMain(ICONS.chat, '选择左侧会话开始浏览', '点击主题查看楼层消息');
    showRoot();
  }

  // ---- index.php：首页 ----

  var BOARD_CACHE = null;

  function initHomePage() {
    var boards = extractBoardLinks(document);
    BOARD_CACHE = boards;
    renderSessionList(boards.map(function (b) { return { fid: b.fid, title: b.name, author: '', ts: 0, name: b.name }; }), 0, '版块');
    renderChatHeader('消息', '只读模式');
    renderEmptyMain(ICONS.doc, 'NGA 企微皮肤已启用', '从左侧选择版块开始浏览 · Alt+W 切回原版');
    DEBUG_STATS.phase = boards.length ? 'rendered:home' : 'empty:home';
    showRoot();
  }

  // 左栏“版块”按钮：会话区切换为版块快捷列表，再次点击还原
  var SESSIONS_BACKUP = null;

  function toggleBoardPanel() {
    var box = document.getElementById('ngaw-sessions');
    if (!box) return;
    if (box.dataset.mode === 'boards') {
      box.dataset.mode = '';
      if (SESSIONS_BACKUP != null) box.innerHTML = SESSIONS_BACKUP;
      return;
    }
    SESSIONS_BACKUP = box.innerHTML;
    var boards = BOARD_CACHE;
    var render = function (list) {
      box.dataset.mode = 'boards';
      box.innerHTML = '';
      box.appendChild(h('div', 'ngaw-hint', '版块导航（点击进入，再点左栏图标返回）'));
      list.slice(0, 50).forEach(function (b) {
        var it = { fid: b.fid, title: b.name, author: '', ts: 0 };
        box.appendChild(sessionEl(it, 0));
      });
    };
    if (boards && boards.length) render(boards);
    else fetchAndParse('/index.php').then(function (doc) {
      BOARD_CACHE = extractBoardLinks(doc);
      render(BOARD_CACHE);
    }).catch(function () { toast('版块列表加载失败'); });
  }

  // ---- 设置面板 ----

  function buildSettingsBody(pop) {
    pop.innerHTML = '';
    pop.appendChild(h('h3', null, '设置'));

    var themeRow = h('label', null, '外观');
    var sel = document.createElement('select');
    [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      if (SETTINGS.theme === o[0]) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = function () { SETTINGS.theme = sel.value; saveSettings(SETTINGS); applyTheme(); };
    themeRow.appendChild(sel);
    pop.appendChild(themeRow);

    var avatarRow = h('label', null, '伪装头像');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!SETTINGS.fakeAvatar;
    cb.onchange = function () { SETTINGS.fakeAvatar = cb.checked; saveSettings(SETTINGS); };
    avatarRow.appendChild(cb);
    pop.appendChild(avatarRow);

    var nameRow = h('label', null, '我的用户名');
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = '用于右侧气泡';
    inp.value = SETTINGS.selfName || '';
    inp.onchange = function () { SETTINGS.selfName = inp.value.trim(); saveSettings(SETTINGS); };
    nameRow.appendChild(inp);
    pop.appendChild(nameRow);

    var btns = h('div', 'btns');
    var toggleBtn = h('button', 'act', '切回原版 (Alt+W)');
    toggleBtn.onclick = function () { toggleEnabled(); };
    var closeBtn = h('button', 'plain', '关闭');
    closeBtn.onclick = function () { toggleSettings(); };
    btns.appendChild(toggleBtn);
    btns.appendChild(closeBtn);
    pop.appendChild(btns);
  }

  function toggleSettings() {
    var pop = document.getElementById('ngaw-pop');
    if (!pop) return;
    if (pop.classList.contains('show')) {
      pop.classList.remove('show');
    } else {
      buildSettingsBody(pop); // 重建以同步最新设置
      pop.classList.add('show');
    }
  }

  // ---- 灯箱 ----

  function setupLightbox(lb, lbImg) {
    var scale = 1;
    lb.addEventListener('click', function (e) {
      if (e.target === lbImg) return; // 点图片不关闭，便于拖动场景
      lb.classList.remove('show');
    });
    lb.addEventListener('wheel', function (e) {
      e.preventDefault();
      scale = clamp(scale * (e.deltaY < 0 ? 1.12 : 0.89), 0.25, 5);
      lbImg.style.transform = 'scale(' + scale + ')';
    }, { passive: false });
    document.addEventListener('click', function (e) {
      var img = e.target;
      if (img && img.classList && img.classList.contains('ngaw-img')) {
        scale = 1;
        lbImg.style.transform = 'scale(1)';
        lbImg.src = img.src;
        lb.classList.add('show');
      }
    });
  }

  // ---- Toast ----

  var TOAST_TIMER = null;
  function toast(text) {
    var el = document.getElementById('ngaw-toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    if (TOAST_TIMER) clearTimeout(TOAST_TIMER);
    TOAST_TIMER = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  // ====================================================================
  // 8. 伪装层 + 总开关
  // ====================================================================

  var ORIG_TITLE = null;
  var ORIG_FAVICON = null;

  function applyDisguise(on) {
    if (on) {
      if (ORIG_TITLE === null) ORIG_TITLE = document.title;
      document.title = WECOM_TITLE;
      var link = document.querySelector("link[rel*='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        (document.head || document.documentElement).appendChild(link);
      }
      if (ORIG_FAVICON === null) ORIG_FAVICON = link.getAttribute('href') || '';
      link.setAttribute('href', FAVICON_DATAURI);
      document.documentElement.classList.add('ngaw-on');
      if (ROOT) ROOT.style.display = '';
    } else {
      document.title = ORIG_TITLE != null ? ORIG_TITLE : document.title;
      var l = document.querySelector("link[rel*='icon']");
      if (l && ORIG_FAVICON) l.setAttribute('href', ORIG_FAVICON);
      document.documentElement.classList.remove('ngaw-on');
      if (ROOT) ROOT.style.display = 'none';
    }
  }

  function toggleEnabled() {
    SETTINGS.enabled = !SETTINGS.enabled;
    saveSettings(SETTINGS);
    applyDisguise(SETTINGS.enabled);
    toast(SETTINGS.enabled ? '已切换到企业微信视图' : '已切回 NGA 原版（Alt+W 返回）');
  }

  function setupShortcuts() {
    document.addEventListener('keydown', function (e) {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && (e.key === 'w' || e.key === 'W' || e.code === 'KeyW')) {
        e.preventDefault();
        toggleEnabled();
      }
      if (e.key === 'Escape') {
        var lb = document.getElementById('ngaw-lightbox');
        if (lb && lb.classList.contains('show')) lb.classList.remove('show');
        var pop = document.getElementById('ngaw-pop');
        if (pop && pop.classList.contains('show')) pop.classList.remove('show');
      }
    });
  }

  // ====================================================================
  // 导出（Node 测试用）与启动
  // ====================================================================

  var EXPORTS = {
    VERSION: VERSION,
    relTime: relTime,
    dayLabel: dayLabel,
    hashColor: hashColor,
    firstChar: firstChar,
    escapeHtml: escapeHtml,
    truncate: truncate,
    absolutize: absolutize,
    parseQueryParam: parseQueryParam,
    currentPage: currentPage,
    buildPageUrl: buildPageUrl,
    clamp: clamp,
    isGuestWallText: isGuestWallText,
    parseTimeText: parseTimeText,
    cleanPageTitle: cleanPageTitle
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;

  function boot() {
    DEBUG_STATS.phase = 'boot';
    SETTINGS = loadSettings();
    injectCss();
    buildShell();
    applyTheme();
    watchSystemTheme();
    setupShortcuts();
    DEBUG_STATS.phase = 'ready';

    SELF_NAME = (SETTINGS.selfName || '').trim();
    if (!SELF_NAME) SELF_NAME = detectSelfName(document);

    // 登录墙/错误页：不激活伪装，让用户看到原生提示去登录
    var bodyHead = document.body ? (document.body.textContent || '').slice(0, 500) : '';
    if (isGuestWallText(document.title, bodyHead)) {
      DEBUG_STATS.phase = 'skip:guest-wall';
      if (window.console) console.info('[nga-wecom] 检测到访客限制页，未激活。登录后刷新页面即可。');
      return;
    }

    if (!SETTINGS.enabled) {
      DEBUG_STATS.phase = 'skip:disabled';
      if (window.console) console.info('[nga-wecom] 皮肤当前为关闭状态，按 Alt+W 开启。');
      applyDisguise(false);
      return;
    }

    var route = routeOf(location);
    DEBUG_STATS.phase = 'route:' + route;
    if (route === 'thread') initThreadPage();
    else if (route === 'board') initBoardPage();
    else initHomePage();
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // 元素签名：tag#id.class1.class2（取前 3 个 class）
    function describeEl(el) {
      if (!el || !el.tagName) return null;
      var s = el.tagName.toLowerCase();
      if (el.id) s += '#' + el.id;
      var cls = el.getAttribute ? (el.getAttribute('class') || '') : '';
      if (cls) s += '.' + cls.trim().split(/\s+/).slice(0, 3).join('.');
      return s;
    }

    var PROBE_TARGETS = ['#m_posts', '#m_threads', '#m_nav', '#mainmenu', '#m_top', '#m_ct', 'body'];

    window.NGAWECOM = {
      version: VERSION,
      stats: DEBUG_STATS,
      toggle: function () { toggleEnabled(); },
      // 一眼诊断：流程相位 / 开关状态 / 路由 / 容器存在性
      debug: function () {
        var info = {
          version: VERSION,
          phase: DEBUG_STATS.phase,
          enabled: SETTINGS ? SETTINGS.enabled : null,
          route: routeOf(location),
          url: location.href,
          pageTitle: document.title,
          hasPostsContainer: !!document.querySelector('#m_posts'),
          hasThreadsContainer: !!document.querySelector('#m_threads'),
          selectorHits: DEBUG_STATS.hits,
          extractCounts: DEBUG_STATS.counts
        };
        if (window.console) console.log('[nga-wecom] 诊断信息:', info);
        return info;
      },
      // 选择器命中数 + 关键容器前 8 个子元素结构采样，用于远程校准适配层
      probe: function () {
        var out = { selectors: {}, structure: {} };
        var sets = {
          posts: POST_ROW_CANDIDATES,
          threads: THREAD_LINK_CANDIDATES,
          authorLinks: AUTHOR_LINK_CANDIDATES
        };
        Object.keys(sets).forEach(function (k) {
          out.selectors[k] = {};
          sets[k].forEach(function (sel) {
            try { out.selectors[k][sel] = document.querySelectorAll(sel).length; }
            catch (e) { out.selectors[k][sel] = 'ERR'; }
          });
        });
        PROBE_TARGETS.forEach(function (sel) {
          var el = null;
          try { el = document.querySelector(sel); } catch (e) { el = null; }
          out.structure[sel] = el ? Array.prototype.slice.call(el.children, 0, 8).map(describeEl) : null;
        });
        if (window.console) {
          console.log('[nga-wecom] probe：selectors=候选选择器命中数，structure=容器前 8 个子元素签名');
          console.log(JSON.stringify(out, null, 2));
        }
        return out;
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})();
