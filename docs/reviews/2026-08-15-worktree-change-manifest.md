# Paopao 工作树变更清单

> 快照日期：2026-08-15
> 基线：`main@962213f`，`origin/main@c08fa15`
> 生命周期：dated worktree snapshot；动态状态以 `git status` 和 [`docs/mvp/gate-status.md`](../mvp/gate-status.md) 为准
> 状态：盘点结果；不代表提交边界，不授权删除文件
> 后续状态：`v0.1.0` 收敛阶段已按 [legacy removal manifest](../design/2026-08-15-legacy-library-removal-manifest.md) 显式移除旧 v4/v4.1 批次；本文件保留删除前快照语义
> 用途：在保留现有工作树的前提下，按领域审阅、验证和拆分提交

## 1. 快照摘要

- 本地 `main` 比 `origin/main` 超前 8 个提交，落后 0 个提交。
- 第二批扫除后工作树有 71 个 tracked 修改、4 个 tracked 删除、502 个未跟踪文件；未跟踪增长来自本轮确认应保留的源码、测试、文档、Prompt 和生产资源，不是生成物回流。
- 没有额外 branch、worktree、stash、tag 或 submodule 需要清理。
- 第二批扫除后目录体量：`desktop-app/release/` 273MB、`desktop-app/design/` 420MiB、`desktop-app/public/assets/` 54MB、`test-results/` 37MB、`tmp/` 17MB。
- 本清单统计文件级状态。一个文件可能同时包含用户既有改动和本轮收敛改动；提交前必须逐 hunk 审阅，禁止按本表整组盲目 stage。

## 2. 归因规则

### A. 本轮收敛确认触及

以下是本轮审核、整改或状态固化明确触及的范围，但不声明拥有文件内全部差异：

- 产品与项目文档：根 `README.md`、`docs/README.md`、`docs/PROJECT-CONVERGENCE.md`、本清单、产品审核报告、Gate 状态和历史文档生命周期标签。
- 产品语义与数据管理：`RecordContent.tsx`、`EntryGovernance.tsx`、`DataManagement.tsx`、对应样式、单元测试和 Wave 4 E2E 断言。
- Preview 边界：`preview/index.html`、`preview/styles.css`，以及当前桌面/窄屏检查证据。
- 设计状态对齐：活书房生产文档、P4 pre-decision 评审标签和 production manifest 状态说明。

### B. 此前已存在或归属不确定

以下领域在本轮开始时已经存在大量 dirty diff 或未跟踪文件。除非逐 hunk 复核，不得归入本轮审核提交：

- Contracts、AI Prompt、备份、导出和 Infrastructure 逻辑。
- Electron Main、preload、窗口移动、宠物手势和托盘/图标工程。
- 活书房 Renderer 重构、Master Scene、美术资源生产和历史 v4/v4.1 实现与资源包。
- Feishu Adapter 和 legacy `feishu-bot` 修复。
- 本地 8 个已提交变更及其工程基线。

## 3. Tracked 变更分组

| 领域 | 文件数 | 主要路径 | 当前判断 | 下一动作 |
| --- | ---: | --- | --- | --- |
| Contracts / AI / 数据基础设施 | 15 | `package*.json`、`packages/contracts`、`packages/infrastructure` | 既有工程改动 | 按契约、Prompt、安全/备份拆分审阅 |
| Feishu | 5 | `adapters/feishu`、`feishu-bot` | Adapter 与 legacy 实现混合 | 分开验证和提交，legacy 不进入 MVP 主链 |
| Electron / 宠物 / preload | 13 | `desktop-app/electron`、Pet/Bubble 组件与测试 | 有删除和替代文件，属于高风险重构 | 核对 IPC、手势和删除文件替代关系 |
| Renderer 产品界面 | 18 | `desktop-app/src`、`desktop-app/test` | 活书房、设置、记录和数据治理混合 | 按用户流程逐 hunk 拆分 |
| 已跟踪视觉资源 | 6 | Desktop/Preview 的 WebP 与设计参考 | 二进制替换，不能用文本 diff 审核 | 记录尺寸、hash、来源和运行用途 |
| Preview 页面 | 2 | `preview/index.html`、`preview/styles.css` | 本轮边界整改已验证 | 与 Preview 资源/证据单独提交 |
| Electron E2E | 2 | `tests/e2e` | 同时覆盖既有工程与本轮产品整改 | 跟随对应产品/工程提交或单独测试提交 |
| 文档与入口 | 14 | 根/desktop README、`docs/` | 当前状态与历史标签混合 | 以 docs-only 提交固化事实 |
| **合计** | **75** | 71 修改、4 删除 | 不包含未跟踪文件 | 提交前再次生成快照 |

4 个 tracked 删除均位于 Electron/Renderer 交互边界：

- `desktop-app/electron/preload-shared/window-contracts.ts`
- `desktop-app/electron/window-movement.ts`
- `desktop-app/src/components/pet-interaction.ts`
- `desktop-app/test/window-movement.test.ts`

这些删除只有在替代实现、引用搜索和对应测试同时成立时才能提交。

## 4. 未跟踪文件分组

