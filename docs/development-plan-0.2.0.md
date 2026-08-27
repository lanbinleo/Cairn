# Cairn 0.2.0 分阶段开发计划

> 状态：进行中  
> 目标：建立 Case 记录系统，并在后续阶段完成 Trade 整合、AI 分析和本地 REST API。

## 开发原则

- 保留 `Account → Period → Trade → Execution` 的现有结构，不增加 Session。
- Case 可以在 Trade 导入前独立创建。
- 一个有效 Case 最多关联一个 Trade，一个有效 Trade 最多关联一个 Case。
- Case 与 Trade 通过 Binding 关联，数据不互相复制。
- Card 原文提交后不可改写；更正通过新增 Card 表达。
- AI 结果属于可重新生成的派生数据，不覆盖 Raw text。
- 每个 Stage 完成后执行自动检查和隔离环境人工验收，再进入下一个 Stage。

## Stage 1：Case 数据基础

状态：已实现；typecheck/build/cargo check/cargo test 通过，等待隔离环境联合测试。

范围：

- `cases`
- `case_cards`
- `case_trade_bindings`
- `case_tag_defs`
- `case_tag_links`
- Case/Card/Binding/Case Tag 前端类型与 Store
- Case 数据进入备份和恢复
- Case 与 Case Card 附件归属类型
- Card Raw text 数据库不可改写约束
- Case/Trade 双向一对一有效 Binding 约束
- 删除 Case 或 Trade 时解除有效 Binding

验收：

- 同一个 Card ID 修改 Raw text 会被 Rust 层拒绝。
- 同一个 Case 或 Trade 建立第二个有效 Binding 会被 SQLite 拒绝。
- 旧备份缺少 Case 字段时可以恢复为空集合。
- Case 数据可以随完整备份导出和恢复。

## Stage 2：Case 管理页面

状态：已实现；typecheck/build/cargo check/cargo test 通过，等待隔离环境联合测试。

范围：

- `/cases` Case 列表。
- `/cases/:caseId` Case 详情。
- 按 Account、Period、状态、记录方式、Binding 和 Case Tags 筛选。
- 新建 Case。
- 独立 Case Tags、七色分类与管理。
- Pre-entry、Entry、Intermediate、Closing、Reflection 五类 Card。
- 每张 Card 必须对应一个明确的 BAR；不允许一张 Card 保存多个 BAR。
- 不同 Card Phase 的记录提示。
- Entry 操作确认：待确认、已执行、未执行并继续观察。
- 未执行 Entry 在 Pre-entry 区域展示，同时保留原始 Entry Phase。
- 明确的 `BAR38`、`Bar 41`、`第 42 根 K 线`机械提取。
- Card 原文只读展示。
- Case 状态、Forward/Retrospective 和标签编辑。
- Binding 只显示状态，建立关联的 UI 留给 Stage 3。

联合测试重点：

1. 创建 Account 和 Period 后新建 Case。
2. 添加五种 Phase 的 Card。
3. 检查 `BAR38` 是否显示为结构化 BAR 标记。
4. 将 Entry 设为“未执行，继续观察”，确认它显示在 Pre-entry 中。
5. 关闭并重新打开应用，确认 Case 和 Card 顺序不变。
6. 创建、重命名、改色和删除 Case Tags。
7. 使用 Case 列表组合筛选。
8. 导出备份、清空隔离数据并恢复，确认 Case 数据完整。

## Stage 3：Trade 页面整合

状态：已实现；typecheck/build/cargo check/cargo test 通过，等待隔离环境联合测试。

范围：

- Trade 详情加入 Overview、Case、Trade 三个 Tab。
- Trade 没有关联 Case 时可以新建并关联，或选择已有 Case。
- Case 已被其他 Trade 占用时阻止关联。
- 支持确认后解除错误关联并重新绑定。
- Overview 显示图表、Case 摘要、Card BAR 标记，以及由 Execution、TradeEvent、Case Card 合并的 Timeline。
- 图表标记支持 hover 查看 Execution、TradeEvent 或 Case Card 摘要。
- Case Tab 展示与 Case 页面相同的原始 Card 数据。
- 点击 Overview 中的 Card BAR 标记可以定位到 Case Tab 中对应 Card。
- Trade Tab 集中展示交易数字分析，过程评分和 AI 建议留给后续 Stage。
- Case 列表整张卡片可以进入 Case；关联状态以颜色区分，并可直接打开已关联 Trade。

联合测试重点：

