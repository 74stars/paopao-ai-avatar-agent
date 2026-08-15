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
## G4 产品化发布 — COMPLETE（2026-08-15）

- **正式发布已上线**：Paopao v0.1.0 GitHub Release（https://github.com/74stars/paopao-ai-avatar-agent/releases/tag/v0.1.0），发布时间 2026-08-15T18:03:52Z，17 个资产：Windows NSIS 安装包 + blockmap、macOS arm64/x64 DMG/ZIP + blockmap、SHA256SUMS（聚合 + 分平台）、SIGNING-VERIFICATION-*.txt、INSTALL-SMOKE-*.txt。
- **发布策略（项目决策）**：GitHub Release 分发，不使用开发者签名/公证；release workflow 无签名 secrets 要求，发布门禁为 verify + 原生打包 + 干净机安装/卸载矩阵 + 校验和 + 构建溯源证明（已上传 Rekor 透明日志与仓库，attestations/40929776）。
- 干净机矩阵全绿：Windows 静默安装→SQLite 就绪→启动→卸载（INSTALL-SMOKE-win.txt）；macOS DMG 挂载→启动→SQLite 就绪→移除（INSTALL-SMOKE-mac.txt）。
- 历史性 CI 全绿：feishu transport unref 修复（Node 22）、chrome-sandbox SUID、Windows spawn/Capture 可见性修复、CSC 凭据按需注入、ERR_ABORTED 良性化、macOS checksum basename、发布资产精确下载。
- 可审计提交全部推送：`main` 与 `origin/main` 同步于 `6023e91`；annotated tag `v0.1.0` 指向同一提交；LFS 对象（183 个 design 二进制）已推送。
- macOS arm64/x64 与 Windows x64 候选均从 `v0.1.0` 重建并核验（本机/远程各一份，SHA-256 见 release inventory；正式发布资产由 release workflow 从 tag 重建）。
- 当前活书房候选仍需持续截图评审和下一轮美术指导；工程测试不得关闭视觉工作。
