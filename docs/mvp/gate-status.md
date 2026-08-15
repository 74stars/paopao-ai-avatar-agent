# MVP Gate Status

Updated: 2026-08-15

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

- Build：全部 workspace、Renderer 和 Electron 构建通过。
- Desktop：161 项通过，其中 P5 资源测试持续校验 production manifest、运行 manifest、12 个场景帧和 approved hash。
- Infrastructure：82 项通过。
- Feishu Adapter：40 项通过。
- G3 跨层与安全：4 项通过。
- Offline eval：1 项通过。
- Electron Wave 4 E2E：16 个工程验收场景通过，当前报告为 `test-results/e2e-wave4/2026-08-14T18-10-36-018Z/report.json`。
- AI Provider E2E：通过，保留报告为 `test-results/e2e-ai-provider/2026-08-14T15-53-36-666Z/report.json`。
- Online Preview：5 项浏览器 E2E 通过，覆盖 dialog 语义、inert 关闭态、初始焦点、Tab 约束、Escape/背景关闭、焦点恢复和 390px 无横向溢出；当前报告为 `test-results/preview-accessibility/2026-08-14T19-06-53-540Z/report.json`。

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

- 可审计提交已建立并全部推送：`main` 与 `origin/main` 同步于 `15571a4`（`test(feishu): widen transport timing margins`），annotated tag `v0.1.0` 已推送且指向同一提交；LFS 对象（183 个 design 二进制）已全部推送到远端（dry-run 为空）。
- 已从 `v0.1.0` 提交重建 macOS arm64/x64 候选（本机 unsigned，SHA-256 见 release inventory）；Windows x64 候选由远端构建机/CI 生成。
- 正式发布 workflow（`.github/workflows/release.yml`）已在 tag push 上运行：`policy` 通过，`verify` 在 "Feishu adapter integration: SDK transport" 步骤失败（全部历史 ci/release 运行均在该步骤失败，尚未出现过绿色运行）；修复该 CI 问题前，签名/公证/干净机矩阵无法到达。
- 七项仓库签名 secrets（`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`/`MAC_CSC_LINK`/`MAC_CSC_KEY_PASSWORD`/`APPLE_API_KEY_P8`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`）是否可用须在远端 workflow 验证；未签名产物不得发布。
- 当前活书房候选仍需持续截图评审和下一轮美术指导；工程测试不得关闭视觉工作。
- `test-results` 已轮转为当前 Wave 4、Provider、静态设计和 Preview 证据；design PNG/WebP 由 Git LFS 管理（ADR 0006），`tmp` 独有生图输入仍按清理计划保护。

## 当前发布产物（内部候选，非公开发布）

- `desktop-app/release/Paopao-0.1.0-arm64.dmg`（从 `v0.1.0` 重建）
  - SHA-256: `3fe57f0894a64dcba9da33c5afa3ef918485f91bfce478c3dd26fe6a72963c4c`
- `desktop-app/release/Paopao-0.1.0-arm64.zip`
  - SHA-256: `e8c6bd70d01a0a56275b05dc4dacfdd3146dc1e160df84629425f292e5a947fb`
- `desktop-app/release/Paopao-0.1.0-x64.dmg`（从 `v0.1.0` 重建）
  - SHA-256: `7e25f3cca5ac9cee295506b8abc12ffc7433709dc812a3fed7e6d690c08e4aaf`
- `desktop-app/release/Paopao-0.1.0-x64.zip`
  - SHA-256: `1ad4463378d5864d62ffc76846e86ca63943033da36ed37cb71fb9232e735191`

以上均为未签名内部候选（本机无 Developer ID），仅用于安装/卸载与可重建性验证；公开发布必须由 release workflow 在签名 secrets 就绪后产出。
