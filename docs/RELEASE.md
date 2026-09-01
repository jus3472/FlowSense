# Production release runbook

FlowSense uses staged Vercel Production deployments. A push to `main` may build a Production
candidate, but it must not move a Production domain until that exact artifact passes smoke testing.

## Required Vercel configuration

In the FlowSense project, open **Settings → Environments → Production → Branch Tracking**. Keep
`main` as the Production branch and disable **Auto-assign Custom Production Domains**. This keeps
Git builds enabled and gives `main` deployments Production environment variables without making a
new build current automatically.

If automatic domain assignment is enabled, stop before pushing `main`. A Production-branch push can
otherwise replace the current application before the candidate is tested.

## Release sequence

1. Start from a clean `main` that matches `origin/main`. Run the repository's required local checks.
2. Review every pending migration before release. For schema changes, record a usable backup or
   recovery point, run `npm run db:preflight`, and apply migrations only with explicit approval.
3. Identify the current Production deployment and a known-good rollback deployment that is
   compatible with the post-migration schema.
4. Push the exact reviewed source commit to `main`.
5. Confirm Vercel created a staged deployment with target `production`, the expected commit SHA,
   Production environment variables, a generated immutable URL, and no Production domain assigned.
   When creating the candidate with the CLI, use `vercel --prod --skip-domain`.
6. Smoke-test the immutable URL. Cover authentication, Home, Practice, recording boundaries, results,
   History, Progress, Settings, browser errors, and Vercel runtime errors. Perform a real recording
   when the release changes recording, scoring, progression, or activity behavior.
7. Promote that exact tested deployment with `vercel promote <deployment-id-or-url>`. Do not rebuild
   a different artifact for promotion.
8. Repeat the Production smoke against the public alias and check the post-promotion runtime window.
9. Retain the previous known-good, schema-compatible deployment until a later stability review.
10. Remove old deployments, branches, and worktrees only after confirming they contain no unique
    commits or uncommitted work.

Useful read-only checks include `vercel inspect`, `vercel logs --level error`,
`npm run db:preflight`, and `npm run inspect:content-reliability`.

## Rollback rule

Rollback changes the application deployment only. Do not reverse Production migrations during an
application rollback unless a separate database recovery plan explicitly requires it.

Never use an arbitrary previous Production deployment as rollback after a schema change. The
rollback artifact must be known to work with the database schema currently in Production.
