// 纯函数单元测试：node --test tests/
// nga-wecom.user.js 顶层无 DOM 引用，Node 可直接 require
const test = require('node:test');
const assert = require('node:assert');
const m = require('../nga-wecom.user.js');

// ---------- relTime / dayLabel ----------

function tsOf(y, mo, d, h, mi) {
  return Math.floor(new Date(y, mo - 1, d, h, mi, 0).getTime() / 1000);
}

test('relTime: 同一天显示 HH:mm', () => {
  const now = tsOf(2026, 9, 30, 18, 0);
  assert.strictEqual(m.relTime(tsOf(2026, 9, 30, 9, 5), now), '09:05');
  assert.strictEqual(m.relTime(tsOf(2026, 9, 30, 23, 59), now), '23:59');
});

test('relTime: 昨天显示 昨天', () => {
  const now = tsOf(2026, 9, 30, 18, 0);
  assert.strictEqual(m.relTime(tsOf(2026, 9, 29, 23, 0), now), '昨天');
  // 跨月边界
  assert.strictEqual(m.relTime(tsOf(2026, 9, 30, 0, 1), tsOf(2026, 10, 1, 12, 0)), '昨天');
});

test('relTime: 同年显示 M月D日，跨年显示完整日期', () => {
  const now = tsOf(2026, 9, 30, 18, 0);
  assert.strictEqual(m.relTime(tsOf(2026, 5, 1, 10, 0), now), '5月1日');
  assert.strictEqual(m.relTime(tsOf(2025, 12, 31, 10, 0), now), '2025-12-31');
});

test('relTime: 无效时间返回空串', () => {
  assert.strictEqual(m.relTime(0), '');
  assert.strictEqual(m.relTime(-1), '');
});

test('dayLabel: 今天/昨天带时刻', () => {
  const now = tsOf(2026, 9, 30, 18, 0);
  assert.strictEqual(m.dayLabel(tsOf(2026, 9, 30, 9, 5), now), '今天 09:05');
  assert.strictEqual(m.dayLabel(tsOf(2026, 9, 29, 9, 5), now), '昨天 09:05');
});

// ---------- hashColor / firstChar ----------

test('hashColor: 确定性且格式正确', () => {
  const a = m.hashColor('Anonymous.12345');
  assert.strictEqual(a, m.hashColor('Anonymous.12345'));
  assert.match(a, /^hsl\(\d+,58%,52%\)$/);
  // 不同名字大概率不同色相
  const colors = new Set(Array.from({ length: 40 }, (_, i) => m.hashColor('user' + i)));
  assert.ok(colors.size > 10, '配色应具有区分度');
});

test('firstChar: 取首字符，空值兜底', () => {
  assert.strictEqual(m.firstChar('张三'), '张');
  assert.strictEqual(m.firstChar(' wangyi '), 'W');
  assert.strictEqual(m.firstChar(''), '?');
  assert.strictEqual(m.firstChar(null), '?');
});

// ---------- escapeHtml / truncate ----------

