# cd/ai Volume 2 - Constraint Graph Layer (CGL) and Federated Mathematical Substrate

## Scope
Volume 2 defines the Constraint Graph Layer (CGL), the mathematical substrate that encodes invariants, safety envelopes, admissibility rules, constraint composition, and federated propagation for the governed cycle. It integrates Appendix A material plus the federated knowledge fabric (FKN/FKF), federated constraint envelopes (FCE), federated ledger continuum (FLC), and federated telemetry model. Volumes 3-6 build on this layer.

**Constants:** This volume uses strictness, divergence, timing, and pruning thresholds from the Global Constants Registry (`registry/constants.md`) and Volume 1. Do not redefine numeric defaults here; any deployment-specific overrides must be ledgered as governance actions.

## 1. CGL Purpose and Interface
- Provides the canonical constraint set `C_t` consumed by A1, C1, M1/M2, V, MCP/orchestrator, and continuation checkpoints.
- Encodes invariants, safety envelopes, admissibility rules, policy/badge requirements, connector and federated constraints.
- Governs federated knowledge nodes (FKNs) and enterprise graph connectors as constrained resources.
- Supplies violation metrics and gradients to the MCP for penalty tuning and to Builder for validation at build time.
- Produces minimal-cut guidance for recovery and rollback (local and federated).

## 2. Formal Model
### Graph Definition
```math
G = (V, E, \tau), \quad V = V_I \cup V_S \cup V_{sem} \cup V_{policy} \cup V_{badge} \cup V_{fkn} \cup V_{meta} \\
\tau: V \rightarrow \{\text{invariant}, \text{safety}, \text{semantic}, \text{policy}, \text{badge}, \text{fkn}, \text{telemetry}, \text{meta}\}
```
- Each node `v_i` represents a constraint function `c_i: Y -> {0,1}`; violation `\mu_i(y) = 1 - c_i(y)`.
- Meta-constraints (in `V_meta`) describe admissible constraint formation rules (closure, inheritance, badge requirements for constraint edits).
- Edge `(u,v)` encodes dependency; graph is evaluated in topological order (DAG for execution; hierarchies allowed via expansion into DAG).

### Aggregation and Penalty Surface
```math
\Phi(y) = \sum_{i} w_i \, \mu_i(y), \quad w_i \ge 0 \\
V(y) = 1 \iff \forall i: c_i(y) = 1
```
Weights are strictness-scaled: `w_i = w_i^{base} \cdot (1 + \sigma(level) \cdot k_i)`.

### Constraint Closure and Inheritance
- Closure operator `Cl(C)` adds implied constraints; must terminate and remain monotone.
- Inheritance: hierarchical graphs `G_parent -> G_child` where `C_child = Cl(C_parent \cup \Delta C_child)`; admissible region can only shrink.
- Constraint versioning: `c_i^{(v)}` with lineage pointer to ledger entry and optional parent id for inheritance.
- Meta-constraint grammar (allowed forms): `RequireBadge(action, badge_set)`, `AllowForm(op in {and, temporal, aggregate})`, `ForbidRemoval(type in {safety,badge})`; edits outside grammar rejected at build/consensus.

### Constraint Composition and Conflict Graph
- Conjunction (default): `c_{a \land b}(y) = c_a(y) \land c_b(y)`.
- Conflict graph `K = (V_K, E_K)` derived from unsatisfiable pairs/sets; used for recovery guidance.
- Conflict graph derivation (outline):
  1. For each pair `(c_i, c_j)` detect logical incompatibility or overlapping hard bounds; add edge if infeasible.
  2. For sets, run SAT/SMT or constraint solver; minimal unsat cores become hyperedges collapsed into `E_K`.
  3. Weight edges by cumulative `w_i+w_j` (or core sum) to guide recovery.
- Distributed satisfaction: nodes partitioned by jurisdiction or fkf_node; constraints referencing remote data are wrapped by connector/badge gates.

