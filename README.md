# nga-wecom — NGA 企微皮肤

把 [NGA 玩家社区](https://bbs.nga.cn) 的网页版伪装成**企业微信 5.x 桌面客户端**的油猴（Tampermonkey）用户脚本。

灵感来自 [samsamsue/wecom_v2linuxdo](https://github.com/samsamsue/wecom_v2linuxdo)（Linux.do / V2EX / 掘金版），本项目把同样的思路带到 NGA。

> **范围：登录态只读浏览。** 只做"看"，不做回复、评分、收藏、签到等任何写操作。

## 功能

- **三栏企微布局**：左侧深色图标导航 + 中间会话列表（300px）+ 右侧聊天窗口
- **页面映射**：
  | NGA 页面 | 企微形态 |
  |---|---|
  | `index.php` 首页 | 左栏 + 版块列表（中栏）+ 欢迎屏 |
  | `thread.php?fid=X` 版块 | 中栏 = 主题会话列表 |
  | `read.php?tid=X` 帖子 | 中栏 = 同版块主题（高亮当前），右栏 = 楼层消息流 |
- **楼层 → 气泡**：自己的发言浅蓝气泡居右（按用户名匹配），他人白色居左；NGA 匿名帖天然像群聊
- **无限滚动**：滚动到底自动 fetch 下一页拼接（间隔 ≥800ms，降低风控风险）
- **一键保命**：`Alt+W` 毫秒级切换企微视图 / NGA 原版
- **伪装**：标签页标题改为"企业微信"、favicon 替换为企微风格图标
- **伪装头像**：姓名首字符 + 稳定哈希配色，防止旁人窥屏
- **深浅色**：跟随系统 / 手动切换
- **图片灯箱**：点击图片放大，滚轮 25%~500% 缩放，Esc 关闭

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（篡改猴）或 Violentmonkey（暴力猴）
2. Tampermonkey 面板 → 添加新脚本 → 把 [`nga-wecom.user.js`](nga-wecom.user.js) 全部内容粘贴进去 → 保存
3. 打开 [bbs.nga.cn](https://bbs.nga.cn) 并**确保已登录**，自动生效

匹配域名：`bbs.nga.cn` / `nga.178.com` / `ngabbs.com`

## 使用

- **选版块**（三个入口）：
  - 左栏第二个图标（通讯录样式）：任意页面打开版块导航，再点一次或点面板顶部"返回会话列表"还原
  - 会话列表顶部的蓝色"浏览全部版块"条目（版块页/帖子页固定显示）
  - 打开首页（bbs.nga.cn 根路径）：中栏直接列出全部版块
- 点击中栏会话（主题）→ 右栏打开楼层消息流
- 左栏齿轮 → 设置：外观、伪装头像、**我的用户名**（填你的 NGA 用户名，自己的楼层才会靠右）
- `Alt+W` 随时切回原版；`Esc` 关闭灯箱/弹层
- 检测到"访客不能直接访问"登录墙时不会激活，登录后刷新即可

## 选择器校准流程（重要）

NGA 对未登录请求完全拦截，本脚本的选择器基于社区已知的稳定 DOM 结构编写，采用**多候选防御性匹配**（每个提取点有 2~5 组候选选择器逐级回退）。如果装好后某些区域为空或页面没变化：

1. `F12` 打开控制台，运行 `NGAWECOM.debug()`
   - `phase` 显示启动流程停在哪一步：`skip:disabled` = 皮肤被关闭（按 `Alt+W` 开启）；`skip:guest-wall` = 误判登录墙；`route:*` / `rendered:*` = 正常进入对应页面
   - `extractCounts` 里 `posts=0` 说明楼层提取没命中，`threads=0` 说明主题列表没命中
2. 再运行 `NGAWECOM.probe()`
   - `selectors`：各组候选选择器在当前页面的命中数量
   - `structure`：`#m_posts` / `#m_threads` 等容器前 8 个子元素的 `tag#id.class` 签名——把这段 JSON 贴给维护者即可远程校准
3. 自己修的话：在 `nga-wecom.user.js` 顶部搜索对应常量（如 `POST_ROW_CANDIDATES`、`THREAD_LINK_CANDIDATES`），把真实选择器加到候选列表**最前面**
4. 保存后刷新页面

## 开发

```bash
node --check nga-wecom.user.js   # 语法校验
node --test tests/               # 纯函数单元测试（17 项）
```

脚本顶层无任何 DOM 引用，可直接被 Node `require`，纯工具层（时间/配色/URL/解析）全部有测试覆盖。

## 已知限制

- 只读：不支持回帖、评分、收藏、搜索
- 未登录页/登录墙不激活
- 极老浏览器不支持（用了 `closest` / `template` / `URL` / `IntersectionObserver`）
- 设置保存在浏览器 localStorage，清缓存即重置

## Roadmap（不在当前范围）

- 会话列表宽度拖拽、未读标记
- 引用气泡内的"跳转到原楼层"
- 楼层内视频/投票的更好呈现
- `meta.js` 自动更新与发布脚本

## 声明

本项目仅为个人学习与前端样式定制，**不提供企业微信服务，亦不隶属于或代表腾讯公司**。所有数据交互只发生在你自己的浏览器与 NGA 之间，不经过任何第三方。请遵守 NGA 社区规则，摸鱼有度。

## License

[MIT](LICENSE)
