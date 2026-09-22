# 推荐论文雷达 · RecSys Daily

一个面向推荐系统研究者的每日 arXiv 论文浏览站。界面参考“每日论文笔记”的高密度浏览方式，加入可视月历、推荐分、研究方向筛选、机构信息、全文检索、个性化关注和本地收藏。
从 2026 年 9 月 10 日开始，GitHub Actions 会在北京时间工作日上午 10:17 自动从 arXiv 检索最新论文；若 GitHub 未触发，会在 10:47 和 11:17 备用重试，当天已经更新时自动跳过重复抓取、模型调用和部署。（tips：有些论文不挂 arXiv，所以针对特定会议，例如 SIGIR/RecSys 等，后续可以继续补充会议官网见刊的论文。）
https://wei0413.github.io/recommendation-daily/
觉得项目有用欢迎点个star，有问题/改进意见可以在issue上提。

## 本地预览

```bash
python -m http.server 8000 -d dist
```

然后打开 `http://localhost:8000`。直接双击 HTML 时，浏览器会阻止读取 JSON 数据，因此需要一个本地 HTTP 服务。

## 自动更新

`scripts/update_papers.py` 使用 arXiv 公共 API，从 `cs.IR`、`cs.LG`、`cs.AI`、`cs.CL`、`cs.CV` 和 `stat.ML` 中拉取近期推荐系统论文；宽泛 API 查询不可用时，会通过 arXiv 官方 RSS 发现当天候选论文，再以小批量 Atom 查询补齐准确元数据。脚本根据标题、摘要、时效和论文类型计算阅读排序分，并自动标注研究方向。`scripts/enrich_affiliations.py` 从公开论文页补充机构信息；`scripts/enrich_papers.py` 下载并解析 arXiv PDF 全文，再使用 Anthropic 兼容接口，为 2026-09-10 及之后的论文生成文章简介、重点思路、分析总结和个人观点。长论文会先逐段通读并提取证据，再汇总成最终笔记；PDF 无法读取时不会退回为摘要推断。分类覆盖生成式推荐、LLM 与 Agent、序列与会话、多模态、联邦与隐私、图与知识增强、跨域与冷启动、对话交互、公平可信、强化学习、评测复现和工业系统等方向。

GitHub Actions 会在北京时间工作日上午 10:17 运行，并在 10:47、11:17 提供两次备用调度；备用任务会先检查北京时间当天是否已成功更新，已更新则直接跳过。更新数据后会部署到 GitHub Pages；也可以在 Actions 页面手动触发，手动触发始终执行。没有配置大模型密钥时，论文抓取、分类和发布仍会运行，只跳过中文笔记生成。

## 发布到 GitHub

不需要购买服务器。进入仓库 **Settings → Pages**，将 **Build and deployment / Source** 设置为 **GitHub Actions**。首次运行 `Update papers and deploy` 工作流后，站点会公开发布到：

`https://wei0413.github.io/recommendation-daily/`

如需自动生成中文笔记，在仓库 **Settings → Secrets and variables → Actions** 中配置：

- Secret：`ANTHROPIC_AUTH_TOKEN`（只保存新生成的密钥，不要写进仓库）
- Variable：`ANTHROPIC_BASE_URL`，值为 `https://open.bigmodel.cn/api/anthropic`
- 可选 Variable：`ANTHROPIC_MODEL`，未配置时使用 `glm-4.5-air`

之后在 **Actions** 页面手动运行一次 `Update papers and deploy`。如需自己的域名，可在 Pages 设置中继续绑定域名和 HTTPS。

## 数据说明

论文元数据与公开 affiliation 来自 [arXiv](https://arxiv.org/)。“推荐分”综合标题和摘要中的推荐系统相关性、综述/基准/工业实践等内容信号及论文新近程度，仅用于安排阅读顺序，不是引用量，也不代表论文质量或最终学术判断。研究方向旁的数字会随当前日期、搜索和关注条件实时变化。关注方向、关键词和收藏只保存在当前浏览器中。页面右上角显示两个公开站点共享的累计浏览量，并支持同一浏览器按北京时间每天点赞一次；计数使用无需在前端暴露密钥的公开 Counter API。

## 设计及来源参考

https://arxiv-daily.com/#dates=2026-09-09%7E2026-09-10

## 实现支持

Codex、github-action[bot]
