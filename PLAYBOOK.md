# Road graph integration playbook

## Freeze the upstream fixture

The road graph owner publishes the contract in `packages/contracts/roadGraph.ts` and the corresponding, frozen fixture in `packages/contracts/fixtures/test-district.json`. The fixture contains a static 2×2 district with stable IDs and coordinates. Downstream consumers pin the contract and fixture at the same commit so their tests can run before procedural district integration. Run `npm test -- tests/contracts.test.ts` to check the fixture independently.

## Expand and contract schema changes

1. On a schema bump, expand the contract first. Add the new version and its own fixture while preserving the old version and its fixture. Verify both versions during the migration.
2. Migrate downstream producers and consumers to the new version. Keep each consumer's contract checks tied to its declared fixture version.
3. Once the consumers have migrated, remove the legacy version in a separate, reviewed contract change.

## Triage contract drift with the upstream owner

Apply the `contract-drift: upstream-owner` rule by comparing the failing producer and consumer with the pinned contract and fixture. If an upstream change to IDs, coordinates, references, or schema semantics breaks the contract, mark the issue `contract-drift` and assign it to the upstream road graph owner. Include the fixture version, producer and consumer commits, failing field or lookup, and expected and actual values. The upstream owner decides whether to restore compatibility or start a schema bump. A consumer defect reproduced with a conforming fixture belongs to its consumer owner.

## Quarantine a failing replay

Allow a maximum of **two attempts total** to reproduce and investigate a failing case, within **15 minutes** of the first failure. Quarantine the failing scenario if it remains unresolved when either limit is reached. Keep the rest of the verification suite running and record the quarantined case and owner in the tracking issue.

Attach a JSON replay with `commit`, `fixtureVersion`, `seed`, `command`, `initialState`, `firstFailingTick`, and `ticks`. Capture the state directly before the replay in `initialState`. Supply **20 consecutive fixed simulation ticks** that include the failure, each with `tick`, `inputs`, and `actual`. Include `expected` on the entry with the failing assertion. Use this replay to reproduce the case before resolving the issue and restoring it to the normal verification suite.
