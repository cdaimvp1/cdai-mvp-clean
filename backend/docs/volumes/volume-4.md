# cd/ai Volume 4 - MCP, Meta-Orchestrator, and Governed Runtime

## Scope
Volume 4 defines the Master Control Process (MCP), meta-agent orchestration layer, governed runtime, and long-horizon continuation. It specifies control-theoretic foundations, meta-agent graphs, multi-agent safety, federated orchestration, badge gating, and telemetry-driven governance. It integrates Appendix A material and the federated fabric (FKN/FKF), continuation layer (GCL), and enterprise graph hooks.

**Constants:** MCP and orchestration logic use the strictness, timing, and retry parameters defined in `registry/constants.md`. Do not hard-code alternative values in this volume; use registry lookups and ledgered overrides.

## 1. Governed State and Control Law
- State vector:
```math
S_t = (C_t, H_t, mode_t, penalties_t, telemetry_t, identity_t, fkf_ctx_t, seeds_t, continuation_t)
```
- Partition: `S_t = (S_t^{det}, S_t^{stoch})` where `S_t^{stoch}` includes seeds/creative outputs; control law acts on full state but stochastic parts are replayable via stored seeds.
- Jurisdictional slice: `S_t = \biguplus_j S_{t,j}` where each slice includes `C_{t,j}, H_{t,j}, badges_j, fkf_scope_j`; guards apply per slice before federated aggregation.
- Control law (state-space):
```math
BSE = \{ S \mid ||S_{t+1}-S_t|| \le \epsilon \} \\
S_{t+1} = F(S_t, u_t; \theta, \sigma) = A(\sigma) S_t + B(\sigma) u_t + g(\sigma, \theta) \\
S_t \in BSE \Rightarrow \text{stable}; \quad S_t \notin BSE \Rightarrow \text{enter SAFE\_ANALYTIC or recovery}
```
- Nominal parameter bounds:
  - `\epsilon = \epsilon_{base} (1 - \sigma(level))`, with `\epsilon_{base}` set per deployment.
  - `\|A(\sigma)\|_2 \le \alpha(\sigma)`, `\|B(\sigma)\|_2 \le \beta(\sigma)`, where `\alpha,\beta` are decreasing in `\sigma` and capped by `\alpha_{max}, \beta_{max}` chosen at build time.
  - `\sigma_{min} \in [0,0.2]`, `\sigma_{max} \in [0.8,1]`; `s(level)` monotone in `level`.
- Example gains and Lyapunov construction (numeric):
  - Let `K = k I` with `k=0.5`, `B_0 = I`, `\sigma_{min}=0.1`, `\sigma_{max}=0.9`; then `A(\sigma)=I-\sigma k I`, `B(\sigma)=\sigma I`, `\alpha(\sigma)=|1-\sigma k|`, `\beta(\sigma)=\sigma`.
  - Choose `P=I`, `Q=\sigma I`; contractive if `(1-\sigma k)^2 - 1 \le -\sigma` (satisfied for `\sigma >= 0.6` with k=0.5). Concrete instantiation: at `\sigma=0.7`, `A=0.65 I`, `B=0.7 I`, `\alpha=0.65`, `\beta=0.7`, `P=I`, `Q=0.7 I`.
  - Lipschitz in inputs: `\|F(S,u_1)-F(S,u_2)\| \le \gamma \beta(\sigma) \|u_1-u_2\|` with `\beta(\sigma)=\sigma`.
