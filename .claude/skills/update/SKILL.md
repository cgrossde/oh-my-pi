---
name: update
description: Safely update this customized oh-my-pi fork from remote main with a pre-update fork backup, an explicit approval gate, and no post-update push.
---

# Update the customized fork

Use this skill only for updating the customized fork from the upstream repository's `main`. The workflow has two phases: **backup and compare**, then **approved update**.

## Fork description

This repository is a customized fork of oh-my-pi. The working branch is normally `customized`; the upstream `main` and the writable fork remote MUST be discovered from the local remotes each time. Do not hard-code commit counts, hashes, or remote names into this skill.

Treat upstream updates as a rebase, not a merge, so the fork keeps a linear history. Rebasing rewrites the customized branch, which is why the pre-update fork push is REQUIRED and must remain the recovery point. Never overwrite that backup after the rebase.

Upstream changes can overlap fork-specific behavior and generated catalog files. Resolve conflicts by preserving both intended behaviors where they do not compete; regenerate catalog outputs from their sources instead of hand-merging generated JSON. After a rebase, inspect the fork-only commits, rerun the relevant generators when their sources changed, and verify the affected behavior before reporting success.

## Safety invariants

- A dirty or uncommitted worktree blocks the workflow. NEVER discard, reset, clean, or stash user work silently.
- Discover remotes and their fetch/push URLs; NEVER assume `origin` is upstream or the fork.
- The backup MUST be pushed to the identified fork remote, never to upstream `main`.
- Push the current branch to the fork before any rebase. This is the pre-update backup.
- NEVER push to the fork after the update, including after install or native build.
- Missing, detached, ambiguous, or non-writable remotes require stopping and asking the user; do not guess.
- A non-affirmative response is not approval. Do not reinterpret silence, “maybe,” or unrelated feedback as approval.

## Phase 1: backup and compare

1. Confirm the repository root and inspect state:

   ```sh
   git rev-parse --show-toplevel
   git status --short --branch
   git symbolic-ref --short HEAD
   ```

   Stop if `git status --short` reports any path, the branch is detached, or the repository is not the expected customized fork.

2. Discover and classify remotes before any push:

   ```sh
   git remote -v
   git remote show <candidate>
   git ls-remote --heads <candidate> main
   ```

   Identify one remote that owns the canonical `main` and one distinct, writable remote that is the user's fork. Check both fetch and push URLs. If either role is missing or unclear, stop and ask the user which remotes are upstream and fork; do not push.

3. Create the backup before any update operation. Replace placeholders only after remote classification:

   ```sh
   branch=$(git symbolic-ref --short HEAD)
   git push <fork-remote> "HEAD:$branch"
   git fetch <upstream-remote> main
   ```

   The push MUST succeed before fetching or comparing. Do not use `--force`; if the fork rejects the push, stop and report it. Record the fork remote, branch, and backed-up commit.

4. Compare `HEAD` with `<upstream-remote>/main` and present a useful TLDR before changing files:

   ```sh
   git log --oneline --decorate "HEAD..<upstream-remote>/main"
   git log --oneline --decorate "<upstream-remote>/main..HEAD"
   git diff --stat HEAD "<upstream-remote>/main"
   git diff --name-status HEAD "<upstream-remote>/main"
   ```

   Summarize upstream commits and affected areas, the customized commits that diverge, likely conflicts, and the resulting change size. Do not rebase, install, build, or push again in this phase.

5. STOP and ask: `Proceed with rebase onto <upstream-remote>/main, bun install, and native rebuild?` Wait for an explicit user `yes` before Phase 2.

## Phase 2: approved update only

Run these steps only after an unambiguous affirmative answer:

```sh
git rebase <upstream-remote>/main
bun install
bun run build:native
git status --short --branch
git log -1 --oneline --decorate
```

- If rebase conflicts, stop for user resolution; do not continue to install or build.
- If `bun install` or `bun run build:native` fails, stop and report the failure; preserve the pre-update backup and do not push.
- Verify each command succeeds and report the final commit, worktree state, dependency-install result, and native-build result.
- The fork backup was completed in Phase 1. NEVER run `git push` in Phase 2.
