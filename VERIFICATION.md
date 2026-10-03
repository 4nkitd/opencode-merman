# Verification

Date: 2026-10-03. OpenCode 2.0.22, OpenTUI 0.5.14, Bun 1.3.10, macOS arm64.

## Automated checks

- `bun run check`: 692 tests pass, 0 fail; typecheck passes.
- 15 inherited snapshots pass.
- Inherited layout audit: 302 sources, 306 viewport runs, 0 structural violations.
- All 22 original fixtures render as diagram objects through OpenTUI Markdown at 60 and 120 columns.
- Inset-container resize regression checks actual available width as the container changes between 70, 50 and 90 columns.
- YAML title preservation, malformed configuration, interrupted rendering, and overlapping connection identity have regression coverage.
- `git diff --check` passes.
- `npm pack --dry-run` includes the physical root `tui.ts` entrypoint, source, license and examples.

## Installed OpenCode client

`bun run script/verify-opencode.ts` imported deterministic fixture messages through OpenCode's API, then launched actual installed terminal clients. It used the same fixture session for both configurations, without invoking an AI model.

| Configuration | Visibly rendered sample numbers |
| --- | --- |
| Bundled renderer | 1, 2, 3, 9, 11, 13 |
| Standalone plugin | All 22 |

Assertions inspect each diagram's own terminal-screen region for visible labels and absence of raw source. Blank diagrams do not pass. Captured screens were also inspected for clipped chart endpoints, borders and graph destinations; the viewport reflow fix addresses those issues.

Local captures and session identifiers are in ignored `artifacts/opencode-verification.json`, `artifacts/opencode-builtin.txt`, and `artifacts/opencode-plugin.txt`. Temporary terminal processes are closed; fixture sessions remain for inspection.

Two V2.0.22 integration constraints were reproduced and fixed:

1. Local CLI plugin discovery requires a physical `tui.ts` under the configured directory. Direct file paths and a package export alone did not activate it.
2. The plugin imports `./markdown.ts` by its actual path. A `.js` alias bypassed OpenCode's host-module mapping, loaded an incompatible `TextRenderable` class instance, and produced blank output despite reserving diagram space.

## Coverage boundary

Passing this suite establishes support for the tested diagram families and supported grammar described in `README.md`. It does not establish complete compatibility with every Mermaid browser feature. Advanced unsupported syntax is rejected rather than silently discarded.

## One-command installer and 0.1.1 packaging

- Added a Node.js executable for `npx opencode-merman@latest install` and a persistent-checkout `install --local` route.
- Installer tests cover stable V2 version bounds, V1 refusal before writes, XDG settings, JSONC comments inside unrelated plugin options, exact backups, existing permissions, idempotence, updates, config symlinks, dangling-symlink refusal, and duplicate-key refusal.
- The package executable was exercised through `npm exec` from a real tarball with isolated settings; repeat installation was a no-op. This does not establish npm registry publication.
- A clean package rendering test initially failed because optional peers and `--legacy-peer-deps` omitted OpenTUI core. The runtime dependency declaration and GitHub installation command were corrected. A fresh tarball with production-only npm dependencies then visibly rendered all 22 samples in installed OpenCode 2.0.22, with no raw chart/class source.
- YAML is patched to 2.8.3 for GHSA-48c2-rrv3-qjmp, the deeply nested collection stack-overflow advisory.
- Four SVG and text previews are generated from actual installed OpenCode terminal captures. They preserve character layout and intentionally omit captured terminal colors. No prompts, credentials, account information, or real conversation content are included.
- Release checks pass with 692 renderer tests, 12 installer tests, and TypeScript checks. The production-only clean package npm audit reports zero vulnerabilities.
- npm registry publication is pending operator authentication. Do not treat the local tarball or successful executable test as a published npm release.
