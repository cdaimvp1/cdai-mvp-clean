# cd/ai Volume 5 - Cognitive Layer, Narrative Model, GIL, and Governed Learning

## Scope
Volume 5 extends the dual-hemisphere model with cognitive controls, meta-cognitive loops, narrative synthesis, GIL (governed intermediate language), cross-node coherence, and governed training/learning loops. It aligns outputs with the CGL (Volume 2), MCP/meta-orchestrator (Volume 4), Builder v2 artifacts (Volume 3), and federated observability (Volume 6).

**Constants:** Cognitive, drift, and validator-cap thresholds (`\tau_{ok}`, `\tau_{warn}`, `\tau_{div}`, `T_sem`, caps on `|V|` and `|E|`, and `Conf_min`) are defined in `registry/constants.md` and Volume 1. This volume must not redefine those defaults.

## 1. Cognitive Layer Overview
- Analytical hemisphere: deterministic transform `A(x)` grounding goals and constraints.
- Creative hemisphere: stochastic transform `C(x, \xi)` bounded by divergence and constraint penalties.
- Moderator: reconciliation `M(a,c)` minimizing divergence and violations.
- Validator: admissibility `V(u)` against CGL and applicable FCE.
- Narrative layer: renders governed drafts into user-facing artifacts with constraint-aware formatting and badge-conditioned sections.
- Meta-cognitive loop: monitors divergence, semantic drift, and constraint pressure; can trigger strictness increases or fallback to SAFE_ANALYTIC.

## 2. Narrative Model, GIL, and Cross-Node Coherence
- GIL is the governed intermediate language used before rendering.
- Pipeline:
  1) A1 produces structured analytic content.
  2) C1 explores variants under constraint penalties.
  3) M2 reconciles into `m2`.
  4) `m2` -> GIL with explicit tags for semantics, safety, routing, badges, connectors, fkf_scope.
  5) CGL validates GIL (format, badge, jurisdiction, federated tags).
  6) Renderer produces final `y'` and routes via MCP.
- Cross-node coherence: semantic constraints include fkf_scope; Validator checks consistency across referenced nodes.
- Narrative safety envelope: safety nodes guard sensitive content and badge-gated sections; failures quarantine.

## 3. Cognitive Control Mathematics
```math
a = A(x, g, C_t) \\
c = C(m1, \xi, C_t) \\
m2 = M(m1, c, C_t) = \arg\min_m [ d(m,c) + d(m,m1) + \lambda \Phi(m) ] \\
V(m2, C_t) = 1 \iff \forall c_i \in C_t: c_i(m2)=1
```
- Divergence bound: `E[d(c,m1)] \le \delta_{creative}` with strictness scaling.
- Drift detection: semantic drift `D(y, y_ref)` measured via coherence constraints; drift beyond bound triggers strictness raise or SAFE_ANALYTIC (thresholds `\tau_{ok}, \tau_{warn}` shared with Volume 1 constants).
- Recovery triggers: if `V=0` or `d>\delta`, rerun C1 with higher penalties or revert to SAFE_ANALYTIC.

Drift Thresholds and Registry Linkage
The thresholds `\tau_{ok}`, `\tau_{warn}`, and `\tau_{div}` are defined in the Global Constants Registry and must not be hard-coded here.

We define the following decision rule:

```math
D(y, y_{ref}) \le \tau_{ok} \Rightarrow \text{NORMAL} \\
\tau_{ok} < D(y, y_{ref}) \le \tau_{warn} \Rightarrow \text{WARN} \\
D(y, y_{ref}) > \tau_{warn} \Rightarrow \text{SAFE\_ANALYTIC or QUARANTINE}
```

Additionally:

- If `D > \tau_{div}`, training or model updates MUST be rejected even if other SLAs are satisfied.
- All stages producing governed outputs must report `D` into telemetry, and MCP uses the above rule to adjust `\sigma` and routing decisions.

This ties the semantic drift behavior to concrete, registry-backed thresholds.

