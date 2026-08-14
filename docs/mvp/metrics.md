# Paopao MVP 指标与事件口径

> 状态：MVP 0.1 当前验收口径
> 生效日期：2026-08-15
> 隐私原则：默认只保留本机脱敏聚合；未经用户明确同意，不上传使用事件

## 1. 目的

当前 MVP 验证两个假设：

1. 桌面常驻入口是否足够轻，用户愿意持续记录。
2. 自动整理、来源追溯和活书房是否比普通文本列表更有长期价值。

本文件只定义当前文字 MVP 能产生并可验收的指标。多模态、Self Model、日报、周报和主动提醒指标保留在 [历史 V1 指标输入](../metrics.md)，不进入当前 Gate。

## 2. 北极星与护栏

### 北极星指标

**有效记录周数**：一个自然周内至少 3 天各成功保存 1 条记录，并且至少发生 1 次活书房查看、搜索或纠正。

试用期目标：参与试用的用户中，首周完成有效记录周的比例不低于 40%。该目标需要真实试用样本，工程自动化不能替代。

### 可靠性护栏

| 指标 | 定义 | MVP 目标 |
| --- | --- | ---: |
| 保存成功率 | 返回 `stored` 的提交数 / 合法提交数 | >= 99.9% |
| 保存确认延迟 | 提交到 UI 渲染 `stored` 的端到端耗时 | P95 < 300ms |
| 原文恢复率 | 已返回 `stored` 且在强退/重启后可读取的记录数 / 已返回 `stored` 的记录数 | 100% |
| 删除完整率 | 删除后不再出现在 DB 当前视图、FTS、新导出和自动备份的记录数 / 删除请求数 | 100% |
| 用户导出成功率 | 最终进入 `ready` 的导出数 / 已创建导出数 | >= 99% |

测试失败、合成故障注入和用户主动取消分别统计，不与真实运行失败混合。

## 3. 产品使用指标

| 指标 | 计算方式 | 判断用途 |
| --- | --- | --- |
| 周输入天数 | 一周内至少成功保存一条记录的去重自然日数 | 桌面入口是否形成使用习惯 |
| 每周有效记录数 | 一周内 `capture_stored` 的去重 Entry 数 | 记录入口是否产生真实内容 |
| 活书房回访率 | 保存后 7 天内打开活书房的用户数 / 有保存用户数 | 书房是否承接记录价值 |
| 搜索后打开率 | 搜索后 5 分钟内打开结果的搜索次数 / 有结果的搜索次数 | 搜索是否帮助找回记录 |
| 整理结果查看率 | 打开已整理详情的 Entry 数 / 进入 `ready` 的 Entry 数 | 自动整理是否被消费 |
| 纠正率 | 发生文字 revision、分类或摘要纠正的 Entry 数 / 被打开的已整理 Entry 数 | 同时观察 AI 偏差和用户治理价值，不设越低越好的单向目标 |
| 洞察打开率 | 被打开的 `think` 洞察数 / 成功生成的洞察数 | `think` 是否产生附加价值 |
| 手动重跑率 | 用户手动重跑的失败 Job 数 / 最终失败 Job 数 | 错误是否可理解、可恢复 |

## 4. 最小事件字典

| 事件 | 必要字段 | 禁止字段 |
| --- | --- | --- |
| `capture_submitted` | `requestIdHash, mode, occurredAt` | 原文、剪贴板内容 |
| `capture_stored` | `entryIdHash, mode, latencyMs, deduplicated` | 原文、数据库路径 |
| `entry_processing_finished` | `entryIdHash, status, durationMs, errorCode?` | 模型原始响应、Prompt、证据原文 |
| `library_opened` | `entryCountBucket, occurredAt` | 记录标题或正文 |
| `search_submitted` | `resultCountBucket, occurredAt` | 搜索词 |
| `search_result_opened` | `entryIdHash, rankBucket, occurredAt` | 结果正文 |
| `entry_corrected` | `entryIdHash, correctionKind, occurredAt` | 修改前后内容 |
| `job_retry_requested` | `jobType, priorErrorCode, occurredAt` | Provider 错误正文 |
| `entry_deleted` | `entryIdHash, completionStatus, occurredAt` | 已删除内容 |
| `export_finished` | `format, status, durationMs, errorCode?` | 导出路径、manifest 内容 |

`*Hash` 使用按安装生成的本地随机盐进行不可逆散列，只用于同一安装内去重；不得把飞书 ID、API Key、模型凭据或可跨安装追踪的标识写入事件。

## 5. 当前实现状态

- Capture、Job、AI Run、删除、导出和恢复已有业务状态与脱敏诊断基础。
- 当前没有面向产品指标的完整本地聚合表、同意流程或外发 telemetry。
- 因此工程 Gate 可以验收可靠性护栏，但留存、回访和长期价值仍必须通过受控试用验证。
- 在新增任何遥测实现前，必须先补充数据保留期限、用户开关、导出/删除范围和隐私说明；不得为了指标直接记录原文或搜索词。

## 6. 验收与维护

1. 每个事件新增或改名都要更新本文件和对应 Schema/测试。
2. 自动化报告只验证事件字段、脱敏和可靠性指标，不宣称用户价值假设成立。
3. 试用报告至少给出样本数、观察窗口、版本、平台和缺失数据比例。
4. V1 能力进入正式范围时，从历史指标输入中按 ADR 逐项迁入，不直接把未来指标当作当前完成标准。
