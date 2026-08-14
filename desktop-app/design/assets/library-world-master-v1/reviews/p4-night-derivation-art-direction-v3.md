# P4 夜景派生完整审核包美术指导 V3

状态：pre-decision review submission snapshot。本包提交时等待人工美术审核，不代表当时已经通过，也不授权运行时接入。后续人工决议已于 2026-08-14 返回，最终批准状态记录在 `../manifest.production.json` 的 P4 节点；本文件保留提交时证据和指导，不回写为决议文档。

## 本轮生产事实

- P4 夜景静止态唯一基准来自已通过的 P2 日景全局照明修复：`working/p2-day-global-lighting-repair-v1.png`。
- 权威夜景原稿 `source/library-night-reference.webp` 仅提供夜间照明、材质响应和氛围参照，不提供新的构图或物件位置。
- P4 夜景静止态模型原图：`working/model-output/p4-night-idle-v2-crs.png`，原始尺寸 `1586 x 992`，已归一到 `1800 x 1126`。
- 5 个交互状态均以 P4 夜景静止态作为唯一 edit target；已通过的 P3 日景状态只恢复动作形态；对应旧状态蒙版限制最终回合区域。
- 所有模型原图均已直接查看。模型整图会不同程度重绘书墙、木作和其他物件，因此未直接采用整图；最终候选均以 P4 夜景静止态为底板，只回合对应蒙版区域。
- 信件首轮 V2 模型原图动作不足，未进入候选包；已清除其模型原图、归一图、合成图和对照图。本包只使用 V3 定向返修结果。
- 本轮没有修改运行时资源，`runtimeReady` 保持 `false`，也没有生成 P5。

## 夜景静止态判断

### 应保留

- 窗外形成克制的深蓝城市夜景，不再是仅窗外变暗的处理。
- 台灯保持为同一件真实物件；火焰、玻璃高光、桌面暖色反射和邻近木作的暖响应连续存在。
- 书墙、桌面、打字机、信件托盘、玻璃穹顶和木作保留可读的暗部层次。
- 相机、裁切、主要木作结构、窗框、桌面边缘和物件空间关系延续通过的日景基准。

### 本轮边界

- 夜景整体偏低照度，人工审核时应重点判断暗部是否仍足够支撑真实物件阅读，而不是以自动亮度指标替代画面判断。
- 台灯暖光需要保持克制，不能继续向戏剧化聚光、橙色泛光或霓虹效果发展。
- 任何交互候选都必须由夜景静止态回退，不得由日景候选或模型整图回退。

## 5 个交互候选

### 1. 信件托盘顶部信封抬起

- 候选：`working/p4-night-correspondence-letter-lift-v3.png`
- 动作：V3 信封前缘明确离开托盘底部并向上倾起，托盘前壁对下部形成遮挡，保留一枚蜡封。
- 保留项：V3 是本轮唯一信件候选；夜景托盘主体、右侧书籍和下层木作来自 P4 夜景底板。
- 待人工判断：抬起角度、纸张厚度、蜡封在倾斜平面上的真实感，以及托盘前沿遮挡是否足够自然。
- 对照：`reviews/p4-night-correspondence-letter-lift-base-candidate-side-by-side-v3.png`、`reviews/p4-night-correspondence-letter-lift-detail-side-by-side-v3.png`。

### 2. 左侧上层书组抽出

- 候选：`working/p4-night-category-books-diary-pull-v2.png`
- 动作：选定书组整体前移，前排平面、左右遮挡、后部暗槽和搁板接触可读。
- 保留项：只按组级抽出判断，不把任何单本书脊当成跨状态身份资产。
- 待人工判断：书组底缘与搁板前沿的接触、左侧遮挡和局部硬接缝。
- 对照：`reviews/p4-night-category-books-diary-pull-base-candidate-side-by-side-v2.png`、`reviews/p4-night-category-books-diary-pull-detail-side-by-side-v2.png`。

### 3. 中左上层书组抽出

- 候选：`working/p4-night-category-books-memory-pull-v2.png`
- 动作：中左相邻书组整体前移，前后层次和后部暗槽可读。
- 保留项：不校准单本书籍纹理、宽度、高度或磨损连续性。
- 待人工判断：组级前移的可辨识度、两侧遮挡和搁板接触是否与夜间低照度相容。
- 对照：`reviews/p4-night-category-books-memory-pull-base-candidate-side-by-side-v2.png`、`reviews/p4-night-category-books-memory-pull-detail-side-by-side-v2.png`。

### 4. 中右上层书组抽出

- 候选：`working/p4-night-category-books-third-group-pull-v2.png`
- 动作：中右相邻书组整体前移，前排平面、侧向遮挡和后部暗槽成立。
- 保留项：玻璃穹顶、树、右端书组和所有非目标物件保持 P4 夜景底板像素。
- 待人工判断：书组和玻璃穹顶之间的空间余量、搁板前沿接触和局部边缘连续性。
- 对照：`reviews/p4-night-category-books-third-group-pull-base-candidate-side-by-side-v2.png`、`reviews/p4-night-category-books-third-group-pull-detail-side-by-side-v2.png`。

### 5. 右端上层书组抽出

- 候选：`working/p4-night-category-books-fourth-group-pull-v2.png`
- 动作：玻璃穹顶左侧书组整体前移，前后层次、侧向遮挡和搁板接触可读。
- 保留项：玻璃穹顶、内部发光树、右侧横放书籍和其他木作不随动作变化。
- 待人工判断：靠近玻璃穹顶的局部硬接缝、书组右侧遮挡以及书组与搁板前沿的接触。
- 对照：`reviews/p4-night-category-books-fourth-group-pull-base-candidate-side-by-side-v2.png`、`reviews/p4-night-category-books-fourth-group-pull-detail-side-by-side-v2.png`。

## 统一人工美术指导

1. 先看夜景静止态的整体质感，再看 5 个状态；不要先从局部动作推断整包质量。
2. 重点检查夜景是否真正进入室内：木作、书脊、纸张、黄铜、玻璃和桌面都应对冷窗光与暖灯光作连续响应。
3. 交互动作必须通过真实物件的空间关系传达，不接受颜色、亮度、阴影、描边或 UI 贴片单独承担语义。
4. 书组只按整体前移验收，不要求单本书籍在不同状态间保持纹理和形体身份一致。
5. 重点查看书组底缘、后部暗槽、两侧遮挡和玻璃穹顶附近的边缘；这些是模型局部回合最可能露出硬接缝的位置。
6. 若需要下一轮，只允许针对一组明确的画面问题返修；不重新设计相机、场景结构、物件数量或交互语义。

## 审核包

- 夜景静止态归一候选：`working/normalized/p4-night-idle-v2-1800x1126.png`。
- 5 个完整候选：4 个书组使用 `working/p4-night-*-v2.png`，信件使用 `letter-lift-v3`。
- 5 份静止态并排对照和 5 份局部对照用于人工查看；这些图只提供画面证据，不替代人工美术判断。
- 当前结论：提交本 P4 完整包供人工美术审核。审核返回前不进入运行时、不删除通过日景基准、不生成 P5。