### Semantic Drift Example (Canonical Fixture)

The file `fixtures/cognitive/semantic_drift_example.json` provides:
- Reference output  
- Model output  
- Computed drift `D`  
- Threshold comparison against `tau_ok` and `tau_warn`  

This fixture MUST be used to test drift behavior in:
- multi-language implementations  
- harness verification  
- strictness-adjustment logic  

## 4. Meta-Cognitive and Multi-Cycle Framing
- Meta-cognition monitors long-horizon tasks; uses continuation checkpoints and semantic role labels.
- Hemisphere dominance resolution: if creative divergence high, increase \lambda and strictness; if analytic rigidity high, permit bounded creative slack within envelope.
- Multi-cycle framing: context binding persists across cycles via continuation state; constraints ensure freshness/latency bounds.

## 5. Semantic Role Labeling and Validator Graph
- Semantic roles (goal, constraint, claim, evidence, action) tagged in GIL.
- Validator admissibility graph:
  - Nodes: candidate outputs/states `(y, context)` including fkf_scope and jurisdiction.
  - Edges: admissible transitions labeled with active constraint sets, strictness level, and required badges.
  - Acceptance: path exists from start to terminal node with all safety/badge/FCE constraints satisfied.
  - Validator computes reachable admissible nodes via BFS/DFS over edges that satisfy current constraints; if terminal unreachable -> reject. Production cap example: enforce `|V| <= 10^4`, `|E| <= 10^5`; beyond cap, raise `\sigma`, prune to safety-first subgraph, and require governance review.
  - Cap governance: caps stored in policy; changes require governance badge quorum, ledger entry, and re-validation that pruning preserves safety nodes; spillover strategy = prioritize safety/badge/FCE nodes, then semantic by weight, discard least-weighted semantics first.
  - Alerting: hitting caps emits telemetry and ledger entry with reason code `VALIDATOR_CAP`; MCP raises `\sigma` and pauses new semantic edges until governance adjusts caps or graph is pruned.
  - Pruning thresholds: define `T_sem` (default 0.10 of median semantic weight); drop edges with `w_i < T_sem * median(w_semantic)` automatically when caps are hit; policy parameters are recorded in registry and ledgered on change.

Validator Graph Pruning Lemma
Let:

- `G = (V, E)` be the validator graph,
- `T_sem` be the semantic pruning threshold from the registry,
- `S_env` be the set of safety/badge/FCE nodes.

Construct a pruned graph `G' = (V', E')` as follows:

- `V'` retains all nodes in `S_env`,
- Remove semantic edges with weight `w_i < T_sem * median(w_{semantic})`,
- Remove any semantic nodes disconnected from all safety/badge/FCE nodes.

Then:

- All safety, badge, and FCE constraints are preserved in `G'`.
- The admissible set defined by safety and badge nodes is unchanged.
- Semantic capacity is reduced but remains sound: every path accepted in `G'` is admissible in `G`.

Operationally:

- If caps on `|V|` or `|E|` are hit, MCP applies this pruning procedure.
- A governance review is required before changing `T_sem` or cap values.

### Validator Graph Example (Pruning Demonstration)

See `fixtures/cognitive/validator_graph_example.json`.

This example illustrates:
- Node and edge representation  
- Weights  
- Computation of median semantic weight  
- Pruning of low-weight edges using `T_sem`  

This fixture is the canonical reference for graph-pruning conformance tests.

## 6. Deterministic vs Nondeterministic Boundaries
- Deterministic: analytical rendering to GIL, moderation, validation, continuation binding.
- Nondeterministic but bounded: creative sampling; seeds stored for replay; meta-cognitive tuning must converge.

## 7. Telemetry for Cognitive/Narrative Stages
- Metrics: divergence, violation density, coherence score, novelty descriptors, semantic drift, badge checks, connector/federated calls.
- Telemetry packets include fkf_node, badge set, seeds, strictness, and role coverage.
- Telemetry feeds MCP strictness adjustments, orchestrator scheduling, and learning loops.

