# cd/ai Volume 1.1 - Specification Extension of Volume 1

## Scope
Volume 1.1 deepens Volume 1 with parameterized operators, explicit schemas, guards, badge/role substrate, strictness functions, enterprise graph hooks, federated identity propagation, and governed continuation. All definitions are canonical and must be referenced by later volumes.

## 1. Governed State, Modes, and Strictness
- Governed state: `S_t = (C_t, H_t, mode_t, penalties_t, telemetry_t, identity_t, fkf_ctx_t)`.
- Notation alignment: `S_t` is used across volumes (a.k.a. `x_t` in control equations); `BSE` is defined by `||S_{t+1}-S_t|| \le \epsilon`; strictness `\sigma(level)` follows Volume 1.
- Modes: `NORMAL`, `SAFE_ANALYTIC` (freeze creative), `QUARANTINE` (no output delivery), `CONTINUATION` (long-horizon checkpointed execution).
- Strictness scaling: `\sigma(level) \in [0,1]` controls divergence bounds and penalty weights.
```math
\sigma(\text{level}) = \sigma_{\min} + (\sigma_{\max}-\sigma_{\min}) \cdot s(\text{level}), \quad s(\cdot)\in[0,1]
```
- Divergence cap for C1: `\mathbb{E}[d(c,m1)] \le \delta_0 \cdot (1-\sigma(level))`.
- Penalty weights update: `w_{t+1} = w_t + \eta \cdot \sigma(level) \cdot \nabla \Phi`.
- Bounded State Envelope (BSE): `B = { S \mid ||S_{t+1}-S_t|| \le \epsilon }`; MCP maintains `S_t \in B`.

## 2. Operator Parameterization
```math
A(x,g,C_t) = \text{dec}(\text{enc}(x) \oplus g \oplus C_t; \theta_A) \\
C(m1,\xi,C_t) = \text{gen}(m1, \xi; \theta_C, C_t), \quad \xi \sim \mathcal{N}(0, I), \ \mathbb{E}[d(C,m1)] \le \delta_{creative} \\
M(a,c,C_t) = \arg\min_m \big[ d(m,a) + d(m,c) + \lambda \Phi(m) \big] \\
V(u, C_t) = 1 \iff \forall c_i \in C_t: c_i(u)=1 \\
S_{t+1} = F(S_t) = (C_t \cup \Delta C,\, H_{t+1},\, mode_{t+1},\, penalties_{t+1},\, telemetry_{t+1},\, identity_{t+1},\, fkf_{ctx,t+1})
```
Control state-space reference (see Volume 4):
```math
x_{t+1} = F(x_t, u_t; \theta, \sigma), \quad x_t \equiv S_t \\
\sigma(level) \in [0,1], \ \sigma \uparrow \Rightarrow \text{tighter gains, lower divergence bounds} \\
||x_t|| \le BSE \Rightarrow \text{stable}
```

## 3. State Machine (Expanded)
States: `{A1, M1, C1, M2, V, LEDGER, G1, ROUTE, SAFE_ANALYTIC, QUARANTINE, CONTINUATION}`.  
Guards:
- `guard_V = (V=1)`
- `guard_div = (\mathbb{E}[d(c,m1)] \le \delta_{creative})`
- `guard_stability = (||S_{t+1}-S_t|| \le \epsilon)`
- `guard_badge(action) = 1` iff active identity has required badge set for `action`.
- `guard_federated = 1` iff federated constraints applicable to fkf_ctx are satisfied.

Transitions:
- Forward path follows canonical cycle.
- On `guard_V` fail: route to `A1` if violation origin analytic, else `C1`.
- On `guard_stability` fail: enter `SAFE_ANALYTIC` loop {A1, M1, V}.
- On repeated failure `k > k_max`: enter `QUARANTINE` and require badge-authorized human override.
- On badge failure for governance action: halt and log; proceed only after authorized badge holder approves.
- Continuation checkpoints may resume at A1 or M1 with stored seeds and G versions; require badge and ledger verification.

Cycle-Level Lipschitz Bound (Informal)

At the cycle level, treating the entire A1→M1→C1→M2→V→Ledger path as a single map `G_cycle`, we assume a bounded Lipschitz behavior:

```math
\|G_{cycle}(x_1) - G_{cycle}(x_2)\| \le L_{cycle} \|x_1 - x_2\|
```

for inputs `x` drawn from a governed domain (respecting constraints and badges), with `L_{cycle}` implicitly captured by:

- strictness schedules from the registry,
- MCP stability bounds (Volume 4),
- and pruning / drift thresholds (Volumes 2 and 5).

This bound is not computed directly but serves as a conceptual guarantee that the governed cycle does not exhibit unbounded sensitivity to admissible inputs.

