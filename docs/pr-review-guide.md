# Reviewing pull requests

Review observable behavior across the whole PR, including callers, consumers, and lifecycle transitions.
Reading every changed file and passing tests do not establish that those behaviors were covered.
Use [contributing](contributing.md) for setup and validation commands.


## Establish the scope

- Record the PR's base and current head; preserve unrelated work with an isolated checkout when needed.
- Read the requirements and relevant documentation at the reviewed revision.
  Distinguish intended policy from observed behavior when they disagree.
- Map each affected behavior from input through authorization, routing, state changes, and its consumers.
  On a follow-up, verify the fixes and reassess the whole PR's affected behavior; explicitly label a deliberately narrower review.
- Trace the actual entrypoint and earlier guards before declaring a failure reachable.
  Check supported configurations and compatibility policy; a merged revision or earlier clean review is not proof of correctness.


## Exercise the boundaries

- Write a small matrix of relevant states and transitions before probing.
  For example, distinguish configured, loaded, installed, and post-restart plugin state; test each operation permission independently.
- Check adverse paths as well as success: failure, retry, removal, restart, reconnect, and overlapping operations where applicable.
  Select relevant cases from these recurring review gaps:

  | Boundary | Questions to check |
  | --- | --- |
  | Data contracts | Does real serializer output satisfy every consumer, including Lua restoration and inspection UI? Check omitted, empty, partial, malformed, reserved, and numeric-limit values before durable mutation. |
  | State and identity | Do delayed reads and mutation completions still belong to the selected entity? Do disabled components retain their local state? Can an identifier or generation be reused after recovery? |
  | Persistence and synchronization | Do save/reload, migration, deletion, and resubscription preserve versions and tombstones? Compare full snapshots, deltas, and optimized paths with ordinary transfers. |
  | Ownership and errors | Can concurrent work remove another operation's lock, handle, or cache? Check synchronous throws, early promise rejection, partial mutation, and cleanup after each failure. |
  | Protocol and compatibility | What does the receiver do with the message, close code, or acknowledgement? Check early startup, mixed versions, and supported older APIs. |
  | Distribution | Do generated validators, browser bundles, and installed packages behave like the source checkout? Check actual export maps and plugin discovery. |

- Use focused reproductions with concrete inputs and expected versus actual results.
  Keep the logic under review real: stubbing permissions, effects, or state transitions can erase the defect being investigated.
  Check that the harness reaches the intended path; compare a normal case and the base revision where practical.
- Control concurrency with explicit gates and assertions about ownership and completion, rather than timing alone.


## Account for every candidate

- Keep a compact ledger of candidate issues and uncovered scenarios throughout the review.
  Give each candidate a disposition: reported, rejected with evidence, or unresolved with the next check needed.
- Before finishing, compare probe outputs with the final findings.
  A reproduced anomaly must not disappear just because several other issues were already found.
- Carry unresolved candidates and coverage gaps into handoffs and context summaries, alongside published findings.
  For each finding, identify the trigger, consequence, source location, and supporting evidence.
- Use history to distinguish newly introduced regressions from older defects when relevant; verify the behavior at the earlier revision.


## Report and follow up

- Separate source inspection, focused probes, full suites, hosted CI, browser checks, and Factorio runtime evidence.
  Record failures, skips, and unavailable validation; investigate external-service failures before attributing them to the PR.
- Reproduce the original failure when checking a fix, including adjacent cases exposed by the change.
  A fix for one malformed field calls for checking the remaining consumer requirements, not just that example.
  Resolve a review thread only when its exact concern is addressed.
- When authorized to publish, refresh the head and existing comments, avoid duplicates, and anchor feedback to the reviewed code.
  Read back each posted inline comment to verify its body and location.
