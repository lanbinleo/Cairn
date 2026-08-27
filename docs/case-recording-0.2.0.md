# Case Recording and AI-Assisted Trade Narrative

> Status: 0.2.0 active design; Stage 1 and Stage 2 implemented for joint testing  
> Discussion date: 2026-08-02  
> This document records the current product direction. It is not yet an implementation contract. Open questions are intentionally retained for a later design discussion.

## 1. Goal

Cairn should help record the trader's reasoning while it is happening, with as little interruption to TradingView replay or live trading as possible.

The desired workflow is:

1. The trader sees something worth recording on the chart.
2. A floating control inside TradingView opens a small recording card.
3. The trader speaks or types naturally without opening the Cairn window or manually creating an order record.
4. AI identifies quoted spans, BAR references, missing information, and semantic labels while preserving the original text.
5. The trader can add more cards as the market develops.
6. After TradingView trades are imported, Cairn binds the relevant Case to a Trade.
7. The Trade detail page presents the ordered cards as the trade's reasoning history.

The primary product in 0.2.0 is reliable decision-time data collection. Similar-case retrieval, embeddings, and automated pattern detection can use these records later.

## 2. Current Decisions

Implementation progress and acceptance steps are tracked in [development-plan-0.2.0.md](./development-plan-0.2.0.md).

### 2.1 Keep the existing hierarchy

The existing product hierarchy remains:

```text
Account
  Period
    Trade
      Executions
```

There is no Session level.

### 2.2 Separate market reasoning from execution facts

- `Trade` remains the imported or manually created trade lifecycle.
- `Execution` remains the factual action timeline.
- `Case` records the reasoning that develops around a potential or executed Trade.
- A `Card` is one raw spoken or typed entry inside a Case.
- `Binding` associates a Case with a Trade after the Trade is available.

Provisional relationship:

```text
Case
  Card: Pre-entry observation
  Card: Entry idea
  Card: Intermediate update
  Card: Closing note
  Card: Reflection

Case -- Binding --> Trade
                       Executions
```

A Case may be created before its Trade exists. The user should not have to enter time fields or manually construct a Trade during chart reading. The system can keep a Case temporarily pending and bind it after trade import.

The long-term preference is that completed trading Cases are bound to Trades. The lifecycle of observation-only or unfinished Cases still needs a later decision.

### 2.3 Preserve raw records

- Raw text is stored exactly as submitted.
- AI output never replaces or rewrites raw text.
- After submission, corrections are stored as additions or derived versions rather than edits to the original entry.
- Labels, extracted fields, and taxonomy versions may be regenerated later.
- Each AI result records its schema, taxonomy, prompt, and model version where applicable.

### 2.4 BAR is the main chart anchor

The trader may say:

> 现在是 BAR38，我在这里看到一个二次入场做多机会。如果下一根 K 线跌回区间，我会放弃。

AI should extract `BAR38` into structured JSON. The user does not manually enter a timestamp for the Card.

The application may still save an automatic `createdAt` value for ordering and audit, but that value is not treated as the chart's market time. Trade binding and chart display should use extracted BAR references and the eventual Trade context where possible.

## 3. Provisional Terminology

These names are working terms and may change before implementation.

| Term | Meaning |
| --- | --- |
| Case | A continuous reasoning history around a potential or completed Trade |
| Card | One raw speech/text entry in a Case |
| Phase | The Card's role: pre-entry, entry, intermediate, closing, or reflection |
| Binding | The relationship between a Case and an imported Trade |
| Raw text | The submitted text before AI labeling or field extraction |
| Derived data | AI labels, quoted spans, BAR references, completeness results, and classifications |

The UI does not have to expose these English names. Candidate Chinese labels include “交易思路”, “记录卡片”, and “心路历程”.

## 4. Card Phases

### 4.1 Pre-setup / Pre-entry

This phase covers the observation period between the end of the previous Trade and the beginning of the next Trade.

Typical content:

- Current market state, such as Trading Range, Channel, Trend, or Breakout Mode.
- Important locations and nearby structures.
- Scenarios being considered.
- Conditions that would make a setup interesting.
- Reasons for continuing to wait.

This phase represents how the trader reads the market before committing to an entry.

### 4.2 Entry / Start

This Card is created after seeing a signal bar or setup and before committing to the position.

Candidate prompts:

