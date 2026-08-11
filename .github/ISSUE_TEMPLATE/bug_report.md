---
name: Bug report
about: Report a defect in the compiler, CLI, or runtime
title: "[Bug] "
labels: bug
assignees: ""
---

## Description

A clear and concise description of what the bug is.

## Steps to reproduce

1. Create the following `.prompt` file:

```promptlang
// your minimal reproduction here
```

2. Run the following command:

```bash
promptlang compile my-file.prompt
```

3. Observe the error.

## Expected behavior

What you expected to happen.

## Actual behavior

What actually happened. Include the full error output.

## Environment

- PromptLang version: (run `promptlang --version`)
- Bun version: (run `bun --version`)
- OS: (e.g. macOS 14.5, Ubuntu 22.04)
- Node version (if applicable): (run `node --version`)

## Additional context

Add any other context about the problem here. If the bug is related to a specific
model provider (Anthropic, OpenAI, etc.), mention which one.
