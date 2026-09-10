# AI Translation Stack

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node.js-22%2B-339933.svg)](https://nodejs.org/)

## What is included

| Layer                 | Responsibility                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Catalog core          | Load, validate, audit, baseline, synchronize, and atomically checkpoint JSON catalogs.                             |
| Source-state tracking | Detect changed English/source values and invalidate stale locale values.                                           |
| Message safety        | Preserve placeholders and HTML tag names/counts across translation.                                                |
| Glossary              | Validate curated entries, build provider context, reject forbidden terms, and learn high-confidence proposals.     |
| Exact memory          | Reuse approved translations only when their identity is still valid.                                               |
| Semantic memory       | Store packed float32 vectors, reconcile orphaned entries, and rank similar examples by cosine similarity.          |
| Context extraction    | Heuristically infer UI role, screen, sibling keys, and length budgets from TypeScript/JS call sites.               |
| Source scanner        | Detect likely hard-coded user-facing strings and enforce a reviewed baseline ratchet.                              |
| Provenance            | Record locale, model, requested/accepted/omitted keys, response id, errors, and usage without storing prompt text. |
| Provider adapter      | Translate JSON objects and optionally create embeddings through provider-specific APIs.                            |
| Next integration      | Supply merged messages to `next-intl` with a configurable locale fallback policy.                                  |
| CLI and CI            | Run the checks locally and in GitHub Actions without requiring a provider secret.                                  |

## Architecture

```text
source catalog (en.json)
        │
        ├── source snapshot ── stale-source invalidation
        │
        ├── catalog audit/sync ── locale catalogs ({locale}.json)
        │
        └── translation runner
              ├── context extraction
              ├── exact translation memory lookup
              ├── optional semantic example retrieval
              ├── glossary-aware provider request
              ├── structural + terminology validation
              ├── atomic per-chunk catalog checkpoint
              ├── exact memory and optional vector checkpoint
              ├── glossary learning (high-confidence only)
              └── provenance batch record

next-intl adapter ── source catalog + non-empty locale values ── merged runtime messages
```

The core is intentionally independent of a web framework. It reads and writes catalogs through explicit paths, and it accepts provider implementations through `TranslationProvider`. The `next-intl` integration is an adapter, not a requirement of the catalog engine.

## Requirements

- Node.js 22.17 or newer
- npm with lockfile support
- TypeScript 7 native compiler is used by the checked-in typecheck command
- An API key is required only for `translate`
- A catalog directory and a JSON configuration file

No provider request is made by `audit`, `sync`, `baseline`, `scan`, `test`, `lint`, or `build`.

## Quick start

```bash
git clone https://github.com/<owner>/ai-translation-stack.git
cd ai-translation-stack
npm ci
npm run build
npm test
```

The repository contains newly authored fixtures under `examples/`. Establish the source snapshot before auditing or translating those fixtures:

```bash
node dist/cli.js baseline --config examples/translation.config.json
node dist/cli.js audit --config examples/translation.config.json
node dist/cli.js scan --config examples/translation.config.json --write-baseline --check
```

The same command surface is available through the npm scripts. For example:

```bash
npm run catalog:baseline -- --config examples/translation.config.json
npm run catalog:audit -- --config examples/translation.config.json
npm run source:scan -- --config examples/translation.config.json --check
```

`sync` copies missing and empty source values into locale catalogs, invalidates values whose source changed, preserves non-empty translations, and preserves locale-only keys:

```bash
node dist/cli.js sync --config examples/translation.config.json
node dist/cli.js sync --config examples/translation.config.json --dry-run
```

## Running AI translation

Copy `.env.example` to your own environment configuration or export the variables through your shell. Do not commit the resulting file.

```powershell
# Select one provider. The CLI flag --provider overrides this variable.
$env:TRANSLATION_PROVIDER = 'deepseek'
$env:DEEPSEEK_API_KEY = Read-Host 'DeepSeek API key'
$env:TRANSLATION_MODEL = 'deepseek-v4-flash'

# Translate only one locale first
node dist/cli.js translate --provider deepseek --config examples/translation.config.json --locale de --verbose
```

The supported provider identifiers are `openai`, `claude`, `deepseek`, `glm`, `grok`, and `gemini`. The equivalent environment variables are listed in `.env.example`; only the credential for the selected provider is required. Provider-specific model defaults are used when `TRANSLATION_MODEL` is empty.

Supported runner options:

| Option            | Effect                                                                            |
| ----------------- | --------------------------------------------------------------------------------- |
| `--config <path>` | Load a typed JSON configuration from this path.                                   |
| `--locale <code>` | Process one configured target locale.                                             |
| `--full`          | Re-request eligible values instead of using incremental selection.                |
| `--dry-run`       | Call the provider and report validation without writing catalog or sidecar files. |
| `--no-memory`     | Skip exact and semantic memory reuse for this run.                                |
| `--verbose`       | Report rejected keys and chunk outcomes without printing source text or secrets.  |

The runner checkpoints after each chunk. A failed chunk is recorded in provenance and the next chunk/locale can continue. A retry of a successful chunk replaces the same memory identity rather than appending an unbounded duplicate.

### Provider boundary

The core depends on this interface:

```ts
export interface TranslationProvider {
  readonly name: string
  readonly model: string
  translate(request: TranslationRequest): Promise<TranslationResponse>
  embed?(texts: readonly string[]): Promise<readonly (readonly number[])[]>
}
```

The package includes six selectable provider adapters:

| Provider | Selector   | Credential                       | Default model                | Transport                             | Semantic embeddings |
| -------- | ---------- | -------------------------------- | ---------------------------- | ------------------------------------- | ------------------- |
| OpenAI   | `openai`   | `OPENAI_API_KEY`                 | `gpt-5.6-luna`               | OpenAI-compatible chat and embeddings | Enabled             |
| Claude   | `claude`   | `ANTHROPIC_API_KEY`              | `claude-sonnet-4-5-20250929` | Native Messages API                   | Not assumed         |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY`               | `deepseek-v4-flash`          | OpenAI-compatible chat                | Not assumed         |
| GLM      | `glm`      | `GLM_API_KEY` (or `ZAI_API_KEY`) | `glm-4.6`                    | Z.AI OpenAI-compatible chat           | Not assumed         |
| Grok     | `grok`     | `XAI_API_KEY`                    | `grok-4.6`                   | xAI OpenAI-compatible chat            | Not assumed         |
| Gemini   | `gemini`   | `GEMINI_API_KEY`                 | `gemini-3.8-flash`           | Native Gemini Interactions API        | Not assumed         |

Use `--provider <name>` for a single run or `TRANSLATION_PROVIDER=<name>` for the default CLI selection. `TRANSLATION_MODEL`, `TRANSLATION_BASE_URL`, timeout, and completion-token settings are shared overrides; provider-specific base URL variables are available for private gateways and regional endpoints. Claude uses its native request field for the output limit, while the GPT-5-compatible path uses `max_completion_tokens`.

The OpenAI-compatible adapters share bounded fetch retries, JSON extraction, glossary proposal parsing, usage mapping, and response validation. DeepSeek enables JSON mode; GLM and Grok rely on the strict JSON prompt plus tolerant parser because their compatible endpoints can differ by deployment. Claude extracts only text content blocks and deliberately does not advertise an embedding method. Gemini uses the native Interactions API with a JSON response format, maps `model_output` text steps and native usage fields, opts out of server-side storage with `store: false`, and deliberately does not advertise an embedding method. When a provider has no embedding method, exact translation memory, glossary checks, structural validation, checkpoints, and provenance continue to work; only semantic retrieval is skipped.

Review each provider's current documentation and data controls before sending a catalog: [Claude Messages](https://platform.claude.com/docs/en/api/messages-examples), [DeepSeek JSON output](https://api-docs.deepseek.com/guides/json_mode/), [Z.AI OpenAI-compatible setup](https://docs.z.ai/guides/develop/openai/python), [xAI chat completions](https://docs.x.ai/developers/model-capabilities/legacy/chat-completions), [Gemini Interactions API](https://ai.google.dev/api/interactions-api), and [Gemini REST quickstart](https://ai.google.dev/tutorials/rest_quickstart). Source strings can contain business logic, personal data, or confidential product language; the stack does not classify or redact them for you.

## Configuration

`translation.config.json` is the source of truth for locale and storage policy. The included template shows the full target-locale shape used by the original stack without shipping its catalogs or translated values. The `examples/translation.config.json` file is intentionally smaller so CI remains deterministic and data-free.

Important fields:

```json
{
  "sourceLocale": "en",
  "locales": [{ "code": "de", "name": "German", "nativeName": "Deutsch" }],
  "messagesDir": "messages",
  "sourceSnapshotFile": ".en-source-snapshot.json",
  "translationMemoryFile": ".translation-memory.json",
  "semanticMemoryFile": ".semantic-memory.json",
  "confirmedSameFile": ".confirmed-same.json",
  "glossaryFile": "translation-glossary.json",
  "provenanceFile": ".provenance.json",
  "chunkSize": 100
}
```

Paths are resolved relative to the configuration file. The source catalog is `<messagesDir>/<sourceLocale>.json`; target catalogs are `<messagesDir>/<locale>.json`. Target locale codes are derived from `locales`, so the CLI and runtime adapter do not maintain a second hand-copied language list.

### Catalog policy

- Source values must be strings.
- Empty and missing target values are pending and fall back to the source value at runtime.
- Non-empty target translations are preserved by `sync`.
- Extra target keys are reported rather than silently deleted.
- Changed source values are reset to the source value before they become eligible for retranslation.
- Removed source keys are not automatically deleted from target catalogs; review them as a deliberate cleanup.
- The source snapshot must be created intentionally with `baseline` and should be reviewed like any other generated state.

## `next-intl` integration

Install `next-intl` in the host application and create a request configuration that uses the adapter:

```ts
// i18n/request.ts
import { createNextIntlRequestConfig } from 'ai-translation-stack/next-intl'
import { loadTranslationConfig } from 'ai-translation-stack'

const config = loadTranslationConfig('./translation.config.json')

export default createNextIntlRequestConfig({ config })
```

The adapter:

1. awaits the requested locale;
2. accepts only the source locale or a configured target locale;
3. falls back to the source locale for an unknown value;
4. loads the source catalog first;
5. overlays only non-empty string translations; and
6. returns one merged message object for the framework.

Keep authentication, route negotiation, cookies, country detection, analytics, authorization, and application navigation in the host application. They do not belong in this reusable adapter.

## Validation and CI

The blocking local gate is:

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run catalog:audit -- --config examples/translation.config.json
npm run source:scan -- --config examples/translation.config.json --check
npm run secret:scan
npm run package:check
```

GitHub Actions runs the same categories on Node.js 22.17. The tests use temporary directories and mocked providers; they never insert state directly into an external database and never require a network credential.

The source scanner is intentionally heuristic. It is a review ratchet, not an AST proof that every string is localized. Treat additions as a code-review decision and keep the baseline small and current.

## Repository layout

```text
src/
  adapters/next-intl.ts       optional runtime integration
  cli.ts                      command-line entry point
  config.ts                   typed configuration loader
  core/
    atomic-json.ts            atomic JSON/binary persistence with retries
    catalog.ts                audit, baseline, and synchronization
    context.ts                usage-context extraction
    message-structure.ts      placeholder/tag validation
    provenance.ts             provider-run provenance
    semantic-memory.ts        packed-vector semantic memory
    source-scan.ts            hard-coded-string scanner
    source-state.ts           source snapshot and stale invalidation
    translation-glossary.ts   glossary validation and learning
    translation-memory.ts     exact translation memory
    types.ts                  public contracts
  providers/claude.ts        native Claude Messages adapter
  providers/deepseek.ts      DeepSeek-compatible adapter
  providers/factory.ts       CLI/environment provider selection
  providers/glm.ts           GLM-compatible adapter
  providers/grok.ts          Grok-compatible adapter
  providers/http.ts          bounded fetch transport and retries
  providers/openai.ts        backward-compatible OpenAI adapter
  providers/openai-compatible.ts shared compatible transport
  providers/shared.ts        prompts, JSON, glossary, and usage normalization
  translate.ts                chunked translation orchestrator
examples/
  messages/                   small, newly authored catalog fixtures
  source/                     small, newly authored call-site fixture
  translation.config.json    deterministic CI configuration
scripts/
  lint.mjs                    dependency-free static lint entry point
  secret-scan.mjs             repository secret scan
```

Runtime sidecars are intentionally not part of the public source fixture. They contain project-specific translations, provider metadata, or embeddings when generated and are ignored by default.

## When to use it

Use this stack when a project has JSON message catalogs, incremental translation runs, repeated terminology, or a framework runtime that must fall back safely when a locale is incomplete.

It is not a complete content-management system, a human translation agency, a secrets manager, a privacy classifier, or a guarantee that an AI translation is linguistically correct. Human review remains appropriate for legal, medical, financial, safety-critical, and brand-sensitive language.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and pull-request expectations. Keep provider calls behind mocks in tests, do not add real customer catalogs, and include a regression test for every changed safety rule.

## Security and data handling

See [SECURITY.md](SECURITY.md). Never commit `.env` files, API keys, provider responses, translation-memory entries from confidential work, embeddings, or provenance that exposes sensitive source text. Atomic persistence protects a file checkpoint from partial writes; it does not make the surrounding filesystem or provider trustworthy.

## License and notices

AI Translation Stack is distributed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE) for project attribution and trademark clarification. The Apache License is a permissive software license; this repository is not operated by or affiliated with the Apache Software Foundation.
