# Java 面试知识点

由《Java 高频面试知识点（深度问答版）》PDF 提取整理的 VitePress 文档站。

共 11 章 53 个专题，覆盖 Java 基础、集合、并发、JVM、MySQL、Redis、分布式、Spring、设计模式、消息队列和 Java 8。

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

本地预览请用根路径构建，否则资源路径会带上仓库子路径：

```bash
npm run build:local
npm run preview
```

## 部署到 GitHub Pages

1. 在 GitHub 新建仓库（名字任意，public）。
2. 推送本目录到默认分支（`main` 或 `master`）：
   ```bash
   git init
   git add .
   git commit -m "init"
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin master
   ```
3. 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
4. 推送后自动部署。base 路径由 workflow 按仓库名自动注入，无需手工修改。

## 目录结构

```
docs/
  index.md              首页
  guide/t01.md ...      32 个专题
  .vitepress/           站点配置与侧边栏
.github/workflows/      Pages 自动部署
```

## 说明

- 原 PDF 中的表格已还原为 Markdown 表格；代码块按原文字体识别整理。
- 原文中的版本相关结论（如 JDK、MySQL、GC 参数）未做修订，复习时请按目标版本核对。
- 内容仅供学习参考。