- Which BAR triggered the idea?
- Long or short?
- What structure or behavior is visible?
- What is the entry plan?
- Where is the invalidation point or stop?
- What is the target or expected path?
- What alternative action was rejected?
- What is the confidence level?
- Is emotion influencing the decision?

The prompt should assist discipline without forcing the trader to fill a long form.

### 4.3 Entry confirmation

After recording an Entry Card, the trader may decide that the setup is not good enough and continue waiting.

The UI should provide a confirmation control such as:

- Executed / opened the position.
- Did not execute / continue observing.

If the trader does not execute, the original Entry Card remains unchanged. Its derived display classification can return to the Pre-entry area. The system should preserve the fact that it was originally considered as an entry.

This avoids deleting useful evidence about rejected setups and hesitation.

### 4.4 Intermediate

Intermediate Cards can be added at any time while the Trade develops.

Example:

> 这是 BAR41，出现了一个明显的顶部结构。如果下一根继续走弱，我可能离场。

Typical content:

- Current BAR.
- Newly observed market structure.
- Interpretation or inference.
- Conditional plan.
- Position-management intention.
- Whether the original thesis has changed.

These Cards describe the reasoning between Entry and Closing. Actual orders and fills continue to be recorded as Executions.

### 4.5 Closing

Closing records the reasoning around reducing or closing the position.

Candidate prompts:

- Which BAR prompted the decision?
- What changed?
- Was the exit planned, conditional, or emotional?
- Was the full position or part of the position closed?
- Did the exit follow an earlier Intermediate plan?

The imported Execution remains the factual source for price, quantity, and time. The Closing Card explains why the action was taken.

### 4.6 Reflection

Reflection is added after the Trade has ended.

Candidate content:

- What actually happened?
- Which observations were useful?
- Which inference was unsupported?
- Which action followed the plan?
- Which action was improvised?
- What should be watched in a similar future setup?

Reflection remains separate from outcome metrics. R, MFE, MAE, and PnL are computed data and should not rewrite the process record.

## 5. AI Responsibilities

AI assists recording and organization. It does not decide whether to enter, exit, or change position size.

### 5.1 Prompt for missing information

The Card UI changes its reminders according to the selected or inferred phase.

Examples:

- Entry Card: “还没有提到失效条件。”
- Intermediate Card: “你描述了顶部结构，但没有说明它会如何改变计划。”
- Closing Card: “还没有说明这次离场是否符合之前的计划。”

The reminder should appear quickly and remain optional. It is a discipline aid, not a required questionnaire.

### 5.2 Extract BAR references

AI identifies explicit BAR references from raw text and returns structured values.

Examples:

- `BAR38`
- `Bar 41`
- `第 42 根 K 线`

Multiple BAR references may appear in one Card. Every extracted value keeps the matching quote from the raw text.

### 5.3 Highlight quoted spans

AI classifies parts of the original text without rewriting them. Candidate label categories include:

- `market-context`: market state or background.
- `setup-condition`: conditions required for a setup.
- `observed-pattern`: visible structure or price behavior.
- `inference`: interpretation or expectation.
- `entry-plan`: proposed entry action.
- `invalidation`: condition that invalidates the idea.
- `risk-plan`: stop, target, and planned risk.
- `position-management`: scale, stop movement, hold, or exit plan.
- `action`: an action already taken.
- `emotion`: FOMO, hesitation, fear, impatience, or confidence.
- `reflection`: after-trade learning or process evaluation.

Highlights should reference character spans or exact quotes so the UI can color the original text directly.

### 5.4 Entry memo: six-field extraction

Entry Cards are organized around the pre-entry memo schema (the "three minutes before entry" discipline). The secretary AI extracts these fields as span quotes from the raw Entry Card text, never rewriting or summarizing:

1. Direction (long/short)
2. Stop-loss / invalidation price
3. Target or expected path
4. Confidence (percent when spoken)
5. Invalidation condition (what proves the idea wrong)
6. What other setups were rejected

An optional emotion label may accompany the memo. The completeness checklist shown after submitting an Entry Card is exactly the set of missing fields among these six. This extraction also feeds the memo-completeness item of the process score (see Process Score below): completeness is countable, mechanical, and immune to hindsight.

### 5.5 Keep AI output reproducible

Illustrative response shape:

```json
{
  "schemaVersion": "0.2.0-draft-1",
  "phase": "intermediate",
  "barRef": {
    "bar": 41,
    "quote": "这是 BAR41"
  },
  "labels": [
    {
      "type": "observed-pattern",
      "quote": "出现了一个明显的顶部结构"
    },
    {
      "type": "position-management",
      "quote": "如果下一根继续走弱，我可能离场"
    }
  ],
  "missingFields": [
    "明确的离场触发条件"
  ]
}
```

The actual schema will be defined before implementation. Raw text is stored outside this derived result and is never reconstructed from AI output.

## 6. TradingView Capture Experience

The preferred capture surface is a floating control injected into TradingView, initially using a Tampermonkey userscript.

Expected flow:

1. Cairn is available in the background.
2. A small floating button is visible on TradingView.
3. Clicking it opens the current Case and a new Card editor.
4. The trader selects a phase or lets AI suggest one.
5. The trader dictates through an existing speech-input method or types directly.
6. The Card shows phase-specific reminders and AI highlights.
7. Submission stores raw text immediately.
8. Additional Intermediate or Closing Cards can be added without opening the main Cairn window.

The widget is for recording. TradingView remains the preferred interface for replay orders and position actions.

### 6.1 Current-Case session model

The capture widget does not present a Case picker as the primary control. Browsing and choosing among Cases mid-trade is a classification question the trader should not answer in the moment.

- The panel header states where Cards go: the current Case title, plus the account · period context line. Confirming the destination is a glance, not a selection.
- Switching Cases is opt-in: tapping the title opens a short recent-cases menu on demand.
- Starting a new observation is the primary organizational action: one tap on ＋. The title may stay empty (AI can title it later from the first Cards); account and period are pre-filled from the last choice and only matter at this moment.
- The current Case, phase, and widget position persist across opens.

Cards can land in the wrong Case (a boundary misjudged, a new Case forgotten). Membership is repairable in the Cairn Case detail page: any Card can be moved to another Case. The raw text stays immutable; only `caseId` changes.

### 6.2 Local connection direction

A likely technical direction is:

```text
TradingView Tampermonkey widget
        -> localhost API
        -> Cairn / local SQLite
```

Security and lifecycle requirements include:

- Bind only to `127.0.0.1`.
- Require a Cairn-generated pairing token.
- Restrict accepted browser origins or userscript requests.
- Keep order execution outside this API.
- Decide whether Cairn runs in the tray or provides a small background service.

This direction is provisional until the previous userscript code has been inspected.

## 7. Binding a Case to a Trade

Case capture should not require manual Trade creation or timestamp entry.

After TradingView trades are imported, Cairn should suggest a Binding using available evidence such as:

- Account and Period selected for the capture context.
- Symbol and direction when available.
- Extracted Entry BAR.
- Imported Entry Execution order and chart position.
- Whether the Case was confirmed as executed.

Clear matches can be bound automatically. Ambiguous matches should be shown for confirmation rather than silently linked.

After Binding, the Trade detail page displays:

```text
心路历程
  Pre-entry Cards
  Entry Card
  Intermediate Cards
  Closing Card
  Reflection

操作事实
  Executions

结果
  R / MFE / MAE / PnL
```

BAR references in Cards should link to or highlight the corresponding chart bars once the Case has enough Trade and chart context.

## 7.1 Process Score (Trade 分析)

Every bound Trade carries two independent numbers: a process score and R. The process score evaluates the trade using only information available at decision time; R is recorded but never becomes a label. Judging decisions by outcomes (resulting) pollutes the dataset: a lucky win on a bad process is a bad trade, and a disciplined loss is a good trade.

Ten-point scorecard:

| Item | Points | Source |
| --- | --- | --- |
| Structure valid (re-checked against the frozen chart at entry) | 2 | Human judgment, anchored |
| Memo complete (six fields, one point off per missing field) | 2 | AI six-field extraction (§5.4) |
| Planned risk-reward above threshold | 1 | Computed from memo stop/target and entry price |
| Entry discipline (inside the planned zone, not chasing) | 1 | Entry Execution price vs planned zone |
| Zero improvisation while holding (one point off per unplanned action) | 2 | Execution sequence vs Card-stated plans (AI-assisted match) |
| Stop only tightened, never loosened | 1 | Mechanical from Execution order |
| Exit per plan (not panic-closed) | 1 | Exit Execution vs memo target/stop |