- Perturbation response:
```math
S_{t+1} = S_t + \gamma (F(S_t, u_t; \theta, \sigma) - S_t) + \nu_t, \quad \gamma \in (0,1], \ \nu_t \text{ bounded disturbance}
```
- Drift detection: if `||S_{t+1}-S_t|| > \epsilon` for `k` steps, raise strictness and freeze C1.
- Strictness modulation:
```math
\sigma(level) \in [0,1], \ \sigma \uparrow \Rightarrow \|A(\sigma)\| \downarrow, \ \|B(\sigma)\| \downarrow \\
\sigma(level) = \sigma_{min} + (\sigma_{max}-\sigma_{min}) s(level), \ s \in [0,1], \ \text{monotone} \\
g(level, risk, divergence) = g_0 + g_{risk} \cdot risk + g_{div} \cdot divergence + g_{lvl} \cdot s(level) \\
g_0, g_{risk}, g_{div}, g_{lvl} \ge 0 \text{ chosen so } \|g\| \text{ keeps } S_t \in BSE; \text{ example } g_{risk}=0.1, g_{div}=0.2, g_{lvl}=0.05
```
- Stability (contractive bound): choose Lyapunov function `V_L = S_t^\top P S_t` with `P \succ 0`; stable if `A(\sigma)^\top P A(\sigma) - P \preceq -Q` for `Q \succ 0`. If bound violated, raise `\sigma`, reduce `\gamma`, or enter SAFE_ANALYTIC (consistent with BSE definition in Volume 1).
- Lipschitz steps (inputs and state):
  - If `\|A(\sigma)\|_2 \le \alpha(\sigma)` and `\|B(\sigma)\|_2 \le \beta(\sigma)`, then
    ```math
    \|F(S_1,u_1)-F(S_2,u_2)\| \le \alpha(\sigma)\|S_1-S_2\| + \beta(\sigma)\|u_1-u_2\|
    ```
  - Contractive in state if `\alpha(\sigma) < 1`; choose `\sigma` high enough such that `\alpha(\sigma) < 1` and Lyapunov condition holds.
  - Inputs Lipschitz constant `L_u = \gamma \beta(\sigma)`; bound disturbances `\nu_t` to keep `S_t` inside BSE.