## 8. Recovery and Error Bounding
- Error classes: `COHERENCE_FAIL`, `SAFETY_FAIL`, `FORMAT_FAIL`, `BADGE_FAIL`, `FEDERATED_FAIL`.
- Recovery map:
  - `COHERENCE_FAIL` -> re-run M2 with higher \lambda on semantic constraints.
  - `SAFETY_FAIL` -> block and enter SAFE_ANALYTIC; inject emergency safety constraints.
  - `FORMAT_FAIL` -> rerun A1 schema pass, then re-render GIL.
  - `BADGE_FAIL` -> halt, require authorized badge holder, log to ledger.
  - `FEDERATED_FAIL` -> apply FCE remediation or reroute to allowed nodes; log to FLC.
- Bounded retries `k_max`; beyond that, QUARANTINE.

## 9. Governed Training and Learning Loops
- Badge-gated training approval: `training.approve` + `validator.run` required to start training.
- Learning envelopes: define permissible updates (e.g., weights, prompts, templates) and forbid weakening safety constraints.
- Drift detection: compare post-training \Phi, divergence, and violation rates; reject if degradation or safety regression.
- Negative learning suppression: disallow updates that increase violation density or reduce safety coverage.
- Learning cycle math:
```math
\theta_{t+1} = \theta_t - \alpha \nabla L + \beta \nabla \Phi \\
\text{accept} \iff \Phi_{post} \le \Phi_{pre} \ \land \ \text{safety\_coverage}_{post} \ge \text{safety\_coverage}_{pre}
```
- Lineage: training data, configs, badges, and results hashed and stored in ledger/FLC.
- Modes: sandbox/offline (historical ledger data), shadow (side-by-side, no routing), staged rollout (after validator pass + badge approval).
- Multi-node consistency: federated training requires consensus or quorum on safety constraints; updates propagated via FIP with lineage.
- Training SLA examples: C1 latency < 500ms p95; divergence `<= \tau_{ok}` for acceptance; strictness `\sigma >= 0.6` in shadow before promotion.

### Training Dataset Specification
- Dataset registry entries `(dataset_id, jurisdiction, hash, badge_approvals, fkf_scope)` recorded in ledger.
- Metrics computed with nearest-rank percentiles (p50, p95) for latency/divergence aligned to SLAs above.
- Validation checklist: dataset hash match, badge approvals present, SLA thresholds met, cross-node reproducibility; promotion requires ledger record + validator success + governance badge approval.
- Per-stage SLA (example):
  - A1: latency p95 < 300ms; admissibility must not worsen (`\Phi` non-increasing).
  - M1/M2: latency p95 < 300ms; `\Phi(m_out) \le \Phi(m_in)`; no new safety violations.
  - C1: latency p95 < 500ms; divergence `<= \tau_{ok}` in shadow; strictness `\sigma >= 0.6`.
  - V: latency p95 < 200ms; completeness over active constraints; badge check pass rate 100%.
  - Ledger: write latency p95 < 200ms; hash verification success 100%.
  - Routing: decision latency p95 < 200ms; `V_out=1` required for delivery.
  - Constants: use Volume 1 defaults (`\sigma_{min/max}`, `\tau_{ok}`, `\tau_{warn}`, `T_batch`, `T_consensus`, `T_merge`) unless overridden by governance; promotion checks in Volume 6 enforce this table.
