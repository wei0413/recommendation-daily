# 推荐论文雷达 · RecSys Daily

一个面向推荐系统研究者的每日 arXiv 论文浏览站。界面参考“每日论文笔记”的高密度浏览方式，加入推荐分、主题筛选、全文检索、日期范围和本地收藏。

## 本地预览

```bash
python -m http.server 8000 -d dist
```

然后打开 `http://localhost:8000`。直接双击 HTML 时，浏览器会阻止读取 JSON 数据，因此需要一个本地 HTTP 服务。

## 自动更新

`scripts/update_papers.py` 使用 arXiv 公共 API 拉取近期论文，根据标题、摘要、时效和论文类型计算阅读排序分，并自动标注研究方向。GitHub Actions 会在北京时间工作日早晨运行，更新数据后部署到 GitHub Pages；也可以在 Actions 页面手动触发。

## 发布到 GitHub

将仓库的 Pages 来源设置为 **GitHub Actions**。首次运行 `Update papers and deploy` 工作流后，站点会发布到：

`https://wei0413.github.io/recommendation-daily/`

## 数据说明

论文元数据来自 [arXiv](https://arxiv.org/)。推荐分仅用于降低每日阅读筛选成本，不代表论文质量或最终学术判断。