## 3. Evaluation Semantics
- **Topo evaluation:** evaluate nodes in order; fail-fast on safety nodes.
- **Caching:** deterministic hashes for subgraphs allow memoized validation and cross-node replay.
- **Incremental update:** only nodes affected by `\Delta C` or changed inputs re-evaluate.
- **Gradient exposure:** `\nabla \Phi` exposed to MCP for penalty adjustment and to C1/M1/M2 for guided decoding/reconciliation.
- **Badge enforcement:** governance-critical nodes check `guard_badge(action)=1`; failure yields `BADGE_FAIL`.
- **Federated envelope:** apply FCE nodes first when fkf_scope is present; then local safety, then remaining constraints.

Pseudo-evaluation:
```math
\text{for } v_i \in \text{topo}(G): \\
\quad \text{if } \tau(v_i)=\text{safety} \text{ and } \mu_i>0 \Rightarrow \text{halt, V=0} \\
\quad \text{if } \tau(v_i)=\text{badge} \text{ and } \text{badge\_check}=0 \Rightarrow \text{halt, BADGE\_FAIL} \\
\quad \text{if } \tau(v_i)=\text{fkn} \text{ and } \text{connector\_policy\_fail} \Rightarrow \text{halt, CONNECTOR\_DENY} \\
\quad \text{accumulate } \mu_i, \Phi
```

## 4. Violation Metrics and Penalty Gradients
```math
\mu(y) = [\mu_1(y), ..., \mu_n(y)]^T, \quad
\nabla \Phi(y) = \sum_i w_i \nabla \mu_i(y), \quad
\| \mu(y) \|_p = (\sum_i |\mu_i(y)|^p)^{1/p}
```
Federated penalty scaling may add weights per fkf_node: `w_i = w_i^{base} (1 + \sigma(level) k_i + \kappa_{fkf} \cdot \mathbf{1}_{fkf(i)})`.

## 5. Minimal-Cut Recovery
Given violation set `Vset`, choose smallest weighted cut whose satisfaction restores admissibility:
```math
C^* = \arg\min_{C' \subseteq Vset} \sum_{i \in C'} w_i \quad \text{s.t.} \quad V(y | C \setminus C') = 1
```
Recovery routing:
- If `C^*` nodes originate from analytic features -> return to A1.
- If from creative divergence -> return to C1 with increased penalties.
- If safety node present -> enter QUARANTINE or SAFE_ANALYTIC based on severity.
- If badge/connector/federated node fails -> require authorized badge holder and policy review.
- If conflict graph `K` indicates unsatisfiable subset, propose constraint relaxation via governance-only path recorded on ledger.

## 6. Safety Envelopes and Admissibility
- Safety envelope `S_env \subset C_t` must be satisfied before any non-safety node.
- Federated Constraint Envelope `FCE` applies to fkf_scope; evaluated before local safety.
- Admissibility:
```math
V_{safe}(y) = 1 \iff \forall c_i \in S_{env}: c_i(y)=1 \\
V_{badge}(y) = 1 \iff \forall c_i \in V_{badge\_nodes}: c_i(y)=1 \\
V_{fce}(y) = 1 \iff \forall c_i \in FCE: c_i(y)=1 \\
V(y) = V_{fce}(y) \land V_{safe}(y) \land V_{badge}(y) \land \forall c_j \in C_t \setminus (FCE \cup S_{env} \cup V_{badge\_nodes}): c_j(y)=1
```

Admissibility Under Pruning
Let `C_t` be the full constraint set and `C_t'` the pruned set obtained by:

- Removing only semantic constraints below the threshold `T_sem` (registry),
- Leaving safety, badge, and FCE constraints unchanged.

Then:

- Any `y` that is admissible under `C_t'` is also admissible under `C_t` with respect to safety, badge, and FCE constraints.
- Semantic coverage is conservative: pruning removes low-weight semantic checks but does not relax safety or badge requirements.

This guarantees that automated pruning (Volume 5) cannot weaken the safety envelope; it can only reduce semantic coverage.

## 7. Constraint Lifecycle and Lineage
- Creation: A1 feature extraction, MCP policy updates, builder specs, governance inputs.
- Validation: build-time closure checks; runtime admissibility checks.
- Versioning: `c_i^{(v)}` with `(id, version, origin_stage, jurisdiction_tag, badge_requirement, fkf_scope)`.
- Removal/relaxation: governance-only path recorded on ledger; monotone within a cycle unless governance override with badge + ledger proof.
- Lineage: every constraint version and evaluation result hash-linked into ledger or FLC segment.

