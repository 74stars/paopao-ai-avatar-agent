# MVP Gate Status

Updated: 2026-08-11

本文件只保留当前候选的工程状态。截图、像素和自动化测试用于证明资源加载、渲染完整性与交互事实，不产生美术结论。每轮实际截图评审都必须输出下一轮美术指导。

## Gate 总览

| Gate | 当前状态 | 说明 |
|---|---|---|
| G0 工程基线 | COMPLETE | npm workspace、固定工具链、构建、CI 和 Electron 安全边界已建立 |
| G1 本地闭环 | COMPLETE | Capture、SQLite、持久任务、启动恢复和真实查询已接通 |
| G2 AI 与可治理记忆 | COMPLETE | Provider、结构化整理、洞察、检索、纠正、删除、导出和备份已接通 |
| G3 飞书连接器 | DEFERRED | 实现和自动化验证已完成，但真实企业租户验收未执行，不进入本期 MVP 发布门禁 |
| G4 产品化发布 | ACTIVE | 当前发布阻塞项见下文 |

## 当前工程能力

- 根 npm workspace 覆盖 `desktop-app`、`packages/*` 和 `adapters/*`，使用单一 lockfile。
- Electron Main 组合真实 `CaptureService`、SQLite 查询、持久 Worker、Provider、备份恢复和数据治理服务。
- SQLite 是唯一权威数据源；保存、任务创建、派生结果、全文搜索和删除流程均有事务边界。
- AI 支持多个命名配置、单 active Provider、OpenAI Responses、OpenAI Chat Completions、自定义认证、结构化输出和 Codex 渠道复用。
- Provider 凭据通过 write-only IPC 提交，并由 Electron `safeStorage` 保护；Renderer 无凭据读取接口。
- 活书房读取真实列表、详情、分类数量、状态和搜索结果，不使用生产假数据。
- 飞书 Adapter 复用同一个 `CaptureService` 和 SQLite，不建立第二写路径或第二数据库。

## 当前验证

当前工作树最近一次全量自动化结果：

- Desktop：136 项通过。
- Infrastructure：79 项通过。
- Feishu Adapter：38 项通过。
- G3 跨层与安全：4 项通过。
- Offline eval：1 项通过。
- Electron Wave 4 E2E：11 项通过，当前报告为 `test-results/e2e-wave4/2026-08-11T10-18-33-826Z/report.json`。
- AI Provider E2E 通过，当前报告为 `test-results/e2e-ai-provider/2026-08-11T08-01-50-504Z/report.json`。

E2E 报告明确限定为 engineering evidence。它证明画布非空、资源无加载错误、控件可达、凭据只写、窗口交互和本地保存闭环成立，不证明视觉质量。

## 当前产品语义

用户界面统一使用以下概念：

- `记录内容`：用户当前认可的记录版本；首次保存时等于最初输入，用户编辑后形成新 revision。
- `最初记录`：首次保存且不可静默覆盖的内容；只有发生编辑后才作为历史依据显示。
- `AI 整理`：AI 产生的分类、摘要、实体、目标和下一步，不替代用户记录。
- `记录方式`：内容进入泡泡的入口，目前为桌面泡泡或飞书。
- `整理依据`：AI 结论所依据的本条记录或关联记录片段，不再称作笼统的“来源”。

列表标题和预览只能来自用户记录版本，不得使用 AI 摘要覆盖。分类和摘要允许用字段级控件调整；Renderer 不向用户暴露 derivation kind 或原始 JSON。

## G4 阻塞项

- 当前实现尚未形成可由远端提交重建的 Git 基线：`HEAD` 与 `origin/main` 仍为 `c08fa15`，大量 MVP 源码、测试和 CI 文件处于未提交或未跟踪状态。
- 只有 macOS arm64 内部 DMG/ZIP；macOS x64、Windows x64、干净机安装和真实 OS 指针拖动尚未验收。
- 公开发布所需的签名和 macOS notarization 尚未完成。
- 当前活书房候选仍需持续截图评审和下一轮美术指导；工程测试不得关闭视觉工作。
- `test-results` 已只保留当前 Wave 4 与 Provider 证据；临时生图参考和遗留 release 仍需在建立 Git 基线后直接清除，不保留撤销标记。

## 当前发布产物

- `desktop-app/release/Paopao-0.1.0-arm64.dmg`
  - SHA-256: `df5b81179419029077db4dcf52ec407347d9b901b4630fc90c9dca047c8ce300`
- `desktop-app/release/Paopao-0.1.0-arm64.zip`
  - SHA-256: `3bc3afaa98758f2b4dae47429283f0e3c40edb1bc5d1421bccfbb5f6fc864f64`

这些文件是内部候选，不是公开发布版本。
