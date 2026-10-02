# Domain docs

Before exploring, read `GLOSSARY.md` or the relevant files named by `GLOSSARY-MAP.md`, then read ADRs in `docs/adr/` and any context-specific ADR directory. If a file does not exist, proceed silently. Use glossary vocabulary in specs, tickets, reviews, and test names. Surface ADR conflicts instead of silently overriding them.

A single-context repository uses:

```text
/GLOSSARY.md
docs/adr/
```

A multi-context repository uses a root `GLOSSARY-MAP.md`, shared `docs/adr/`, and context-local `GLOSSARY.md`/`docs/adr/` directories.