## 8. Hierarchical and Federated Graphs
- Hierarchical graphs support inheritance of invariants and safety envelopes.
- Federated graphs: `G = \biguplus_{n \in FKF} G_n` plus FCE; admissibility requires applicable `G_n` and FCE nodes.
- Federated Invariant Propagation (FIP): propagation of `\Delta C` with lineage; receiving nodes apply closure and badge checks.
- Federated Knowledge Nodes (FKNs) modeled via `V_{fkn}` with connector/badge/policy constraints and jurisdiction tags.

## 9. Telemetry and Observability Hooks
- Telemetry node ensures `payload_hash`, `constraint_ids`, `strictness`, `mu` vectors, badge context, fkf_node, and jurisdiction are recorded.
- Event schema (abbrev):
```json
{
  "ts": "...",
  "stage": "M2",
  "mu": [0,0,0.2],
  "phi": 0.2,
  "strictness": 0.8,
  "constraint_ids": ["safety.pi", "semantic.coherence"],
  "decision": "continue",
  "hash": "...",
  "badges": ["orchestrator.execute"],
  "fkf_node": "node-a",
  "jurisdiction": "global"
}
```
- Telemetry visibility is conditioned by badge and policy; federated redaction rules apply at node boundaries.

## 10. Deterministic vs Nondeterministic Boundaries
- Graph structure, weights, and evaluation deterministic for a given `C_t` and seeds.
- Stochasticity only from upstream C1 outputs; validation must remain reproducible with stored seeds.
- Federated access deterministic from CGL perspective: only allowed when constraints and badge checks pass; all accesses logged.

### Federated Clock Drift Handling
- A node MUST reject federation messages from peers whose observed clock skew exceeds `skew_bound` from the Global Constants Registry.
- Detection:
  - Peers attach `(logical_ts, wall_ts)` to messages.
  - Receiving node computes skew relative to its own time base.
- If skew > skew_bound:
  - Reject message.
  - Emit `CLOCK_SKEW_REJECT` telemetry.
  - Transition sender to `RESYNC_REQUIRED`.
- If local clock is source of skew:
  - Enter `RESYNC_REQUIRED`.
  - Realign using trusted federated time.
- Clock drift is treated as a governance-relevant failure.

## 11. Constraint Algebra (Operators)
- **Lift:** `Lift(f)(y) = 1` if `f(y)` true.
- **Compose:** `Compose(f,g)(y) = f(y) \land g(y)` (default).
- **Project:** `Project_S(y)` restricts payload to scope `S` before evaluating child node.
- **Aggregate:** `Aggregate_K` applies family of constraints over collections.
- **Temporal:** `Temporal(\Delta t_{max})` ensures time-bounded steps; used for latency SLAs and drift checks.
- **BadgeCheck:** `BadgeCheck(B_req)(y)=1` iff active badge set includes `B_req`.
- **ConnectorGate:** `ConnectorGate(conn, policy)(y)=1` iff connector invocation satisfies policy and badge constraints.
- **FederatedGate:** ensures fkf routing adheres to FCE and jurisdiction tags.
- **MetaConstraint:** enforces rules on constraint creation/editing (required badges, allowed forms).

## 12. Distributed Constraint Satisfaction
- Partitioned evaluation per fkf_node with boundary checks via FederatedGate.
- Message model: partially synchronous; messages carry `(constraint_id, version, hash, badge_proof, jurisdiction, ttl)`; use `T_consensus`, `retry_consensus` from Volume 1 constants.
- Quorum rules (min N=3):
  - Safety/invariant nodes: quorum = ceil(2N/3) of eligible nodes in fkf_scope with matching jurisdiction.
  - Policy/badge nodes: quorum = ceil(2N/3) + presence of designated authority badge holder.
  - Semantic nodes: governed-eventual; require acknowledgment from all nodes referencing the resource or timeout `T_consensus` followed by revalidation on next use.
