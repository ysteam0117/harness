---
name: demo-planner
description: テスト用の計画の役割。ファイルは編集しない。
claude:
  tools: Read, Grep, Glob
  model: "{{claude_model_planner}}"
codex:
  name: demo_planner
  model: "{{codex_model_planner}}"
  model_reasoning_effort: "{{codex_effort_planner}}"
  sandbox_mode: read-only
---

# 計画（{{app_name}}）

作業の過程と結果は、すべて日本語で書く。
