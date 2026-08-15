# Paopao 文档索引

> 更新时间：2026-08-15
> 用途：统一当前需求、实现、状态、设计、决策和历史材料的阅读入口。

## 从这里开始

1. [MVP 执行总纲](./mvp/README.md)：当前最高优先级的范围和完成定义。
2. [MVP 接口契约](./mvp/contracts.md)：跨模块 Schema、状态机和数据治理约束。
3. [MVP 实施计划](./mvp/implementation-plan.md)：施工顺序、Owner 和 Gate。
4. [当前 Gate 状态](./mvp/gate-status.md)：唯一动态工程、验证和发布状态源。
5. [产品需求审核](./reviews/2026-08-15-product-requirements-review.md)：页面级通过项、缺口和整改顺序。
6. [项目收敛与清理计划](./PROJECT-CONVERGENCE.md)：工作树、资源、快照和文档清理批次。

## 文档优先级

出现冲突时按以下顺序处理：

1. `docs/mvp/` 已冻结文档。
2. [PAOPAO-MVP-PLAN.md](./PAOPAO-MVP-PLAN.md)。
3. 已接受 ADR。
4. [PAOPAO-V1-PROJECT-SPEC.md](./PAOPAO-V1-PROJECT-SPEC.md)。
5. 当前状态、审核和 runbook。
6. 早期产品方向和历史原型。
7. 当前代码只表示实现事实，不自动改变需求。

## 当前 MVP

- [执行总纲](./mvp/README.md)
- [接口契约](./mvp/contracts.md)
- [实施计划](./mvp/implementation-plan.md)
- [Agent Prompts](./mvp/agent-prompts.md)
- [Wave 4 产品化与发布](./mvp/wave4-product-release.md)
- [MVP 指标与事件口径](./mvp/metrics.md)
- [Gate Status](./mvp/gate-status.md)

`wave0-dispatch.md` 是已完成阶段的调度记录，保留作执行历史，不作为当前入口。

## 当前状态与评审

- [当前 Gate 状态](./mvp/gate-status.md)，唯一动态状态源。
- [2026-08-13 非美术状态快照](./PROJECT-STATUS.md)，保留为历史盘点。
- [产品需求审核](./reviews/2026-08-15-product-requirements-review.md)
- [工作树变更清单](./reviews/2026-08-15-worktree-change-manifest.md)：按领域记录当前 dirty diff、归因边界和拆分顺序。
- [项目收敛与清理计划](./PROJECT-CONVERGENCE.md)
- [Release operations](./releases/README.md)：GitHub Release 分发的发布门禁、未签名策略与不可变发布规则。
- [v0.1.0 release notes](./releases/v0.1.0.md)：v0.1.0 已发布，附下载与验收说明。
- [Desktop Release 目录清单](./releases/2026-08-15-desktop-release-inventory.md)：旧内部候选、哈希与轮转记录。
- [远程构建验证报告](./releases/2026-08-15-remote-build-report.md)：Linux 冒烟与 Windows 交叉构建记录。

状态文档只记录可核对事实。截图和自动报告证明工程完整性，不产生美术 PASS/FAIL。

## 产品范围

- [MVP 产品计划](./PAOPAO-MVP-PLAN.md)：当前范围和验收口径。
- [成熟 V1 规格](./PAOPAO-V1-PROJECT-SPEC.md)：未来能力参考。

以下属于早期产品方向或 V1 输入，不覆盖 MVP 契约：

- [产品架构](./product-architecture.md)
- [Prompt 设计](./prompt-design.md)
- [Coze Workflow](./coze-workflow.md)
- [指标体系](./metrics.md)
- [简历项目描述](./resume-snippets.md)

其中 `metrics.md` 保留多模态、主动提醒和 Self Model 的历史 V1 指标；当前可验收口径见 `docs/mvp/metrics.md`。

## 设计生产

- [活书房生产规范](./design/living-library-master-production.md)
- [活书房全局交互修正](./design/living-library-global-design.md)
- [Desktop 生产资源白名单](./design/runtime-asset-whitelist.md)：当前运行帧、打包资源和已完成归档批次。
- [Legacy library 删除清单](./design/2026-08-15-legacy-library-removal-manifest.md)：v4/v4.1 旧实现与部署副本的逐文件 hash、字节数和替代链。

设计文档约束当前候选的美术生产与交互边界。生产 manifest 和用户确认参考的优先级高于生成过程文件。

## 架构决策

- [ADR 索引](./adr/README.md)
- ADR 0002：Contract v1 和 legacy mapping。
- ADR 0003：Preload sandbox 边界。
- ADR 0004：飞书移至 MVP 后增量。
- ADR 0005：命名 Provider Profile 和 Codex 复用。

## 验收 Runbook

- [Wave 4 本机工程验收](./runbooks/wave4-local-acceptance.md)
- [活书房截图与工程检查](./runbooks/living-library-acceptance.md)
- [飞书真实租户验收](./runbooks/feishu-tenant-acceptance.md)，状态为 DEFERRED。
- [Wave 3 / G3 追踪矩阵](./runbooks/wave3-g3-traceability.md)，属于 post-MVP 历史证据。

## 历史实现

- `prototype/`：早期网页原型，只用于产品演进记录。
- `feishu-bot/`：早期 HTTP/JSONL 飞书骨架，不进入当前运行路径。
- `preview/`：隔离演示站，不访问生产 SQLite；演示边界、窄屏降级、dialog 语义、焦点约束、Escape 和焦点恢复已完成浏览器 E2E。

历史材料不得用于对外证明当前生产能力。
