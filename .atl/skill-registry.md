# Skill Registry — regwatch

> Pre-resolved skill paths for orchestrator → sub-agent delegation.
> Sub-agents do NOT search for this registry; the orchestrator passes paths directly.

## Source Locations Scanned

- User-level: `~/.config/opencode/skills/`
- Project-level: _(none — greenfield)_

## Project Conventions

- `~/.config/opencode/AGENTS.md` — global agent rules (Senior Architect persona, conventional commits, no AI attribution, delegate-first orchestration)

No project-level convention files yet (no `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `GEMINI.md` in repo root).

## Coding Skills (load when context matches)

| Skill                 | Path                                                       | Trigger                                                       |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| nextjs-15             | `~/.config/opencode/skills/nextjs-15/SKILL.md`             | Next.js App Router, routing, Server Actions, data fetching    |
| react-19              | `~/.config/opencode/skills/react-19/SKILL.md`              | React components (no useMemo/useCallback with React Compiler) |
| nestjs-best-practices | `~/.config/opencode/skills/nestjs-best-practices/SKILL.md` | NestJS modules, controllers, services, DTOs, guards           |
| typescript            | `~/.config/opencode/skills/typescript/SKILL.md`            | TypeScript strict types, interfaces, generics                 |
| tailwind-4            | `~/.config/opencode/skills/tailwind-4/SKILL.md`            | Tailwind v4 styling, cn(), theme variables                    |
| zod-4                 | `~/.config/opencode/skills/zod-4/SKILL.md`                 | Zod v4 schema validation                                      |
| zustand-5             | `~/.config/opencode/skills/zustand-5/SKILL.md`             | Zustand v5 React state                                        |
| playwright            | `~/.config/opencode/skills/playwright/SKILL.md`            | E2E tests, Page Objects                                       |

## Workflow Skills

| Skill          | Path                                                | Trigger                                           |
| -------------- | --------------------------------------------------- | ------------------------------------------------- |
| issue-creation | `~/.config/opencode/skills/issue-creation/SKILL.md` | Creating GitHub issues                            |
| branch-pr      | `~/.config/opencode/skills/branch-pr/SKILL.md`      | Opening PRs                                       |
| idea-validator | `~/.config/opencode/skills/idea-validator/SKILL.md` | Validating product ideas (PCV / Opportunity Memo) |

## SDD Phase Skills (used by orchestrator meta-commands)

| Phase       | Path                                             |
| ----------- | ------------------------------------------------ |
| sdd-init    | `~/.config/opencode/skills/sdd-init/SKILL.md`    |
| sdd-explore | `~/.config/opencode/skills/sdd-explore/SKILL.md` |
| sdd-propose | `~/.config/opencode/skills/sdd-propose/SKILL.md` |
| sdd-spec    | `~/.config/opencode/skills/sdd-spec/SKILL.md`    |
| sdd-design  | `~/.config/opencode/skills/sdd-design/SKILL.md`  |
| sdd-tasks   | `~/.config/opencode/skills/sdd-tasks/SKILL.md`   |
| sdd-apply   | `~/.config/opencode/skills/sdd-apply/SKILL.md`   |
| sdd-verify  | `~/.config/opencode/skills/sdd-verify/SKILL.md`  |
| sdd-archive | `~/.config/opencode/skills/sdd-archive/SKILL.md` |

## Stack-Specific Recommendations for regwatch

Based on the detected stack (see `sdd-init/regwatch` engram entry):

- **Backend (Express + ADK + TypeScript)**: load `typescript` always. NestJS skill does NOT apply (this is plain Express).
- **Frontend (Next.js 14 App Router + Tailwind + React)**: load `nextjs-15` (compatible with v14 App Router patterns), `react-19`, `tailwind-4`.
- **Validation**: load `zod-4` for request/agent-output schemas.
- **Client state (if needed)**: load `zustand-5`.
- **E2E**: load `playwright`.
- **Always**: load `typescript` for any TS file.
