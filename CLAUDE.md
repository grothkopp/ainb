# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Notebook (ainb) is an offline-first, browser-based AI playground at [ainb.dev](https://ainb.dev). It allows creating notebooks with mixed cell types (Markdown, Variable, Prompt, Code) that can reference each other via templates (`{{ cell_name }}`).

## Development

**No build system required** - This is a vanilla ES6 modules application that runs directly in the browser.

**To run locally**: Open `index.html` in a modern browser.

**Tests**: Located in `vendor/lost/tests/` (framework-level tests).

## Architecture

### Data Flow
```
User Action → Lost.update() → "update" Event → CellRenderer.renderNotebook()
                                                        ↓
                                            Cell Execution (if triggered):
                                            - Prompt: TemplateManager → LlmManager → API
                                            - Code: Sandboxed iframe execution
                                                        ↓
                                            CellManager.applyStaleness() → localStorage
```

### Core Components

| File | Class | Purpose |
|------|-------|---------|
| `app_ainotebook.js` | `AiNotebookApp` | Main orchestrator. Initializes LOST, coordinates managers, handles rendering |
| `cells.js` | `CellManager` | Cell CRUD operations, staleness propagation via dependency graph |
| `cells.js` | `CellRenderer` | DOM rendering of cells, output updates, UI state |
| `cell_prompt.js` | `PromptCellManager` | LLM prompt execution, template expansion, request cancellation |
| `cell_code.js` | `CodeCellManager` | JavaScript execution in sandboxed iframes |
| `llm.js` | `LlmManager` | LLM provider config, model caching, API calls (OpenAI, Anthropic, OpenRouter, custom) |
| `template.js` | `TemplateManager` | Resolves `{{ name }}`, `{{ #1 }}`, `{{ ENV["KEY"] }}`, JSON path access |
| `settings.js` | `SettingsDialog` | Modal for LLM providers, API keys, environment variables |
| `ui.js` | - | Reusable UI widgets (Model Picker, Parameter Editor, Log Overlay) |

### LOST Framework (vendor/lost/)

The app is built on the LOST (Local, Offline, Shareable Tools) framework which provides:
- **`lost.js`**: State management, localStorage persistence, URL hash compression for sharing
- **`lost-ui.js`**: UI shell (header, sidebar for notebook list, footer for sharing)
- Properties starting with `_` are excluded from shared state (used for local-only UI state)

## Cell Data Structure

```javascript
{
  id: "cell_abc123",
  type: "prompt",           // markdown | prompt | variable | code
  name: "my_cell",          // Reference name for templates
  text: "...",              // Cell content
  systemPrompt: "...",      // Prompt cells only
  params: "temperature=0.5",// Prompt cells only
  modelId: "openai/gpt-4",  // Prompt cells only
  lastOutput: "...",        // Most recent output
  error: "",                // Error message
  _stale: false,            // Depends on modified cells (local-only)
  autorun: false            // Auto-execute on dependency change
}
```

## Storage

- **Notebook data**: `localStorage["app-ainotebook-v1"]`
- **LLM settings**: `localStorage["ainotebook-llm-settings-v1"]`

## Security Notes

- Code cells run in `<iframe sandbox="allow-scripts">` without `allow-same-origin`
- API keys stored only in localStorage, sent only to configured LLM providers
- HTML sanitization applied to markdown outputs