- Multi-cycle governance: G1 adjusts strictness and penalties over cycles using telemetry aggregates.
- Parameter selection procedure (implementation guide):
  1) Fit `A,B` from telemetry via regularized least squares on `(S_t, u_t, S_{t+1})`, constrained so `\alpha(\sigma) < 1` for target `\sigma`; enforce symmetry or sparsity if required by deployment.
  2) Solve LMI: pick `Q = q I` (e.g., `q=0.1`), solve `A^\top P A - P \preceq -Q` for `P \succ 0` using an LMI solver (e.g., CVXOPT/SeDuMi-class); if infeasible, increase `q` or raise `\sigma` until feasible; supports non-diagonal `A,B`.
  3) Safety margin: compute `\alpha(\sigma)` and set `\epsilon` so `\epsilon >= \|B(\sigma)\| \|u\|_{max} + \|\nu\|_{max}`; apply margin factor `m_{safety} \in (0,1)` (e.g., 0.8) for headroom.
  4) Validate on held-out telemetry: check empirical `||S_{t+1}-S_t||` stays below `\epsilon`; if not, raise `\sigma`, reduce `\gamma`, or refit with higher regularization.
  5) Ill-conditioned fallback: if fit yields \`cond(A)\` above policy threshold, project to nearest stable matrix via spectral radius clipping (`\rho(A)<1`) and re-solve LMI.
  6) Record chosen `A,B,P,Q,\epsilon,\sigma,m_{safety},q` in ledger for audit and reproducibility.
  7) Estimating `\|u\|_{max}, \|\nu\|_{max}`: take high-percentile (e.g., p99) norms from telemetry windows; inflate by factor (e.g., 1.2x) for unseen drift; ledger the chosen bounds.
  8) `\gamma` selection: start with `\gamma=1`; if empirical `||S_{t+1}-S_t||` nears `\epsilon`, reduce `\gamma` in steps of 0.1 until stable; ledger the setting.

Stability Theorem (Sketch)
Under the following conditions:

- There exists `P \succ 0` and `Q \succ 0` such that:

```math
A(\sigma)^\top P A(\sigma) - P \preceq -Q
```

- The Lipschitz bound w.r.t. inputs holds with constant `L_u(\sigma)`:

```math
\|F(S_1, u_1; \sigma) - F(S_2, u_2; \sigma)\|
\le \alpha(\sigma) \|S_1 - S_2\| + L_u(\sigma) \|u_1 - u_2\|
```

- Disturbances and inputs are bounded by design via constants in `registry/constants.md`:

```math
\|u_t\| \le \|u\|_{max}, \quad \|\nu_t\| \le \|\nu\|_{max}
```

- The safety margin `m_{safety}` is chosen so that the effective envelope:

```math
\epsilon = m_{safety} \cdot \epsilon_{design}
```

exceeds the worst-case drift implied by the above bounds.

Then:

- The Lyapunov function `V_L(S_t) = S_t^\top P S_t` decreases outside a compact set,
- `S_t` remains inside the bounded state envelope (BSE) defined by `\epsilon`,
- The governed runtime is globally asymptotically stable in the sense of remaining within BSE for all cycles that satisfy admissibility and badge constraints.

Operational Rule:
If empirical telemetry shows `\|S_{t+1}-S_t\|` approaching `\epsilon`, MCP must:
- increase `\sigma` (strictness),
- decrease `\gamma` (dampening factor),
- or transition to SAFE_ANALYTIC, as described in this volume.

This theorem links the abstract stability definition in Volume 1 to concrete parameter selection in the MCP.

## 2. MCP Responsibilities
- Schedule and coordinate stages A1->M1->C1->M2->V->Ledger->G1->Route.
- Enforce guards: admissibility, divergence, stability, ledger integrity, badge requirements, connector/federated policies, continuation validity.
- Adjust strictness and penalties using telemetry and constraint deltas.
- Manage modes: NORMAL, SAFE_ANALYTIC, QUARANTINE, CONTINUATION.
- Persist lineage to the ledger/FLC and emit telemetry.
- Host the meta-agent orchestrator coordinating agents, tools, connectors, and federated knowledge nodes.

## 3. Meta-Agent Supervisor Model
- Agents have capability signatures: `(inputs, outputs, tools, constraints, badges, fkf_scope, deterministic?)`.
- Directed agent graph `A = (V_A, E_A, \lambda_A)` aligned with plan DAG and constraint map.
- Multi-agent safety envelope: badge and constraint gates on edges; pre/postconditions per agent.
- Delegation rules: an agent may delegate only if delegate satisfies capability signature and badge set; delegation is logged and validated by CGL nodes.
- Agent lifecycle: `register -> admit -> execute -> introspect -> deactivate`; deactivation on violation, drift, or explicit governance command.

## 4. Orchestration Mechanics and Policy-Aware Routing
- Guard checks:
  - `guard_V`: `V=1`.
  - `guard_div`: divergence within bound.
  - `guard_stability`: `||S_{t+1}-S_t|| <= \epsilon`.
  - `guard_ledger`: hash chain matches.
  - `guard_badge(action)`: required badge set present and valid window; CRL age `<= T_crl` (Volume 1); minimal safe badge set and delegatable classes per Volume 6 enforced; non-delegatable badges must be direct.
  - `guard_connector(policy)`: connector invocation satisfies policy and badge constraints.
  - `guard_federated`: FCE constraints satisfied for fkf_scope.
- Routing selects agents/workflows satisfying policy, badge, capability, and jurisdiction constraints; otherwise tasks blocked or rerouted.
- Strictness variations: orchestrator may raise `\sigma(level)` for risky tasks; recorded in telemetry.
- Storyline/narrative integration: orchestration graph may carry narrative roles; ensures coherence with Volume 5 semantic constraints.

## 5. Multi-Workflow and Federated Scheduling
- Supports multiple concurrent governed workflows with isolation of seeds, badges, fkf_ctx, and connectors.
- Priority queues with governance-aware weights (safety > continuation deadlines > nominal tasks).
- Federated orchestration: tasks dispatched to FKNs when FCE permits; cross-node hops logged with connector id and badge context.
- Resource management: quotas per tenant and fkf_node; violation triggers throttling and mode escalation.
- Consensus for governance actions:
  - Message model: partially synchronous; messages carry `(id, hash, badge_proof, ttl, fkf_scope)`.
  - Quorum: safety/invariant -> majority+1 of eligible nodes; policy/badge -> majority + authority badge; semantic -> governed-eventual with timeout and revalidation.
  - Failure: timeout triggers retry with higher strictness; after `retry_budget` escalate to governance vote logged in FLC.
  - Governance vote: requires authority badge holder plus quorum signatures; result recorded as policy node update with hash and ttl.
- Reconfiguration invariant: membership changes must be ledgered with quorum proof; in-flight consensus using old view must either complete within `T_consensus` or be retried under the new view.
- Latency/backoff: target round `T_consensus=2s`, exponential backoff capped at `3*T_consensus`, `retry_budget=2`; if exceeded, enter governance vote and raise strictness for affected actions.
 - Message encoding: canonical serialization of `(proposal_hash || fkf_scope || jurisdiction || ts || ttl || signer_id || badge_proof)`; signatures aggregated into multi-sig proof reused by ledger/merge.

## 6. Modes and Continuation
- NORMAL: full cycle and orchestration enabled.
- SAFE_ANALYTIC: run {A1, M1, V}; C1 disabled; strictness tightened; connectors/FKN writes blocked.
- QUARANTINE: no external routing; artifacts stored with quarantine flag; requires badge-authorized human override.
- CONTINUATION: long-horizon tasks resume from checkpoints; re-validate constraints and badges; temporal invariants enforced.
- Mode transitions ledgered with reason codes, hashes, fkf_scope, and badge context.

Continuation Restore Procedure (Canonical)
- Given a continuation checkpoint with:
  - state hash `h_S`,
  - constraint set hash `h_C`,
  - badge context `B`,
  - seeds and deltas as in `fixtures/continuation/canonical_continuation.json`,
the restore procedure is:
  - Load Checkpoint Metadata: load `(h_S, h_C, B, fkf_scope, jurisdiction, ts)` and verify the ledger entry and signatures.
  - Rebuild Constraints: fetch constraints by `h_C` and validate against CGL closure and Volume 2 admissibility rules.
  - Rebuild State: fetch state by `h_S` and validate checksum; ensure Version/Mode are compatible with the current deployment.
  - Revalidate Badges: check badge set `B` against current CRL and registry; reject if any badge revoked or expired.
  - Rebind Seeds and Deltas: load seeds and deltas from the continuation fixture; re-run deterministic recomputation and verify that the recomputed state matches `h_S`.
  - Resume Cycle: resume from A1 or M1 depending on checkpoint mode, with strictness possibly elevated; log `CONTINUATION_RESTORE` in the ledger with reason and outcomes.
- Any failure at steps 2–5 must result in QUARANTINE or SAFE_ANALYTIC.

## 7. Recovery, Dampening, and Jump Logic
- Dampened update:
```math
S_{t+1} = S_t + \gamma (F(S_t) - S_t), \quad \gamma \in (0,1]
```
- Jump recovery: on critical safety/federated violation, jump to G1, inject emergency constraints, then resume cycle.
- Retry budgets per stage and per orchestration task; exceeding budgets triggers mode escalation or quarantine.
- MCP error matrix: maps error classes (constraint, divergence, ledger, telemetry, badge, connector, federated, continuation) to recovery paths.
- Error matrix (summary):
  - Constraint violation: detect via V; severity=med; response=reraise penalties, reroute to owner; budget=3; escalate SAFE_ANALYTIC.
  - Divergence overflow: detect via guard_div; severity=med; response=lower divergence bound, reseed; budget=2; escalate SAFE_ANALYTIC.
  - Ledger mismatch: detect via hash check; severity=high; response=halt commit, recompute, require badge override; budget=1; escalate QUARANTINE.
  - Telemetry gap: detect via contract; severity=med; response=request re-emission; budget=2; escalate SAFE_ANALYTIC.
  - Badge failure: detect via guard_badge; severity=high; response=block; budget=0; require badge holder.
  - Connector/federated denial: detect via guard_connector/FCE; severity=high; response=block, reroute; budget=1; escalate policy review.
  - Consensus failure: detect via quorum timeout; severity=high; response=retry with stricter quorum/timeouts; budget=2; escalate governance vote.
  - Continuation violation: detect via TTL/validation; severity=high; response=invalidate checkpoint, re-validate; budget=1; escalate human override.
- Recovery timing: each budgeted attempt bounded by `T_recovery` (class-specific); exceeding time bound triggers same escalation as exceeding attempt count.
- Budget instantiation: `budget_i = base_i - k_{freq} * frequency_i - k_{drift} * drift_i`; choose `base_i` by severity (e.g., 3 for med, 1 for high); budgets not <0; once exhausted, escalate/halt. Example parameters: `k_{freq}=0.5`, `k_{drift}=1.0`, `base_{ledger}=1`, `base_{consensus}=2`, `base_{divergence}=3`; MCP logs chosen parameters to ledger for audit.

## 8. Penalty and Strictness Management
- Penalty update:
```math
w_{t+1} = w_t + \eta \cdot \sigma(level) \cdot \nabla \Phi
```
- Strictness modulation driven by telemetry density and risk posture; may differ per fkf_node.
- Monotone constraint accumulation within a cycle; removals require governance and ledger entry.

## 9. Scheduler and Orchestrator Interfaces
- Inputs: plan DAG, orchestration graph, constraint graph snapshot, seeds, routing policy, fixture set, badge requirements, connector/federated policies, continuation parameters.
- Outputs: stage invocations, telemetry events, ledger/FLC entries, mode transitions, orchestrator control events.
- Concurrency: allowed for telemetry and ledger I/O; stage execution ordered unless constraints permit parallelism.
- Human overseers (with badges) can pause, resume, reconfigure orchestration policies, or deactivate agents; all actions logged.

## 10. Failure Modes and Routing
- Constraint violation: route to stage owner with raised penalties.
- Divergence overflow: rerun C1 with lower divergence bound or switch to SAFE_ANALYTIC.
- Ledger mismatch: halt commit, recompute hashes, require operator sign-off.
- Telemetry gap: block commit until required fields present.
- Stability drift: dampen updates, freeze creative, inject emergency constraints.
- Badge failure: block action, log `BADGE_FAIL`, require authorized badge holder.
- Connector/federated denial: block external call, log `CONNECTOR_DENY` or `FCE_FAIL`, require policy review.
- Continuation violation: invalidate checkpoint, require re-validation, and possibly quarantine.

## 11. Governance Loop (G1)
- Inputs: ledger head `H_t`, telemetry summaries, constraint deltas, orchestrator metrics, fkf summaries.
- Outputs: updated constraints, strictness level, penalty schedule, mode, orchestration policies.
- Control policy (PID-like):
```math
\Delta penalties = k_p \mu + k_d (\mu - \mu_{t-1}) + k_i \sum_{k=0}^t \mu_k
```
- G1 writes updates to ledger/FLC and broadcasts to Builder for future plan generation and template updates.

## 12. Routing and Enforcement
- MCP applies routing `R(y', \rho)` with projection `Proj_{C_out}`; validator `V_out` post-projection; failures quarantine artifact.
- Decisions signed and ledgered with badge context; downstream must verify signatures and badge tags.
- Policy-aware routing prevents dispatch to agents/workflows lacking required badges or jurisdiction tags; federated routing requires FCE satisfaction.

## 13. Enterprise Graph and FKN Integration
- Orchestrator invokes enterprise graph connectors only when constraints and badge requirements are satisfied.
- External resources are treated as FKNs with constraint wrappers; access mediated by CGL, MCP policy, and badges.
- Identity resolution via graph connectors binds external principals to internal badge sets; logged with connector id and policy.
- All connector interactions emit telemetry and ledger/FLC entries (connector id, resource class, badge set, constraint context, fkf_node).

## 14. Deterministic Boundary Controls
- Seeds for C1 and randomized MCP tuning stored with run id.
- Deterministic configs (models, prompts, penalties, orchestration policies) hashed; mismatch halts execution.
- Replay enabled via seeds, configs, and ledger/FLC heads; seeds/configs serialized deterministically (canonical JSON, sorted keys) to avoid hash mismatch on restore.

### Cross-Language Continuation Replay Tests
- Maintain canonical continuation sample at `fixtures/reference/continuation.canonical.json`.
- Tests:
  1. Byte-for-byte equality across languages.
  2. SHA-256 (big-endian) hash equality.
  3. Deterministic ordering of arrays/maps via lexical sort.
  4. Replay of seeds + deltas yields identical constraint evaluation.
- Mismatch => SAFE_ANALYTIC and badge-approved override.

### Canonical Continuation Fixture

The canonical continuation file is:  
`fixtures/continuation/canonical_continuation.json`

This fixture enforces:
- canonical seed  
- ordered deltas  
- deterministic output hash  
- cross-language equivalence  

Any language implementation that cannot reproduce the continuation must fail the harness.

## 15. Observability and Telemetry Enforcement
- MCP refuses commit if telemetry contract incomplete.
- Critical fields: `ts, stage, mu, phi, divergence, decision, hash, mode, strictness, constraint_ids, badges, connector_calls, fkf_node`.
- Telemetry is streamed to bus (Volume 6); summaries feed G1 and Builder v2.
- Precedent telemetry: derived decisions include source hashes to support audit and counterfactuals.

## 16. Agent Introspection and Self-Evaluation
- Agents emit self-eval metrics (confidence, resource use, divergence contribution); recorded in telemetry.
- Orchestrator can demote or deactivate agents based on self-eval plus violation history.
- Agent trust graph maintained; edges weighted by observed reliability and adherence to constraints; used for delegation decisions.

## 17. Multi-Agent Safety and Negotiation
- Precondition/postcondition constraints enforced on agent edges.
- Negotiation under constraints uses CGL to validate proposals; consensus requires badge-qualified quorum when changing shared state.
- Isolation: failing agent is sandboxed; outputs quarantined until validator clearance.

## 18. Federated Orchestration and Conflict Handling
- Cross-node orchestration honors FCE; tasks carry fkf_scope; validation performed at both source and destination.
- Conflicts detected by federated CGL/ledger; resolution may reroute to safer node or require governance vote; recorded in FLC.
- Failover: if node unavailable, orchestrator selects alternate node with compatible constraints and badges; checkpoints synced via FLC snapshot.
- Ordering: cross-node cycle steps must preserve stage order (A1->...->Route); causal order enforced via ledger/FLC hashes (Lamport-style monotonicity on stage commits).

## 19. Long-Horizon Governance and Continuation
- Governed Continuation Layer (GCL) maintained by MCP: checkpoint `(S_t, G_version, strictness, mode, seeds, fkf_scope, ttl)`.
- Temporal invariants enforced via temporal constraints; expiration triggers re-validation or shutdown.
- Continuation triggers (time-based, violation-based) can adjust orchestration policy and strictness.
- Restore algorithm:
  1. Load checkpoint `(S_t, G_version, strictness, mode, seeds, fkf_scope, ttl, ts_checkpoint)`.
  2. Verify ttl not expired; else require governance override.
 3. Verify ledger/FLC head matches checkpoint prev_hash; else quarantine.
 4. Re-run badge validations and FCE checks.
 5. Re-evaluate constraints with current `C_t`; enforce `strictness_{resume} >= strictness_{checkpoint}`; if `V=1` and `guard_stability` holds, resume at A1 or M1 with stored seeds.

## 20. Cross-Volume Integration
- Volume 3: consumes plan/orchestration graph with guards and badge/federated requirements.
- Volume 2: supplies constraint graph, FCE, conflict graphs, and gradients.
- Volume 5: cognitive/narrative assets run inside A1/C1; meta-cognition and narrative roles influence orchestration.
- Volume 6: ledger/telemetry capture orchestration decisions, badge checks, connector usage, federated hops, continuation events, and control adjustments.
- Defaults: use Volume 1 constants for `\sigma_{min/max}`, `\epsilon_{base}`, `T_consensus`, `T_merge`, `T_batch`, `T_crl`, `\tau_{ok}`, `\tau_{warn}`, `\tau_{div}` to avoid drift.
- Badge references: minimal safe badge set and delegatable classes are in Volume 6; apply badge/CRL invariants here and in Builder (Volume 3) and badges in Volume 1.1 for governance actions.

