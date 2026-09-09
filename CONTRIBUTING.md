# Contributing

Thank you for improving AI Translation Stack. Contributions should make translation pipelines safer, more deterministic, or easier to adopt.

## Development setup

```bash
npm ci
npm run build
npm test
```

The repository uses strict TypeScript, Prettier, a dependency-free static lint gate, and Vitest. Run the full local gate before opening a pull request:

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run secret:scan
npm run package:check
```

## Change guidelines

- Keep the catalog source-of-truth and source-state behavior explicit and tested.
- Do not commit real catalogs, translated customer content, translation-memory entries, embeddings, provider responses, provenance containing sensitive text, or environment files.
- Provider calls must be mocked in unit tests. Tests must not require an API key or send fixture text to an external service.
- Preserve placeholders and HTML tags. Add a regression test when changing validation behavior.
- Keep provider-specific behavior behind an adapter. Core catalog and memory logic must remain provider-neutral.
- Do not add a second implementation of catalog synchronization, memory persistence, or locale fallback.
- Update the README when the public command surface or configuration contract changes.

## Pull requests

Describe the behavioral change, the validation commands you ran, and any compatibility or data-migration implications. Do not include secrets in logs, screenshots, fixtures, or issue descriptions.

By contributing, you agree that your contribution is provided under the Apache License, Version 2.0, as described in `LICENSE`.
