# Cairn 0.2.1 开发计划

> 状态：已实现（2026-08-28，待隔离环境人工验收）  
> 背景：Leo 用浮窗完整跑了一遍真实回放复盘流程（回测账户，卡片实时录制、TradingView 事后导入绑定），基于这笔生产数据的具体问题定出的修复与增强清单。生产数据核对结论（只读，未修改数据）：
> - 该 Case 25 张卡跨两个图表日（bar 218–283 → 次日 4–48），旧解析器用卡片 `createdAt` 锚定天数，回放场景下全盘错位；
> - barRef 2265 是语音误识别，Leo 已用错字修正把原文改成 265，但改原文不会重新提取 barRef，毒锚点把后续卡片全部顶到图末端；
> - entry 4@90491.93 + scale-in 4.1928@90491.93 同价同时，是一次下单的冰山拆分，展示成了两笔；
> - initialStopLoss/TP 已手填（90364/90729），与 entry memo 完全一致——自动回填本可省掉这一步。

## 已交付

### S1 BAR 解析与图表修复

- `resolveCaseCardTimesForTrade`（`lib/bar-time.ts`）：锚定 Trade 首笔持仓成交日；barRef 越界不参与推导（标记 invalid，回退创建顺序）；跨日推导越窗回退「紧跟上一张」（回看区间噪声不毒化链条）；无 BAR 卡沿用上一张 +1ms。生产 25 卡序列全量回放单测通过。
- 图表：同一根 bar 多卡合并为一个方块（×N，tooltip 列全部）；方块不再印 BAR 文字；范围外标记不画（不再吸附到最后一根 bar），图下提示；价格标签按 pricePrecision 格式化（修 90618.85999999999）。
- 冰山聚合：`lib/execution-display.ts` 入场侧同 bar 同价也合并（`Entry (2)`）；数据层不动。
- 新增 vitest（`pnpm test`）：bar-time 6 例、execution-display 5 例。

### S2 AI 自动化

- REST 新建 Card 后后台自动识别（`ai::spawn_auto_analysis`，设置开关默认开，幂等重放不触发，完成 emit data-changed）。
- `chat_completion_with_retry`：网络/超时/5xx/空回复自动重试一次；配置/解析错误直接返回。
- 绑定 Trade 后默认占位标题自动拟题（`isDefaultCaseTitle` 白名单：未命名/Case 日期/观察 HH:MM/Trade #N Case），手动按钮保留。
- Settings AI 页新增「AI 行为」卡与「自动 AI 整理」开关（`ai-settings.json`）。

### S3 AI 结果可编辑 + 计划入场价

- memo schema v2（`0.2.1-schema-2`/`0.2.1-prompt-2`）：第七字段 `entryPrice`。
- `updateCaseCardBarRef`（BAR 徽章内联编辑/清除/补填）、`updateCaseCardAnalysis`（memo 详情弹窗修正编辑、缺失字段机械重算、`staleDismissedAt` 过期忽略）。
- 标签整理模式：`EditableHighlightedCaseCardText`（点下划线改/删标签，选中原文打新标签；quote+type 覆盖层，原文永不改写）。`userAdjusted` 标记 + 重新识别前确认。
- 计划 vs 实际：入场价行 + 录/卡来源标记；EditTradeDialog 加初始入场价；绑定后 Entry memo 机械回填空缺计划价（每笔一次自动尝试 + 提醒模态内手动触发）。

### S4 心路历程组件统一 + 页面结构

- `components/case-card-timeline.tsx`：Case 页与 Trade Case tab 共用可编辑时间线；卡片默认折叠摘要行，全部展开/收起，targetCardId 自动展开高亮。
- Case 页：顶部 Case 概要条（状态/绑定/五阶段计数/更新时间）；新增 Card 收为折叠面板。

### S5 风险可见性

- Account 权益快照（`equity`/`equityUpdatedAt`，前端重算，REST 原样带出）；浮窗余额 + 1%/2% 风险条。
- trades 表 PnL% 列（`equityBeforeByTrade`：按平仓顺序倒推入场前权益）。
- 已平仓 Trade 缺初始止损/止盈的首次访问提醒模态（从 Entry 卡填入/手动填写/待会儿提醒/忽略）。

### S6 发布卫生：启用应用内自动更新（方案 B，含一次结论翻案）

- 起因：`releases/latest/download/latest.json` 404。最初的诊断是"签名私钥从不在本机，latest.json 从未生成"，并按此给出 A（拆除）/ B（补齐）两案；Leo 拍板要内置更新器，选 B。
- **翻案**：执行 B 时发现 `%USERPROFILE%\.tauri\cairn-updater.key`（2026-07-08 生成，无密码）一直存在，其公钥与 `tauri.conf.json` 内嵌公钥完全一致——私钥从未丢失，v0.1.3/v0.2.0 的内嵌公钥都能验它的签名，**已装版本可以直接应用内更新**。
- 真正缺口只有两个：① 构建时从未设 `TAURI_SIGNING_PRIVATE_KEY`（打包末尾报错、`.sig` 不生成）；② 发布流程从不生成/上传 `latest.json`。另外 `release.ps1 -BuildInstaller` 误用 `pnpm tauri:build`（local 配置 `createUpdaterArtifacts: false`），即使设了密钥也不会签名。
- 修复：`release.ps1 -BuildInstaller` 改走主配置 `pnpm tauri build`，自动设 `TAURI_SIGNING_PRIVATE_KEY_PATH`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（指向本机密钥），构建后校验 `.sig` 并生成 `bundle/latest.json`（NSIS 资产 URL + 签名），打印上传清单（setup.exe / msi / latest.json）。发布流程细节见 `docs/development-workflow.md` "In-App Updater"。
- 注意：重新生成密钥对会让所有已发布版本验签失败（公钥烧在二进制里），除非明确接受"旧版本只能手动升级"，否则永远复用现钥。

## 验证状态

- `pnpm typecheck` / `pnpm build` / `pnpm test`（11 例）/ `cargo check` / `cargo test`（23 过 2 忽略）全部通过。
- 待做：`pnpm tauri:dev:isolated` 隔离环境人工过一遍（跨天解析、毒 BAR 修正、冰山、自动整理/拟题、编辑器、折叠布局、浮窗权益、PnL%、提醒模态）。

## 顺延（0.2.1 backlog 未变）

图片管理、Case Tags/AI Labels 管理细分、证伪对比视图、MFE/MAE 类指标、symbolId。
