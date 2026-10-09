# Fork additions

This inventory records the functional changes carried by `customized` after comparison with `origin/main` at `9532eb39ca` (`v18.4.4`) on 2026-09-30.

## Context soft limit

- Adds a configurable presentation budget for context usage, defaulting to 200K tokens.
- Displays usage against that budget until usage crosses it.
- After crossing the budget, displays the model's actual context window and turns the gauge red.
- Setting the limit to `0` disables it.
- Models with smaller context windows continue to use their real limit.
- Includes settings UI, footer/status-line integration, and regression coverage.

## Sonar Pro web search

- Routes Perplexity Sonar Pro through an OpenAI-compatible LLM proxy.
- Supports `sonar.proxyUrl` / `SONAR_PROXY_URL`, `sonar.apiKey` / `SONAR_API_KEY`, and `sonar.model` / `SONAR_MODEL`.
- Defaults to `sonar-pro`.
- Parses citations and usage metadata returned by the proxy.
- Registers the existing Kimi, Zai, and Anthropic search providers.
- Adds Exa researcher and webset enablement settings.

## Markdown task lists

- Renders `- [ ]` as `☐`.
- Renders `- [x]` as `☑`.
- Leaves ordinary unordered and ordered lists unchanged.

## File hyperlinks

- Resolves relative paths against the current working directory.
- Emits absolute OSC 8 file targets.
- Keeps line and column locations out of plain `file:` URIs for macOS and JVM-tool compatibility.
- Uses the position-aware `vscode://file` form for the VS Code terminal family.
- Applies the behavior to read, grep, edit, and skill renderers.

## Removed customizations

- Removed the standalone `CLAUDE.md` customization because upstream's `claude-md` provider now walks from the working directory to the repository or home boundary. The Claude provider still handles `<cwd>/.claude/CLAUDE.md`.
- Removed the MCP OAuth discovery customization because upstream supports nested-path and Keycloak discovery.
- Removed the pull-request status cache fix because upstream clears the cache when no branch is available.