- Consensus protocol (sketch):
  1. Propose `\Delta C` with lineage hash and badge proof.
  2. Recipients validate badge, jurisdiction, and conflict graph; if ok, sign ack.
  3. On quorum, `\Delta C` is committed locally and broadcast with quorum proof; else rollback and log conflict.
  4. Timeout `T_consensus` triggers retry (max `retry_consensus=2`) with higher strictness or governance escalation.
- Conflict handling: unsatisfied quorum -> add conflict edge in `K`, enter recovery or governance vote logged in FLC.
- Liveness: governed-eventual constraints are revalidated on first use after timeout; MCP monitors stalled constraints and can raise strictness or escalate to governance vote.
- Quorum proof encoding: canonical multi-sig over `(constraint_hash || fkf_scope || jurisdiction || ts || signer_id)` with deterministic serialization; same format reused for ledger/merge (Volume 6).
- Message format: `(constraint_id, version, constraint_hash, fkf_scope, jurisdiction, ts, ttl, badge_proof, proposer_id)` serialized deterministically; signatures validate this envelope; tie-breaks use `(strictness desc, ts asc, proposer_id lexicographic)`.
- Safety/liveness: partially synchronous with timeout `T_consensus`; if retries exhausted, governance vote required; safety preserved by only applying constraints with quorum proof; liveness ensured by eventual vote or escalation.
- Deployment guidance: set `T_consensus` with jitter window ±10% to avoid thundering herd; `retry_consensus` capped at 2 with exponential backoff up to `3*T_consensus`; anti-entropy pull every `k` rounds (e.g., every 3rd round) to repair missed messages.
- Deployment tuning table (example):
  - `N<=5`, RTT<=50ms: `T_consensus=2s`, jitter ±10%, backoff cap 6s, anti-entropy every 3 rounds.
  - `5<N<=15`, RTT<=150ms: `T_consensus=3s`, jitter ±15%, backoff cap 9s, anti-entropy every 2 rounds.
  - `N>15` or geo-distributed: `T_consensus=5s`, jitter ±20%, backoff cap 15s, anti-entropy every round; governance override if exceeded.
- Clock and skew assumptions: nodes must maintain bounded clock skew (e.g., <=50ms) via trusted time source; proposals include `ts, ttl`; receivers reject messages outside `[ts-Δ, ts+ttl]` to avoid stale commits.
- Dynamic tuning: observe RTT variance; if p95 RTT rises, scale `T_consensus` by `(p95_RTT / baseline_RTT)` within policy bounds and record in registry; if persistent skew > bound, enter SAFE_ANALYTIC and resync time before rejoining consensus.

### Adaptive Consensus Timing and Resync Protocol (Extended)
- **Adaptive Cadence:** Nodes compute `T_consensus_adapt = clamp( T_consensus * (p95_RTT / baseline_RTT), [T_min, T_max] )`, where defaults come from Volume 1 registry.
- **Hysteresis:** A node only changes cadence when `(p95_RTT_new - p95_RTT_old) > H_thresh`; Volume 1 default `H_thresh = 20%`; recompute p95 RTT every 100 rounds or 5 minutes.
- **Resync Trigger:** If skew or RTT variance exceeds policy bounds, node enters `RESYNC_REQUIRED` state, halting proposals.
- **Resync Procedure:**
  1. Perform clock correction from trusted source.
  2. Pull latest registry constraints.
  3. Fetch FLC safety-critical entries and badge CRL.
  4. Validate badge proofs and jurisdiction tags.
  5. Re-enter consensus with `strictness >= checkpoint_strictness`.
- **Logged Rejoin:** Ledger records `(node_id, skew_before, skew_after, badges, registry_hash)` for deterministic replay.
- **Anti-entropy:** If a node does not receive expected deltas within `k` rounds, it initiates a pull repair cycle using deterministic envelope encoding.

### Distributed Satisfaction Resync Protocol (Full)
Nodes participate in distributed constraint satisfaction only when their local constraint store, badge proofs, timing parameters, and clocks match the registry defaults. When a deviation is detected, the node enters `RESYNC_REQUIRED`.

