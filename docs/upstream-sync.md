# 上游同步流程

本文档用于降低当前仓库与上游 `router-for-me/Cli-Proxy-API-Management-Center` 的长期维护成本。

## 分支约定

- `main`
  用于我们自己的稳定主线。
- `upstream-sync/<version>`
  用于单独同步上游，不做业务功能开发。
- `feature/<name>`
  用于我们的业务功能或定制化开发。

## 远程仓库

首次初始化后，仓库应同时保留以下两个 remote：

```bash
git remote -v
origin    git@github.com:wddclass/Cli-Proxy-API-Management-Center.git
upstream  https://github.com/router-for-me/Cli-Proxy-API-Management-Center.git
```

若缺少上游 remote：

```bash
git remote add upstream https://github.com/router-for-me/Cli-Proxy-API-Management-Center.git
git fetch upstream --tags
```

## 推荐同步步骤

以下示例以同步 `v1.7.40` 为例：

```bash
git checkout main
git pull origin main
git fetch upstream --tags
git checkout -b upstream-sync/v1.7.40
git merge --no-ff v1.7.40
```

若上游以分支或具体提交为准，也可以替换为：

```bash
git merge --no-ff upstream/main
```

## 冲突处理原则

### 1. 基础逻辑优先跟上游

以下类型的文件，原则上优先保留上游实现：

- `src/components/providers/utils.ts`
- `src/pages/AiProvidersPage.tsx`
- `src/utils/usage.ts`
- `src/utils/usageIndex.ts`
- `src/utils/sourceResolver.ts`
- `src/services/api/transformers.ts`
- `src/types/*`

原因：

- 这些文件通常承载统计口径、类型定义、数据归因、通用协议适配
- 如果长期偏离上游，后续每次同步成本会迅速升高

### 2. 自定义功能尽量收口到独立文件

当前已采用的做法：

- `src/components/providers/CodexSection/CodexTestModal.tsx`
- `src/components/providers/CodexSection/CodexTestLauncher.tsx`

建议继续保持：

- 新功能优先新增独立组件或 hook
- 尽量少在上游核心文件里直接写大量状态和业务逻辑

### 3. 页面接线层只做最小修改

例如：

- 在 `CodexSection.tsx` 中只保留少量入口接线
- 复杂逻辑下沉到单独文件

这样做的好处是：

- 上游改 Section 主文件时，冲突面更小
- 我们自己的改动更容易在新基线上重新挂接

### 4. 文案只追加，不重写旧语义

对于：

- `src/i18n/locales/en.json`
- `src/i18n/locales/zh-CN.json`
- `src/i18n/locales/ru.json`

建议：

- 优先新增 key
- 尽量避免重写上游已有 key 的含义

## 当前仓库的高频冲突点

以下文件在未来同步中最可能再次冲突：

- `src/components/providers/CodexSection/CodexSection.tsx`
- `src/components/providers/ClaudeSection/ClaudeSection.tsx`
- `src/components/providers/GeminiSection/GeminiSection.tsx`
- `src/components/providers/OpenAISection/OpenAISection.tsx`
- `src/components/providers/VertexSection/VertexSection.tsx`
- `src/i18n/locales/en.json`
- `src/i18n/locales/zh-CN.json`
- `src/i18n/locales/ru.json`

处理建议：

- 先看上游是否修改了统计逻辑、key 生成逻辑、authIndex 相关归因
- 如果改了，优先保留上游逻辑
- 再把我们自己的按钮、弹窗、样式入口挂回去

## 同步后的检查命令

每次合并上游后，至少执行：

```bash
npm run type-check
npm run build
```

如果页面改动较多，建议额外人工检查：

- `/ai-providers`
- `/usage`
- `/oauth`
- `Auth Files`

## 推荐开发习惯

- 不在 `main` 上直接开发大功能
- 每次上游同步单独一个分支
- 每次功能开发单独一个分支
- 合并上游后，优先先修类型和构建，再看 UI 细节

## 维护目标

目标不是“完全不冲突”，而是：

- 让冲突集中在少量接线文件
- 让核心逻辑尽量跟着上游走
- 让我们的自定义能力尽量以独立模块存在

这样仓库才能长期稳定地跟进上游更新。
