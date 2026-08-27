# CAIRN 0.2.0 Release Notes

0.2.0 delivers the Case recording system: capture trading reasoning at the moment it happens, let the AI act as a secretary, and review decisions against execution. Also includes the previously unreleased 0.1.4 import improvements.

## Case Recording System

- New Case entity (Account → Period → Case) with five-phase Cards: Pre-entry, Entry, Intermediate, Closing, Reflection. Cases can exist before any Trade is imported; one active Case binds to one Trade.
- Case management pages: list with combined filters, detail page with per-phase recording prompts, case tags (seven colors), and a card move repair path between Cases.
- Raw card text is permanent but typo-correctable: every edit pushes the previous wording into `rawTextHistory`; AI output never rewrites it.
- TradingView floating capture widget (Tampermonkey userscript) with current-Case session model, per-phase checklist hints, and a companion PineScript Bar Count indicator aligned with the barRef convention (UTC day boundary).
- Case auto-close: once the bound Trade is fully closed and a Closing Card exists (or a Reflection Card exists with no binding), the Case flips to 已完成 automatically; manual status edits always win.

## AI Secretary

- OpenAI-compatible provider settings: multiple providers, preset logos, model list fetch; credentials stay local and out of backups.
- Per-card structured extraction: six-field entry memo (direction, stop, target, confidence, invalidation, rejected alternatives), verbatim quote labels, mechanically derived missing-field checklist.
- Batch "全部 AI 整理" with per-card busy/error state, compact one-line footer, memo detail popover, and retry with a correction instruction.
- AI-drafted Case titles (≤20 chars) applied from the Case page.
- Memo direction renders as 做多/做空 with color instead of raw English values.

## Trade Analysis

- Process score (ten points, decision-time only) on the Trade tab: mechanical items derived live, judgment items human-scored, saved with a computed snapshot; header shows the saved total.
- Risk decomposition: R anchored to the first entry fill and initial stop (scaling in never dilutes it), actual risk summed per entry fill against the stop in effect at that fill, both R values shown side by side without judgment.
- 计划 vs 实际 comparison card: plan direction/stop/target against actual direction, final stop, and average exit.
- Trade list advanced filter: quick toggles (unscored, exit off plan, stop widened, missing initial stop), R / process-score ranges, removable chips, and localStorage-backed filter presets.

## Import

- (from 0.1.4) TradingView import restores numbered entry/exit pairs first, then merges overlapping same-direction pairs; falls back to position simulation when trade numbers are missing; repeated entries become `scale-in` executions; import preview warns on unmatched exits.
- (from 0.1.4) Same-bar same-price exits aggregate in display; trade detail gets a compact copy button and an image lightbox with zoom.
- Import Case matching: exact time-window matches (account + entry/closing card times within ±15 min) auto-bind with a green dot; partial or overlapping matches are yellow suggestions; no-match trades show red. Cases carry no symbol, so verify the instrument when confirming.

## Local REST API

- Local-only HTTP service (127.0.0.1:8787, Bearer token) for companion scripts: cases, cards, bindings, case tags, accounts; idempotent card creation; `cairn://data-changed` live refresh into the app UI; token/port management in Settings.

## Fixes

- Popover focus no longer scrolls the page to the top when opening the retry input.
- Link-styled buttons no longer trigger Base UI native-button warnings.
- Case page timestamps render as readable relative times (N 分钟前 / 昨天 / MM-DD, hover shows full UTC).
- Sidebar renamed: Cases → 案例, 品种与设置 → 设置.
