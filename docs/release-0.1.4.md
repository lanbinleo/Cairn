# CAIRN 0.1.4 Release Notes

## Changes

- Upgrade TradingView import grouping to restore numbered entry/exit pairs first, then merge overlapping same-direction pairs into Cairn Trades.
- Fall back to Account, Period, Symbol, and direction position simulation when TradingView trade numbers are unavailable or incomplete.
- Treat repeated same-direction entries as `scale-in` executions instead of separate Trades.
- Keep TradingView `Trade #` values as source references rather than Cairn Trade boundaries.
- Warn during import preview when exits do not match the simulated position state.
- Aggregate same-bar, same-price exit executions in trade detail displays while preserving raw execution records.
- Refine page transition motion and make secondary buttons visually distinct from the page background.
- Replace separate trade-detail copy actions with a compact copy button and dropdown.
- Fix trade reference image uploads by passing Tauri attachment command arguments with the expected camelCase names.
- Show an inline error when a trade reference image cannot be saved.
- Add a click-to-open image lightbox with explicit close control and in-place zoom masking.
- Treat execution Bar inputs and displays as 1-based numbers while keeping stored execution times unchanged.
