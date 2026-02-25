# Architecture Decision Records

We use [MADR](https://adr.github.io/madr/) (Markdown Architectural Decision Records) to capture significant design decisions.

## File naming

```
YYYYMMDDHHmmss-short-slug.md
```

- **Prefix** — creation timestamp in `YYYYMMDDHHmmss` format (14 digits, local time).
- **Slug** — lowercase, hyphen-separated summary of the topic.

Example: `20260225095833-email-intake-matching-and-processing.md`

## Minimal template

Based on [MADR 4.0 minimal template](https://github.com/adr/madr/blob/4.0.0/template/adr-template-minimal.md):

```markdown
# {Short title of solved problem and solution}

## Context and Problem Statement

{Describe the context and problem in 2–3 sentences.}

## Considered Options

* {Option 1}
* {Option 2}
* {Option 3}

## Decision Outcome

Chosen option: **"{Option N}"**, because {justification}.

### Consequences

* Good, because {positive consequence}.
* Bad, because {negative consequence}.
```

Sections like **Implementation**, **Edge cases**, and **Files to modify** may be added as needed — the template is a starting point, not a ceiling.