1. 已绑定 Trade 的 Overview 能看到 Case 摘要、Tags 和 BAR 标记。
2. Case Tab 能看到完整的 Pre-entry、Entry、Intermediate、Closing、Reflection Card。
3. 点击 BAR 标记后进入 Case Tab，并高亮对应 Card。
4. 未绑定 Trade 时，可以选择已有 Case，或新建并关联 Case。
5. 已被其他 Trade 占用的 Case 不出现在可选列表中，并显示占用提示。
6. 解除关联后，原 Trade 和 Case 都可以重新选择其他绑定。
7. Overview Timeline 中的 Execution、TradeEvent 与 Case Card 顺序正确，Case Card 可以进入对应 Card。
8. Trade Tab 的 PnL、R、Execution 数和持仓时长与 Overview 结果一致。

## Stage 4：导入匹配与数据管理

状态：未开始。

计划：

- Trade 导入后推荐可能关联的 Case。
- 模糊匹配要求人工确认。
- Case/Card 图片管理。
- Binding 变更记录。
- Case 删除、归档、附件、备份和恢复的完整检查。

## Stage 5：AI

状态：第一刀已落地（2026-08-27）。`ai.rs` 新增 `chat_completion`（POST /chat/completions，temperature 0，90s 超时，不带 response_format 以兼容全 provider）与 Card 结构化提取：prompt v1（`0.2.0-prompt-1`）+ schema v1（`0.2.0-schema-1`），真实 glm-5.3-flash 联调一次通过（六字段 memo、span quote 标签、barRef 提议、missingFields 机械推导）。CaseCard 新增 `aiAnalysis` 版本化派生字段与"AI 整理"按钮（标签下划线高亮原文、memo 网格、缺失提示）；`AiRetryButton` 支持直重试与带补充要求重试；rawText 错字修正开放（自动历史 + 过期标记）。Provider 配置见前：Settings AI tab（多 provider + presets + `/models`），凭证存本机 `ai-providers.json` 不进备份。

计划：

- Settings 增加 AI 配置分类。（已交付）
- 单 Card 和批量 Case 识别。
- BAR JSON、原文 Span Highlight、缺失信息提示。
- Entry Card 六字段 memo 提取（方向、止损、目标、置信度、失效点、放弃方案），完整性检查单 = 缺失字段集合；也是过程分 memo 项的输入（设计见 `docs/case-recording-0.2.0.md` §5.4、§7.1）。
- 过程分（十分制）的输入管线：机械项（止损只收紧、盈亏比、入场纪律、出场按计划）从 Execution 计算；判断项（结构成立）锚定入场 BAR 冻结图人工评分。
- 保存 model、prompt、schema 和 taxonomy 版本。
- Case Tags 与 AI Labels 分开管理。
- 重新识别不会修改 Raw text。

## Stage 6：本地 REST API

状态：已实现；typecheck/build/cargo check/cargo test 通过，隔离环境 curl 实测全链路通过，Tampermonkey 浮窗脚本已接入实测（2026-08-27，`scripts/cairn-case-widget.user.js`）。

已交付：

- `src-tauri/src/api.rs`：tiny_http 同步 server 线程，只监听 `127.0.0.1`，Bearer token 鉴权，宽松 CORS。
- 端点：`GET /api/v1/health`、`GET/POST /api/v1/cases`、`GET /api/v1/cases/:id`、`GET/POST /api/v1/cases/:id/cards`、`POST /api/v1/bindings`、`DELETE /api/v1/bindings/:id`、`GET/POST /api/v1/case-tags`、`GET /api/v1/accounts`（含嵌套 Period）。
- 幂等创建：稳定 id 重放同内容返回 200，同 id 不同 rawText 返回 409。
- Card 提交只需 `phase` 和 `rawText`；`barRef` 选填，缺省时服务端从原文机械提取 BAR 引用，提取不到允许缺失（思想交给人，填表交给提取层，AI 增强留给 Stage 5）。
- token 存 `api-config.json`（默认端口 8787），Settings 新增"本地 API"页：运行状态、token 复制与重新生成、开关与端口配置（重启生效）、端点速查。
- 写入成功后 emit `cairn://data-changed`，前端 store 防抖刷新，日志已验证外部写入即时反映到 UI。
- 不提供下单或仓位修改接口。

已交付的配套浮窗（不属于本 Stage，跟随 Stage 6 验收）：

- `scripts/cairn-case-widget.user.js`：TradingView 悬浮记录浮窗（Shadow DOM 隔离、悬浮球拖动 + 4px 误触阈值、Case 切换/新建、五阶段、entryDecision、BAR 选填、入场完整性提示雏形、卡片时间线）。
- 脚本内使用 `GM_xmlhttpRequest` 跨域写本地 API（https 页面直连 http localhost 会被混合内容拦截），Token/端口/Case/Phase/位置全部记忆。
- `scripts/cairn-case-widget.test.html`：GM shim 测试页，不装 Tampermonkey 即可对隔离 dev 环境全流程联调。
- 待做：配套 PineScript Bar Count 指标脚本。

## 每个 Stage 的检查

```powershell
pnpm typecheck
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri:dev:isolated
```

人工测试只使用隔离数据目录，不接触生产数据。
