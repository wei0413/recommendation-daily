# 推荐论文雷达 · RecSys Daily

一个面向推荐系统研究者的每日 arXiv 论文浏览站。界面参考“每日论文笔记”的高密度浏览方式，加入可视月历、推荐分、研究方向筛选、机构信息、全文检索、个性化关注和本地收藏。

## 本地预览

```bash
python -m http.server 8000 -d dist
```

然后打开 `http://localhost:8000`。直接双击 HTML 时，浏览器会阻止读取 JSON 数据，因此需要一个本地 HTTP 服务。

## 自动更新

`scripts/update_papers.py` 使用 arXiv 公共 API 拉取近期论文，根据标题、摘要、时效和论文类型计算阅读排序分，并自动标注研究方向。`scripts/enrich_affiliations.py` 从公开论文页补充机构信息；`scripts/enrich_papers.py` 使用 Anthropic 兼容接口生成文章主题、研究问题、主要贡献和中文阅读笔记。分类覆盖生成式推荐、LLM 与 Agent、序列与会话、多模态、联邦与隐私、图与知识增强、跨域与冷启动、对话交互、公平可信、强化学习、评测复现和工业系统等方向。

GitHub Actions 会在北京时间工作日早晨运行，更新数据后部署到 GitHub Pages；也可以在 Actions 页面手动触发。没有配置大模型密钥时，论文抓取、分类和发布仍会运行，只跳过中文笔记生成。

## 发布到 GitHub

不需要购买服务器。进入仓库 **Settings → Pages**，将 **Build and deployment / Source** 设置为 **GitHub Actions**。首次运行 `Update papers and deploy` 工作流后，站点会公开发布到：

`https://wei0413.github.io/recommendation-daily/`

如需自动生成中文笔记，在仓库 **Settings → Secrets and variables → Actions** 中配置：

- Secret：`ANTHROPIC_AUTH_TOKEN`（只保存新生成的密钥，不要写进仓库）
- Variable：`ANTHROPIC_BASE_URL`，值为 `https://open.bigmodel.cn/api/anthropic`
- 可选 Variable：`ANTHROPIC_MODEL`，未配置时使用 `glm-4.5-air`

之后在 **Actions** 页面手动运行一次 `Update papers and deploy`。如需自己的域名，可在 Pages 设置中继续绑定域名和 HTTPS。

## 数据说明

论文元数据与公开 affiliation 来自 [arXiv](https://arxiv.org/)。推荐分仅用于降低每日阅读筛选成本，不代表论文质量或最终学术判断。关注方向、关键词和收藏只保存在当前浏览器中。
