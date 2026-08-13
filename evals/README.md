# Offline Evals

离线流水线评测：用确定性 `FakeAiProvider` 驱动 Capture → analyze → ready 与 insight 全链路（`evals/runners/offline.mts`）。不联网、不触达任何 Provider、不读凭据；报告只含 id/计数/指标，任何样本文本、rawText、prompt 回显都会触发硬门禁失败。

## 运行

```bash
./node_modules/.bin/tsx evals/runners/offline.mts
```

运行 runner 黑盒测试：

```bash
npm run test:evals
```

完整 `npm test` 和 CI 都会在 Node integration 测试之后执行该离线门禁，共用已经准备好的 Node native ABI。

写报告文件（可选）：

```bash
./node_modules/.bin/tsx evals/runners/offline.mts --report evals/reports/latest.json
```

要求 `@paopao/contracts`、`@paopao/core` 已构建（`npm run build --workspace=@paopao/contracts && npm run build --workspace=@paopao/core`）。runner 直接以 `tsx` 消费 `packages/infrastructure/src/**` 源码。

退出码：全部硬门禁通过为 0，否则为 1；报告脱敏门禁失败时同样为 1 且不打印报告。

## Fixtures

- `fixtures/classification.json`（15）：类型分类（desire/schedule → goal、place/travel → other、person/reading/thought/diary/other）、错误分类与修复模拟、空数组、悲伤/疾病不正向化且 `needsUserReview: true`。
- `fixtures/evidence.json`（6）：伪造 summary/entity/goal/action 证据触发修复、空 summary evidence、中性化 summary；gold 证据均为 `currentText` 连续子串。
- `fixtures/injection.json`（5）：角色改变、prompt 泄漏、边界逃逸、工具调用、强制正向化——任何注入副作用都会使 `injectionSideEffectRate` 门禁失败。
- `fixtures/retrieval.json`（12）：检索 query → gold Entry；query 使用短连续短语以匹配 trigram tokenizer。
- `fixtures/retrieval-queries.json`（4）：无相关查询，用于 `noRelatedQueryFalsePositiveRate`。
- `fixtures/insight.json`（4）：grounded 回复、非法 citation 修复、`no_relevant_memory`、多记忆引用。

## 报告格式与脱敏

报告为 JSON，结构：

- `runner` / `version` / `generatedAt`：元信息。
- `counts`：fixture 与结果计数（extraction/retrieval/noRelated/injection/insight、firstTryPass、repairRequired/repairPass、pipelineFailures、committed）。
- `metrics`：包含总体 Schema 通过率、首轮/修复 Schema 通过率、分类 Macro-F1、证据定位率、Recall@8、无相关结果误报率、citation 合法率、非法 citation 数和注入副作用率；比率保留 4 位小数。
- `fixtures`：仅 `{ id, outcome, firstTry, repaired, status }`。
- `gates`：每个门禁的 `{ metric, required, actual, passed }`；`passed` 为所有门禁的合取。

脱敏规则（runner 内建硬门禁）：

- 报告不回显任何 fixture 正文、insight 正文或完整 prompt。
- 禁止出现 `---BEGIN_UNTRUSTED_USER_DATA---`、`Bearer ` 或符合 `sk-` 长 Key 形态的泄漏标记。
- 检测到泄漏时 fail closed：不打印报告、退出码 1。
- Provider 错误消息统一走 `sanitizedProviderMessage`/`sanitizedFailure`（固定脱敏文案 + `correlationId`），原始 provider 消息只进审计元数据。

## 硬门禁

| 指标 | 要求 |
| --- | --- |
| `fixtureCount` | ≥ 30 |
| `schemaPassRate` | == 1.0 |
| `pipelineFailures` | == 0 |
| `evidenceLocatabilityRate` | == 1.0 |
| `insightCitationLegalityRate` | == 1.0 |
| `illegalCitationCount` | == 0 |
| `recallAt8` | ≥ 0.80 |
| `noRelatedQueryFalsePositiveRate` | ≤ 0.05 |
| `injectionSideEffectRate` | == 0 |
