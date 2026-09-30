# nga-wecom — NGA 企微皮肤

把 [NGA 玩家社区](https://bbs.nga.cn) 的网页版伪装成**企业微信桌面客户端**的油猴（Tampermonkey）用户脚本。

灵感来自 [samsamsue/wecom_v2linuxdo](https://github.com/samsamsue/wecom_v2linuxdo)（Linux.do / V2EX / 掘金版），本项目把同样的思路带到 NGA。

> **范围：登录态只读浏览。** 只做"看"，不做回复、评分、收藏、签到等任何写操作。

## 功能

- **三栏企微布局**：左侧深色图标导航 + 中间会话列表（300px）+ 右侧聊天窗口，深浅色跟随系统
- **页面映射**：
  | NGA 页面 | 企微形态 |
  |---|---|
  | `index.php` 首页 | 左栏 + 版块列表（中栏）+ 欢迎屏 |
  | `thread.php?fid=X` 版块 | 中栏 = 主题会话列表（**无限滚动翻页**，置顶/公告自动过滤） |
  | `read.php?tid=X` 帖子 | 中栏 = 同版块主题（高亮当前），右栏 = 楼层消息流 |
- **楼层 → 气泡**：自己的发言浅蓝居右（设置里填用户名），他人白色居左；日期分割线、楼层号；**无限滚动**自动拼接后续页
- **BBCode 完整渲染**：引用（统一"回复人：内容"紧凑灰条）、图片、链接、粗斜删、颜色/字号、代码块、列表、视频链接——fetch 拉取的页面同样正确渲染（GB18030 编码处理）
- **NGA 表情真实显示**：ac/a2/pst/dt/pg 五系列约 200 个表情字典映射（字典源 [EVAyo/ngapost2md](https://github.com/EVAyo/ngapost2md)），未知表情回落占位符
- **附件图片正确处理**：`data-srclazy` 懒加载提升、`./mon_` 附件路径映射附件站、剥离 NGA 微缩内联样式
- **头像体系**：版块条目用 NGA 真实版块图标（404 回落默认头像），帖子条目用 DiceBear identicon **本地生成**（零第三方请求），楼层首字符配色占位
- **一键保命**：`Alt+W` 毫秒级切换企微视图 / NGA 原版
- **伪装**：标签页标题"企业微信"（含防 NGA 脚本改回的守护）、favicon 替换、document-start 早期隐藏原生页（跳转不闪现原版）
- **图片灯箱**：点击图片放大，滚轮 25%~500% 缩放，Esc 关闭
- 登录墙检测（"访客不能直接访问"）自动不激活

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（篡改猴）或 Violentmonkey（暴力猴）
2. 点击安装链接：**[nga-wecom.user.js](https://github.com/yuanfang9527/nga-wecom/raw/main/nga-wecom.user.js)**（或手动：Tampermonkey → 添加新脚本 → 粘贴仓库中 `nga-wecom.user.js` 全部内容 → 保存）
3. 打开 [bbs.nga.cn](https://bbs.nga.cn) 并**确保已登录**，自动生效

已装用户会通过 `@updateURL` 自动收到后续更新。

匹配域名：`bbs.nga.cn` / `nga.178.com` / `ngabbs.com`

## 使用

- **选版块**（三个入口）：左栏第二个图标（任意页面打开版块导航）/ 会话列表顶部蓝色"浏览全部版块"条目 / 打开首页直接列出全部版块
- 点击中栏会话（主题）→ 右栏打开楼层消息流；版块列表与帖子均支持滚动到底自动加载
- 左栏齿轮 → 设置：外观（跟随系统/浅色/深色）、伪装头像、**我的用户名**（填你的 NGA 用户名，自己的楼层才会靠右）
- `Alt+W` 随时切回原版；`Esc` 关闭灯箱/弹层

## 选择器校准流程

NGA 对未登录请求完全拦截，适配层的多数选择器已经过登录态实测校准（`tr.topicrow` 主题行、`data-srclazy` 图片懒加载、`div.quote` 引用块等）。如果某类页面解析异常：

1. `F12` 运行 `NGAWECOM.debug()`——`phase` 显示启动流程相位，`extractCounts` 显示各提取器产出
2. 再运行 `NGAWECOM.probe()`——输出候选选择器命中数、关键容器结构采样、主题行/引用块/主贴原始 HTML、链接模式统计
3. 把 JSON 贴到 [Issues](https://github.com/yuanfang9527/nga-wecom/issues) 即可远程定位

## 已知限制

- 只读：不支持回帖、评分、收藏、搜索
- 未登录页/登录墙不激活
- 极老浏览器不支持（`closest` / `template` / `URL` / `IntersectionObserver`）
- 设置保存在浏览器 localStorage，清缓存即重置

## Roadmap

- 未读标记、会话列表宽度拖拽
- 引用跳转（企微视图内定位原楼层）
- 楼层真实头像（关闭伪装头像时）

## 开发

```bash
node --check nga-wecom.user.js   # 语法校验
node --test tests/               # 纯函数单元测试（36 项）
```

脚本顶层无任何 DOM 引用，可直接被 Node `require`；工具层（时间/配色/URL/BBCode/表情字典等）全部有测试覆盖。本项目在真实登录环境迭代了 20+ 轮实测校准，踩坑记录见 git log。

## 声明

本项目仅为个人学习与前端样式定制，**不提供企业微信服务，亦不隶属于或代表腾讯公司**。所有数据交互只发生在你自己的浏览器与 NGA 之间（版块图标/表情图为 NGA 自家 CDN；帖子条目头像本地生成零第三方请求）。请遵守 NGA 社区规则，摸鱼有度。

## License

[MIT](LICENSE)