| 分组 | 文件数 | 处置状态 |
| --- | ---: | --- |
| `design/assets/library-world-master-v1` | 231 | 生产母版、manifest、approved、working、reviews 混合；禁止整目录清理 |
| design `library-world-v4-1` | 81 | 与 public 发布副本重叠；只被当前不可达的 `LibraryWorld.tsx` 内部引用，列为归档候选 |
| design `library-world-v4` | 27 | 与 public 发布副本重叠；只被当前不可达的 `LibraryWorld.tsx` 内部引用，列为归档候选 |
| design 其他资源 | 5 | 原始恢复图、泡泡母版等；先证明来源和替代物 |
| public `library-master-v1` | 13 | 当前运行时主链，13 个文件全部被 manifest/组件引用，必须保留 |
| public `library-world-v4-1` | 81 | 当前运行时不请求；Vite 因整体复制 `public/` 将其带入发布包，待显式归档批次处理 |
| public `library-world-v4` | 27 | 当前运行时不请求；Vite 因整体复制 `public/` 将其带入发布包，待显式归档批次处理 |
| public 其他 icon/tray/paopao 资源 | 9 | 图标/托盘必需项与 paopao 历史候选已由资源白名单区分 |
| `desktop-app/build` 图标输入 | 4 | electron-builder 输入，不按普通 dist 清理 |
| Desktop 源码、脚本和测试 | 9 | 新实现和测试，禁止按未跟踪状态清理 |
| Prompt 版本 | 3 | Prompt Registry 候选，需与源码引用和版本测试一起提交 |
| Feishu 源码和测试 | 3 | legacy/Adapter 修复证据，需独立审阅 |
| docs 新文件 | 9 | 当前设计、审核、索引、指标、资源与收敛文档 |
| **合计** | **502** | 均未因“未跟踪”而获得删除许可 |

## 5. 资源与重复项结论

- 当前运行时主链是 `desktop-app/public/assets/library-master-v1/`；manifest 和组件覆盖其中全部 13 个文件。
- `desktop-app/design/assets/library-world-master-v1/` 是非破坏生产工作区。其 source、production manifest、approved working 和 reviews 具有母版或审计价值。
- design 与 public 两侧各有 108 个 v4/v4.1 文件；删除前最终 hash 盘点确认 108 个都是逐字节发布复制。该 dated snapshot 之后已按显式清单同时移除无入口引用的 `LibraryWorld.tsx`、design/public 副本、旧路径测试和相关文档状态。
- 全仓只读盘点识别 155 组精确重复，额外占用约 159.4MB；其中约 61.4MB 来自当时的测试结果重复、约 59.8MB 来自 design/public 发布副本、约 11.3MB 来自当时的 tmp 跨目录重复。
- 上述 155 组统计来自首轮盘点。第二批已将 `test-results` 轮转到 37MB，并从 `tmp` 删除 5 个有正式同 hash 副本的文件（6,227,062 bytes），当前 `tmp` 为 17MB；下一删除批次仍须重新计算 hash、引用与字节数。

## 6. 本地 8 个提交

按 `origin/main..HEAD` 从新到旧：

1. `962213f` docs: refresh non-art status after local baseline
2. `17e2ba4` docs: add MVP status ADRs and non-art runbooks
3. `cdf5dd0` test: add Electron Wave4 and AI provider E2E
4. `7b95c6c` feat: add desktop Electron main renderer and tests
5. `247a92b` feat: add post-MVP Feishu adapter and delivery tests
6. `983dbb0` test: add offline evaluation pipeline
7. `de8a339` feat: add MVP contracts domain core and infrastructure
8. `a365f6b` chore: establish npm workspace and CI baseline

推送前需要逐提交检查大文件、凭据、生成物和范围；当前清单不等同于推送批准。

## 7. 建议拆分顺序

1. Contracts、Prompt 与 Infrastructure 行为。
2. 导出、备份和数据安全。
3. Electron Main、preload、窗口与宠物手势。
4. Renderer 活书房、设置、记录与可访问性。
5. 图标、运行时资源、production manifest 和资源白名单。
6. Preview 能力边界与静态资源。
7. 文档、Gate、审核与收敛记录。
8. Feishu Adapter 与 legacy `feishu-bot` 分开处理。

每批先记录拟 stage 路径，再用 `git diff -- <paths>` 逐 hunk 审阅；二进制批次额外保存 SHA-256、尺寸和引用证据。

## 8. 禁止操作

- 不对根目录执行 `git clean -fd`、`git clean -fdx`、`git reset --hard` 或 `git checkout -- .`。
- 不按整个目录 stage `desktop-app/design`、`desktop-app/public/assets`、`desktop-app/release`、`test-results` 或 `tmp`。
- 不删除 dirty tracked 文件、未跟踪源码/测试/Prompt/manifest，或仍有运行时引用的资源。
- 不把同 hash 自动视为冗余；design 母版、public 发布副本、preview 部署副本可以具有不同职责。

## 9. 更新条件

完成一批实现、清理或提交后，重新记录：

- `HEAD` 与远端 ahead/behind。
- modified/deleted/untracked 文件数。
- 受影响领域和验证命令。
- 删除资源的引用、hash、字节数和替代物。
- 当前保留的 E2E、Provider、Preview 和 release 证据。