- Most items are factual records fixed when the trade happened; hindsight cannot change them. The only genuinely pollutable item is "structure valid", so blind evaluation is implemented by freezing the chart at the entry bar during scoring rather than by hiding PnL.
- The scorecard is itself a hypothesis tested by R: after roughly a hundred trades, compare average R of the 8+ group against the ≤5 group. No difference means the scorecard measures the wrong thing and should be changed.
- Quantified trading slang lives here too: 卖飞 (exit price as a share of MFE; persistently low means systematically timid exits), 踏空 (hypothetical R of skipped setups; skipped setups that systematically make money mean the filter is too tight), 遗憾 (free text, the emotional outlet, not quantified).
- Display location: the Trade 分析 tab on the Trade detail page, alongside outcome facts (R, MFE/MAE, PnL) which stay clearly separated from process evaluation.

## 8. Forward and Retrospective Records

The system must eventually distinguish records made without seeing the future from records created after the outcome was known.

Working terms:

- `forward`: recorded while future bars were hidden.
- `retrospective`: recorded after later price action was already known.

This distinction is separate from whether an order was executed. A replay trade can still be `forward` when future bars remain hidden. Retrospective records are useful for study, but calibration and evidence tests should exclude them by default.

The exact UI labels and where this property belongs—Case, Card, or Trade—remain open.

## 9. Text and Audio

The current direction favors saving submitted text in 0.2.0 because an existing speech-input method already converts natural speech into text with little friction.

Advantages:

- AI can classify and highlight the text immediately.
- No additional microphone, audio storage, transcription, or backup flow is required.
- The original submitted wording can still be preserved as immutable raw text.

Saving original audio remains an open option. It should be added only if later practice shows that transcription errors, hesitation, tone, or pauses contain information worth preserving.

## 10. Candidate 0.2.0 Scope

### Included direction

- Case and Card data model.
- No Session entity.
- Floating TradingView capture card.
- Phase-specific recording prompts.
- Immutable raw text after submission.
- Entry confirmation and return-to-observation behavior.
- AI BAR extraction, quoted-span labels, and completeness reminders.
- Versioned derived AI results.
- Case-to-Trade Binding after import.
- Trade detail “心路历程” display.
- Forward versus retrospective provenance.

### Deferred direction

- Automated trade decisions.
- Broker or TradingView order execution from Cairn.
- Position-size decisions by AI.
- Similar-case retrieval and embeddings.
- Automatic price-action detector.
- A general taxonomy editor.
- Original-audio storage unless the text-only workflow proves insufficient.

## 11. Verification Targets

The 0.2.0 design should eventually verify that:

- A Card can be created from TradingView without opening the main Cairn window.
- The user does not manually enter a timestamp to record a BAR-based observation.
- `BAR38` and `BAR41` can be extracted into structured JSON while the raw text remains unchanged.
- AI highlights exact source text rather than producing a polished replacement.
- Missing Entry information is surfaced before or immediately after confirmation.
- An Entry idea that is not executed remains visible as observation history.
- Multiple Intermediate Cards preserve their original order.
- Imported executions can be bound to the intended Case with ambiguous matches requiring confirmation.
- A bound Trade displays Cards and Executions as separate reasoning and fact layers.
- Historical Cards can be reprocessed with a newer taxonomy without changing raw text.

## 12. Open Questions for the Next Discussion

1. Where does a Case begin and end when Pre-entry observation continues for a long time?
2. What happens to a pending Case when no Trade is eventually executed?
3. Does an aborted Entry Card stay in the same Case until a later entry, or become part of a general Period observation stream?
4. Should Phase be selected by the user, suggested by AI, or inferred only after submission?
5. What exact reminders belong to each Card phase?
6. How should BAR numbers work across symbols, timeframes, imported datasets, and replay resets?
7. Can the existing Tampermonkey code reliably read the current TradingView symbol, timeframe, and replay BAR context?
8. How should Case-to-Trade matching handle several same-direction entries close together?
9. Should original audio be retained in addition to text?
10. Should `forward` / `retrospective` be recorded at Case level or Card level?
11. How should pre-entry market commentary appear when it applies to more than one possible Trade?
12. Should Cairn remain running in the tray, or should a separate lightweight local service receive browser records?