**Triggers for RESYNC_REQUIRED:**
- Clock skew exceeds the allowed bound defined in `registry/constants.md` (`skew_bound`).
- Constraint store hash does not match the registry hash.
- Badge CRL is stale relative to `T_crl`.
- Node observes RTT variance > jitter policy threshold.
- Node emits inconsistent strictness/semantic weights during constraint evaluation.

**Resync Procedure (deterministic):**
1. **Clock Realignment:**  
   Align local clock using trusted cluster source. If clock error > `skew_bound`, halt until corrected.

2. **Constraint Store Refresh:**  
   Pull the canonical constraint package, recompute SHA-256, and compare to registry hash.

3. **CRL and Badge Validation:**  
   Fetch CRL, verify freshness (`T_crl`), verify badge chain, jurisdiction, and scope.

4. **Semantic Graph Realignment:**  
   Pull missing semantic edges, compute new `(V, E)` and prune edges < `T_sem * median(w_semantic)`.

5. **Strictness Recalibration:**  
   Recompute strictness, enforce monotonicity, and raise strictness if prior cycle triggered drift.

6. **Topological Check:**  
   Re-evaluate constraint DAG for cycles or illegal dependencies. Resolve or mark UNSAFE.

7. **Commit and Rejoin:**  
   Log a `RESYNC_REJOIN` ledger entry containing:  
   `(node_id, clock_before, clock_after, registry_hash, crl_hash, strictness, ts)`.

Nodes rejoin consensus only after all steps succeed. Failure triggers SAFE_ANALYTIC.

## 13. Federated Conflict Resolution
- Conflict graph identifies incompatible constraints; recovery chooses relaxation candidates requiring governance badges.
- Federated rollback uses FLC snapshot plus constraint versions; safest node wins for safety constraints; quorum/priority for semantic/policy constraints.
- Merge algorithm (outline):
  1. Collect conflicting versions `\{c_i^{(v)}\}` with hashes and origins.
  2. For safety/invariant: select minimal-risk version (lowest violation history) with quorum signatures.
  3. For policy/badge: require authority badge + majority signatures.
  4. For semantic: prefer latest timestamp with no safety impact; else request human/badge holder.
  5. Record decision in FLC with conflict set, quorum proof, and badge context.
- Tie-break across jurisdictions: if conflicting jurisdiction tags, prefer stricter/smaller admissible set; if equal, prefer higher strictness level; unresolved -> governance vote with authority badge.
- Latency/backoff: consensus rounds target `T_consensus` (Volume 1) with exponential backoff capped at 3x `T_consensus`; after `retry_consensus` exhausts, escalate to governance vote.

## 14. Integration with Builder and MCP
- Builder v2 compiles DSL into `G_plan`, applies closure, inheritance, and badge checks; records `G_plan` hash in ledger.
- MCP/orchestrator consumes `G` and FCE to gate execution, routing, and connector usage; updates weights via telemetry-driven strictness.
- Continuation checkpoints store `G` version and applicable FCE ids for replay.

## 15. Recovery Playbook
- Safety violation: halt, quarantine, emit ledger entry with `safety_block`.
- Semantic violation: rerun C1 with higher penalties and reduced divergence bound.
- Structural violation: rerun A1 to reconstruct schema; then M1 for reconciliation.
- Badge/connector/federated violation: block action, log `BADGE_FAIL` or `CONNECTOR_DENY` or `FCE_FAIL`, require authorized badge holder and policy review.
- Conflict detection: consult conflict graph, propose governed relaxation with ledger vote; else quarantine.
- Repeated failures: tighten `\sigma(level)` globally, enter SAFE_ANALYTIC, require human review.

## 16. Guarantees
- **Soundness:** if `V=1`, all active constraints hold (local and applicable federated).
- **Monotonicity:** constraint addition never enlarges admissible region within a cycle; relaxation requires governance.
- **Termination:** topo-order evaluation over DAG halts; hierarchical graphs expand to DAG.
- **Lineage:** every `G` version and evaluation result hash-linked to ledger/FLC.
- **Governance binding:** badge/role requirements, connector permissions, and federated envelopes enforced by constraints, making decisions auditable and immutable.