- Evaluation harness (implementation guide):
  - Fixtures: deterministic inputs per stage (A1 prompts, C1 seeds) with expected `\Phi`, divergence, and outputs hashed.
  - Metrics: compute `\Phi`, divergence, latency p95, badge check pass rate, connector/federated call success, and drift `D`.
  - Acceptance: harness runs shadow/staging with SLAs above; failures logged to ledger; promotion blocked until metrics meet thresholds.
  - Canonical fixture format: JSON (canonical serialization, UTF-8, sorted keys) with fields `{stage, input, expected_hash, expected_phi, expected_divergence, seeds, fkf_scope, jurisdiction}`; p95 computed over sliding window of last 100 runs per stage.
  - Reference fixture examples: include baseline A1 prompt + expected hash, C1 seed + expected divergence, M2 reconciliation input/output hashes; store under `fixtures/` with ledgered hash for regression. Confidence intervals optional; p95 window size fixed at 100 to standardize evaluation.
  - Low-sample handling: if <100 samples, compute p95 over available runs and mark confidence low; require badge approval before promotion; optionally compute p99 when sample size >=200 for stricter deployments.
  - Confidence metric: `Conf = sample_size / (sample_size + variance_factor)`; if `Conf < Conf_min` (default 0.75), require authority badge override or extend shadow window before promotion; log gating decisions to ledger.
  - Sample fixture (illustrative):
```json
{
  "stage": "C1",
  "input": "goal: summarize telemetry anomalies",
  "expected_hash": "f1c2...abcd",
  "expected_phi": 0.05,
  "expected_divergence": 0.1,
  "seeds": {"c1": "seed-123"},
  "fkf_scope": ["node-a"],
  "jurisdiction": "global"
}
```
- Reference fixtures/proofs: maintained under `fixtures/reference/` with ledgered hashes; cross-language validation required before enabling production connectors/federated flows.

## 10. Integration with Builder and MCP
- Builder packages prompts, seeds, GIL templates, training fixtures, and evaluation probes; orchestrator schedules training tasks under badge/federated constraints.
- Constraint IDs embedded in GIL enable fine-grained validation and routing.
- Orchestrator ensures training data access follows connector and badge policies; FKN access is constraint-gated.
- Ledger captures GIL hash, rendered output hash, feedback entries, training decisions, and rollback pointers.

## 11. Narrative Layer and Output Routing
- Projection `Proj_{C_out}` operates on GIL before rendering; redaction rules encoded in constraints.
- Validator `V_out` runs after projection; routing depends on validator result, jurisdiction tags, badge checks, and fkf_scope.
- Redaction and projection lineage stored for learning signals and audit.

## 12. Cognitive Extension Interfaces
- Semantic state machine hooks: cognitive stages emit state labels consumed by runtime state machine.
- Constraint feedback: narrative evaluation can add constraints back into `\Delta C` with lineage.
- Strictness curves: cognitive load and drift feed `\sigma(level)` adjustments.
- Learning hooks: training outputs can propose updates to builder templates and orchestration policies; activation is badge-gated and validated.

## 13. Guarantees
- Coherence, safety, federated, and badge/policy adherence enforced before external output.
- Replayability via stored seeds and hashes.
- Monotone constraint accumulation maintained even when narrative layer adds constraints.
- Ledger lineage binds analytic, creative, GIL, rendered artifacts, feedback, training updates, and federated coherence checks.

## 14. Semantic Drift Metric
- Define reference `y_ref` (prior cycle or checkpoint) and current `y`.
- Drift:
```math
D(y, y_{ref}) = \alpha \, d_{embed}(y, y_{ref}) + \beta \, |\Phi(y) - \Phi(y_{ref})|
```
where `d_{embed}` is embedding or edit distance; `\alpha,\beta \ge 0`.
- Thresholds (shared globally): OK `D \le \tau_{ok}`; WARN/Human review `\tau_{ok} < D \le \tau_{warn}`; REJECT `D > \tau_{warn}` or any new safety violation.
- Choose `d_{embed}` as cosine or normalized edit distance; selection is fixed per plan to ensure reproducibility.
- Integration: M2 minimizes `D` and `\Phi`; meta-cognition raises `\sigma` if in WARN; REJECT routes to SAFE_ANALYTIC or rerun C1 with tighter bounds. Learning loop rejects updates that increase median `D` beyond `\tau_{warn}`.
- Complexity note: reachability BFS/DFS is O(|V|+|E|); enforce caps on admissibility graph size per cycle; if exceeded, escalate to governance review and raise `\sigma` to reduce search space.



