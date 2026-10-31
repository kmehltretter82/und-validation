# Contributor launch

TND should open in stages. The project is not ready to invite contributors until the proof checks and task lifecycle below have been exercised end to end. The site and GitHub repositories currently contain local work in progress.

## Maintainer-led pilot

Before inviting a small group:

- Publish the reviewed library and platform sources and document the pinned Lean version, the no-Mathlib policy, and how to build `tndlib` from a clean checkout.
- Demonstrate a task from an approved statement through claim, submission, trusted verification, maintainer review, merge, and promotion into `tndlib`. A published result must link to evidence for the exact library commit.
- Run acceptance and rejection fixtures for indirect choice, `sorry`, additional axioms, changed statements or definitions, and missing or stale checks. Test against the actual repository and merge identity.
- Write a short contributor guide for both humans and contributors using their own agents, with a working Choir join path, build commands, claim/heartbeat/release instructions, and how to request help.
- Create the `tnd/proposal` label before enabling the request form and verify that the form applies it. The public index intentionally ignores ordinary unlabeled issues and lists only explicit proposals or approved `choir/task` issues.
- Prepare a small set of genuinely ready tasks at varied difficulty, including clear statements, prerequisites, acceptance criteria, and pointers to relevant definitions. Do not advertise tasks with unproved prerequisites as ready.
- Identify the people responsible for reviewing proofs, answering questions, and responding to failed or held CI jobs.

Invite a few people first. Observe whether they can complete the workflow without private assistance, review their feedback and merged contributions, and fix any confusing or unsafe steps before a wider announcement.

## Growing the community

1. Make the repositories discoverable: an accurate README, the published site, useful topics, and a small number of well-specified `good first issue` and `help wanted` tasks. [GitHub's topic guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics) explains how topics aid discovery.
2. Show one concrete contribution from start to finish. Explain what constructivity means here, which axioms the audit permits, where the proof and evidence live, and how a contributor can reproduce the check.
3. Participate in the [Lean community](https://lean-lang.org/community/) and relevant constructive-mathematics groups. Ask for mathematical and usability feedback before advertising for scale. Follow each community's rules; the Lean community's [AI guidance](https://leanprover-community.github.io/contribute/index.html) asks contributors to write Zulip comments in their own words.
4. Share the working integration with people using [Choir](https://github.com/Weber-GeoML/Choir), and invite feedback on the contributor experience and trust boundary.
5. Keep a public roadmap and report what is actually verified. Separate a planned feature, a proof accepted for a task, and a result certified in a particular `tndlib` revision.

External announcements, posts, and repository publication must follow the workspace's review rules. This document does not send or schedule any messages.