test('escapeHtml: 转义五个危险字符', () => {
  assert.strictEqual(m.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.strictEqual(m.escapeHtml(null), '');
});

test('truncate: 截断加省略号，压缩空白', () => {
  assert.strictEqual(m.truncate('abcdefghij', 5), 'abcde…');
  assert.strictEqual(m.truncate('abc', 5), 'abc');
  assert.strictEqual(m.truncate('a  b\n\nc', 10), 'a b c');
});

// ---------- absolutize ----------

test('absolutize: 相对路径基于当前页解析', () => {
  assert.strictEqual(
    m.absolutize('./mon_202407/01/abc.png', 'https://bbs.nga.cn/read.php?tid=123'),
    'https://bbs.nga.cn/mon_202407/01/abc.png'
  );
  assert.strictEqual(
    m.absolutize('/att/x.png', 'https://bbs.nga.cn/read.php?tid=123&page=2'),
    'https://bbs.nga.cn/att/x.png'
  );
});

test('absolutize: 绝对/data/协议相对 URL 原样通过', () => {
  assert.strictEqual(m.absolutize('https://img.nga.178.com/a.png', 'https://bbs.nga.cn/x'), 'https://img.nga.178.com/a.png');
  assert.strictEqual(m.absolutize('data:image/png;base64,xxx', 'https://bbs.nga.cn/'), 'data:image/png;base64,xxx');
  assert.strictEqual(m.absolutize('//img.nga.178.com/a.png', 'https://bbs.nga.cn/'), 'https://img.nga.178.com/a.png');
  assert.strictEqual(m.absolutize('#anchor', 'https://bbs.nga.cn/read.php'), '#anchor');
  assert.strictEqual(m.absolutize('', 'https://bbs.nga.cn/'), '');
  assert.strictEqual(m.absolutize(null), null);
});

// ---------- parseQueryParam / currentPage / buildPageUrl ----------

test('parseQueryParam: 常规与编码取值', () => {
  assert.strictEqual(m.parseQueryParam('read.php?tid=123&page=2', 'tid'), '123');
  assert.strictEqual(m.parseQueryParam('read.php?tid=123&page=2', 'page'), '2');
  assert.strictEqual(m.parseQueryParam('read.php?tid=123', 'page'), '');
  assert.strictEqual(m.parseQueryParam('nuke.php?username=%E5%BC%A0%E4%B8%89', 'username'), '张三');
  assert.strictEqual(m.parseQueryParam('', 'tid'), '');
});

test('currentPage: 缺省为 1', () => {
  assert.strictEqual(m.currentPage('read.php?tid=1&page=3'), 3);
  assert.strictEqual(m.currentPage('read.php?tid=1'), 1);
  assert.strictEqual(m.currentPage('read.php?tid=1&page=abc'), 1);
});

test('buildPageUrl: 新增或替换 page 参数', () => {
  assert.strictEqual(m.buildPageUrl('read.php?tid=1', 2), 'read.php?tid=1&page=2');
  assert.strictEqual(m.buildPageUrl('read.php?tid=1&page=2', 3), 'read.php?tid=1&page=3');
  assert.strictEqual(m.buildPageUrl('thread.php?fid=200', 10), 'thread.php?fid=200&page=10');
});

// ---------- parseTimeText / cleanPageTitle ----------

test('parseTimeText: NGA 时间文本解析', () => {
  assert.strictEqual(m.parseTimeText('发表于 2026-09-30 12:34:56'), tsOf(2026, 9, 30, 12, 34));
  assert.strictEqual(m.parseTimeText('2026/9/1 8:05'), tsOf(2026, 9, 1, 8, 5));
  assert.strictEqual(m.parseTimeText('没有时间'), 0);
});

test('cleanPageTitle: 去掉 NGA 站名后缀', () => {
  assert.strictEqual(m.cleanPageTitle('某个主题标题_NGA玩家社区'), '某个主题标题');
  assert.strictEqual(m.cleanPageTitle('某主题 - NGA玩家社区'), '某主题');
  assert.strictEqual(m.cleanPageTitle('普通标题'), '普通标题');
});

// ---------- clamp ----------

test('clamp: 边界约束（灯箱缩放用）', () => {
  assert.strictEqual(m.clamp(0.3, 0.25, 5), 0.3);
  assert.strictEqual(m.clamp(0.1, 0.25, 5), 0.25);
  assert.strictEqual(m.clamp(9, 0.25, 5), 5);
});

// ---------- routeOf ----------

test('routeOf: 按 pathname/search 判定页面类型（v0.1.2 修复入参为 location 对象）', () => {
  assert.strictEqual(m.routeOf({ pathname: '/read.php', search: '?tid=123&page=2' }), 'thread');
  assert.strictEqual(m.routeOf({ pathname: '/thread.php', search: '?fid=200' }), 'board');
  assert.strictEqual(m.routeOf({ pathname: '/index.php', search: '' }), 'home');
  assert.strictEqual(m.routeOf({ pathname: '/', search: '' }), 'home');
});

// ---------- isBadThreadLinkText ----------

test('isBadThreadLinkText: 过滤翻页与纯数字页码链接', () => {
  assert.strictEqual(m.isBadThreadLinkText('2'), true);
  assert.strictEqual(m.isBadThreadLinkText('12'), true);
  assert.strictEqual(m.isBadThreadLinkText('下一页'), true);
  assert.strictEqual(m.isBadThreadLinkText('...'), true);
  assert.strictEqual(m.isBadThreadLinkText('【讨论】正常的主题标题'), false);
  assert.strictEqual(m.isBadThreadLinkText(''), true);
});

// ---------- decodeHtmlBuffer ----------

test('decodeHtmlBuffer: GB 字节按 GB18030 解码（NGA 响应无 charset 头）', () => {
  // '张' 的 GBK/GB18030 编码为 0xD5 0xC5
  const gbk = Buffer.from([0xd5, 0xc5]);
  assert.strictEqual(m.decodeHtmlBuffer(gbk), '张');
});

test('decodeHtmlBuffer: meta 声明 utf-8 时按 utf-8 解码', () => {
  // '你' 的 UTF-8 编码为 0xE4 0xBD 0xA0
  const utf8 = Buffer.concat([
    Buffer.from('<meta charset="utf-8">'),
    Buffer.from([0xe4, 0xbd, 0xa0])
  ]);
  assert.strictEqual(m.decodeHtmlBuffer(utf8), '<meta charset="utf-8">你');
});

// ---------- looksLikeBbcode / renderBbcode ----------

test('looksLikeBbcode: 识别原始 BBCode', () => {
  assert.strictEqual(m.looksLikeBbcode('[quote][pid=1,2,3]Reply[/pid][/quote]'), true);
  assert.strictEqual(m.looksLikeBbcode('[b]bold[/b]'), true);
  assert.strictEqual(m.looksLikeBbcode('[img]./mon_x.png[/img]'), true);
  assert.strictEqual(m.looksLikeBbcode('普通已渲染文本，无标签'), false);
});

test('renderBbcode: 引用头元数据转为链接（用户实测样例）', () => {
  const out = m.renderBbcode('[quote][pid=883366224,47641935,2]Reply[/pid] [b]Post by [uid=346237]rinoa360[/uid] (2026-09-30 15:56):[/b]\n黄果居然有iPhone的版本[/quote]');
  assert.ok(out.includes('class="quote"'), '应有引用块');
  assert.ok(out.includes('href="/read.php?pid=883366224"'), 'pid 应转原帖链接');
  assert.ok(out.includes('href="/nuke.php?func=ucp&amp;uid=346237"'), 'uid 应转用户链接');
  assert.ok(out.includes('<strong>Post by'), '粗体生效');
  assert.ok(out.includes('rinoa360'), '用户名保留');
  assert.ok(out.includes('黄果居然有iPhone的版本'), '内容保留');
});

test('renderBbcode: 嵌套 quote 逐层展开', () => {
  const out = m.renderBbcode('[quote]外层[quote]内层[/quote]继续[/quote]');
  assert.strictEqual(out.split('class="quote"').length - 1, 2);
});

test('renderBbcode: 图片/链接/表情/代码块', () => {
  const out = m.renderBbcode('[img]./mon_202407/abc.png[/img][url=https://a.com]文字[/url][s:ac:哭]哈哈[code]int x = 1;[/code]');
  assert.ok(out.includes('<img src="./mon_202407/abc.png"'));
  assert.ok(out.includes('href="https://a.com"'));
  assert.ok(out.includes('ngaw-emo'));
  assert.ok(out.includes('ngaw-code'));
  assert.ok(out.includes('int x = 1;'));
});

test('renderBbcode: HTML 注入被转义', () => {
  const out = m.renderBbcode('[quote]<script>alert(1)<\/script>[/quote]');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('renderBbcode: color 走白名单，非法值丢弃样式', () => {
  assert.ok(m.renderBbcode('[color=red]红[/color]').includes('color:red'));
  assert.ok(!m.renderBbcode('[color=expression(alert(1))]x[/color]').includes('expression'));
  assert.ok(m.renderBbcode('[size=5]大[/size]').includes('font-size:18px'));
});

// ---------- cleanThreadTitle ----------

test('cleanThreadTitle: 去 BBCode/表情/前缀标签残留并压缩空白', () => {
  assert.strictEqual(m.cleanThreadTitle('[s:ac:哭] 问一下什么才叫真正的顶美？'), '问一下什么才叫真正的顶美？');
  assert.strictEqual(m.cleanThreadTitle('[讨论]  关于新版本\n  的一些看法'), '关于新版本 的一些看法');
  assert.strictEqual(m.cleanThreadTitle('[img]./mon_2024/abc.png[/img]纯标题'), '纯标题');
  assert.strictEqual(m.cleanThreadTitle('  '), '');
  assert.strictEqual(m.cleanThreadTitle(null), '');
});

// ---------- isGuestWallText ----------

test('isGuestWallText: 只认精确登录墙标志', () => {
  // 拦截页：标题或正文含精确文案
  assert.strictEqual(m.isGuestWallText('访客不能直接访问', '(ERROR:15) 访客不能直接访问'), true);
  assert.strictEqual(m.isGuestWallText('访客不能直接访问', ''), true);
  assert.strictEqual(m.isGuestWallText('NGA玩家社区', '正文……访客不能直接访问……后续'), true);
  // 正常页面：泛化登录文案不再误伤（v0.1.1 收紧）
  assert.strictEqual(m.isGuestWallText('NGA玩家社区', '请在登录后进行操作'), false);
  assert.strictEqual(m.isGuestWallText('某主题_NGA玩家社区', '大量正常正文内容'), false);
  assert.strictEqual(m.isGuestWallText('', ''), false);
});