## 4. Badge & Role Governance Substrate
- Identity: `id = (principal, directory_ref, attributes)`.
- Badges: capability tokens; taxonomy includes: `builder.author`, `builder.activate`, `validator.run`, `validator.override`, `orchestrator.execute`, `orchestrator.policy`, `output.review`, `graph.access`, `graph.admin`, `training.approve`, `training.execute`, `ledger.admin`.
- Separation of duties: sensitive actions require multi-badge approval (e.g., `builder.activate` + `validator.run`).
- Badge activation contexts: `(id, badge_set, validity_window, jurisdiction_tag, fkf_scope)`, recorded in ledger/FLC as signed activation.
- Badge activation preconditions: valid identity, parent badge (if required), and policy constraints satisfied.
- Delegation: allowed only if delegator holds `badge.delegate` plus target badge; delegated window `\subseteq` delegator window; recorded with parent hash; enforced by badge constraint nodes.
- Revocation: CRL-style list per fkf_scope; entry `(id, badge, ts_revoke, reason, prev_hash)`; guards reject revoked entries with earlier or overlapping windows.
- Renewal: new activation with later window; ledger-linked to prior entry; cannot overlap revoked window unless governance override logged.
- Federated propagation: cross-node use requires proof chain `(activation hash, fkf_scope, jurisdiction, validity)`; CGL badge nodes verify proof and CRL freshness before allow.
- Minimal safe badge set and delegatable classes defined in Volume 6; governance actions in this volume must satisfy those role requirements.
 - CRL freshness invariant: CRL age must be `<= T_crl` (Volume 1 constants); stale CRL blocks governance actions (builder activate, validator override, orchestration policy change) until refreshed.
- Governance checkpoints: builder publication, validator override, orchestration policy change, connector access, routing of sensitive outputs, training activation.

## 5. Constraint and Penalty Computation
- Constraint node: `c_i: Y -> {0,1}`, violation `\mu_i(y) = 1 - c_i(y)`.
- Penalty surface:
```math
\Phi(y) = \sum_i w_i \, \mu_i(y), \quad w_i \ge 0 \\
\nabla \Phi(y) = (\partial \Phi / \partial y_j)_j
```
- Strictness coupling: `w_i = w_i^{base} \cdot (1 + \sigma(level) \cdot k_i)`.
- Constraint closure: closure operator `Cl(C)` adds implied constraints; applied at build time and before validation (see Volume 2).

## 6. Telemetry and Event Schema (summary)
- Telemetry packets are time-ordered, signed, and hash-linked to the ledger.
- Required fields: `ts, stage, mu, phi, divergence, decision, hash, mode, strictness, constraint_ids, badges, fkf_node, jurisdiction_tag`.
- Precedent-based inference telemetry: records derived decisions (e.g., policy inference) with source hashes.
- Visibility: badge- and policy-conditioned; federated nodes redact fields according to FCE.

## 7. Ledger Schema and Integrity (summary)
- Entry:
```math
e_t = (seq, ts, stage, actor, badges, payload_hash, Vset, prev_hash, jurisdiction, fkf_node) \\
h_t = H(e_t \| h_{t-1}), \quad h_0 = \text{genesis}
```
- Multi-ledger topology: local ledgers per node, federated links via FLC; snapshot and merge rules in Volume 6.

## 8. Enterprise Graph Integration Layer (hooks)
- Connectors abstract enterprise graph providers for identity resolution, org structure, and resource discovery.
- External identities map to internal roles/badges via signed bindings; multi-directory handled via scoped connectors and jurisdiction tags.
- All graph interactions are gated by badge and constraint checks and are ledgered with connector id and policy context.

## 9. Governed Continuation Layer (GCL)
- Continuation checkpoint: `(S_t, G_version, strictness, mode, jurisdiction, badge_set, fkf_scope, ttl, ts_checkpoint, seeds)`.
- Temporal invariants: latency bounds, freshness windows, revalidation cadence; encoded as temporal constraints in CGL.
- Resume/restore (causal ordering aligns with ledger/FLC hashes):
  1) Verify `ttl` and `ts_checkpoint` not expired; otherwise require badge override.
  2) Verify ledger/FLC head consistency with checkpoint hash; replay to prev_hash if needed.
  3) Re-validate badges (activation + revocation lists, CRL freshness `<= T_crl`) and FCE; ensure strictness at least the checkpoint value (no strictness relaxation on resume).
  4) Re-run `guard_stability` and `guard_V`; if pass, resume at A1/M1 with stored seeds; else SAFE_ANALYTIC.

## 10. Federated Knowledge Fabric Hooks
- Federated Constraint Envelope (FCE): set of constraints shared across nodes; applied before local validation.
- Federated Invariant Propagation (FIP): propagation protocol for pushing constraint deltas with lineage.
- Federated Ledger Continuum (FLC): hash-linked lineage across nodes; used for replay and audit.
- Federated Telemetry Model: telemetry packets tagged with `fkf_node` and visibility scope; aggregated summaries feed MCP control.

## 11. Cross-Volume Pointers
- Volume 2: full CGL algebra, hierarchical and federated constraint envelopes, conflict graphs, distributed satisfaction.
- Volume 3: Builder DSL, lifecycle, governance gates, meta-builder, ledger lineage.
- Volume 4: MCP control law, meta-agent orchestration, federated routing, continuation execution, agent safety.
- Volume 5: meta-cognition, cross-node coherence, governed learning, narrative safety envelopes.
- Volume 6: multi-ledger topology, telemetry taxonomy, badge auditability, federated observability, training lineage.

