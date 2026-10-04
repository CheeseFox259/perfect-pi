---
name: prototype
description: Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

In Pi, load this skill via `/skill:prototype` or by reading its advertised `SKILL.md` path.

## Pick a branch

Identify which question is being answered, using the user's prompt, the surrounding code, or by asking if the user is around (in interactive Pi sessions, use `question` to clarify):

- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md). Build a single shareable HTML file (free-play buttons plus tabbed guided walkthroughs) that pushes the state machine through cases that are hard to reason about on paper, and that a non-developer can drive.
- **"What should this look like?"** → [UI.md](UI.md). Generate several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.

The two branches produce very different artifacts, so getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious, but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes, obey whatever routing convention the project already uses; don't invent a new top-level structure.
2. **Trivial to run.** If a local server or watcher is required, run and manage it with Pi's `process` tool rather than a blocking shell command. A logic demo is a single HTML file that can be inspected with `agent_browser` or opened by the user. Either way, no thinking required to start it.
3. **Inspect with native Pi tools.** For browser automation and visual verification of rendered UI, use the native `agent_browser` tool (do not run ad-hoc browser shell commands).
   - **Visual concept mockups via ChatGPT:** For UI prototypes, when the user lacks a dedicated image generation API, present the structured DALL-E prompt via `question`, capture the generated image from the system clipboard with `node scripts/clipboard-image.mjs .scratch/mockup.png`, and pull it into context with `read` before drafting code.
4. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE, wipe me" name.
5. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast.
6. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
7. **Capture it when done.** Fold any validated decision into the real code, then capture the prototype itself as a **primary source**: commit it to a throwaway branch, out of main, and leave a context pointer to that branch on the implementation issue. Capture the answer too (the verdict and the question it settled) in the issue or a commit. The main branch keeps only the validated decision.
