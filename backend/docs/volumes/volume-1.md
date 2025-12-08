# cd/ai Volume 1 - Canonical Architecture and Philosophy

## Scope
Volume 1 defines the canonical architecture, terminology, and governed lifecycle for cd/ai. It establishes the unified hemispheric cycle, the invariants that must hold across all volumes, and the core mathematical operators that everything else builds on. Volume 1.1 deepens this specification; later volumes specialize layers (CGL, Builder v2, MCP + meta-orchestration, Cognitive/Narrative, Ledger/Telemetry).

## Canonical Governed Cycle (always in this order)
A1: Analytical Hemisphere Pass  
M1: Moderator Pass (post-analytical)  
C1: Creative Hemisphere Pass  
M2: Moderator Pass (integration and reconciliation)  
V:  Validator Pass  
Ledger Commit  
MCP Governance Loop (G1)  
Output Routing + Constraint Enforcement

Each stage is deterministic except C1 (stochastic but bounded). Every transition is guarded by admissibility, stability, and lineage rules; failures roll back to the earliest stage that can resolve the violation. Long-horizon execution uses the same cycle iterated over time with governed continuation checkpoints (see Volume 1.1 and Volume 4).

## Validator = QC Signal, Not Gate
The Validator pass (“V”) is a quality-control evaluator. It inspects the *final* MCP output against declarative governance rules that enter the cycle as normalized constraints. It performs four tasks only:

1. **Rule interpretation** – apply canonicalized rules and constraint algebra, not heuristics, to the generated text.
2. **Issue typing** – classify every finding as an absolute rule violation, contextual (“gray space”) flag, or soft guidance.
3. **Explanation** – log rationale + evidence for every issue and emit a structured QC payload (`absoluteIssues`, `contextualIssues`, `softIssues`, `qualityState`, `requiresCorrection`, `requiresHumanReview`).
4. **Override-ready logging** – when an authorized reviewer overrides an absolute issue, the validator records justification + an auditable signature (user id, badges, timestamp) and forwards the record to the ledger for traceability.

The validator never decides workflow outcome on its own. It instructs the MCP to keep cycling when absolute issues remain, surfaces contextual/gray-space findings for human review, and only blocks output when a rule explicitly says “deny/clarify.” Simulation mode never blocks: it rewrites operational language into conceptual form, tags the ledger entry with `simulationMode`, and still emits the QC log so the Runtime Governance panel can show why the simulation passed.

> **Override discipline** – Overrides are badge-gated (see Volume 1.1). Every override must include a justification string and is notarized in the ledger with `{userId, userName, badgeSet, timestamp}` so audits can trace who accepted the risk envelope.

## Core Operators and Spaces
- `A(x, g, C_t)`: deterministic analytical transform.
- `C(x, xi, C_t)`: stochastic generative transform with noise `xi`.
- `M(a, c, C_t)`: reconciliation operator that minimizes divergence while removing violations.
- `V(u, C_t) -> {0,1}`: admissibility operator; 1 means all constraints satisfied.
- `F: S_t -> S_{t+1}`: MCP control law over governed state `S_t`.
- `L_t`: append-only ledger chain.
- `G = (V, E, tau)`: Constraint Graph Layer (see Volume 2) with typed constraint nodes and monotone accumulation.
- `B_v2`: Builder Layer v2 declarative specification system (see Volume 3) that produces plan DAGs, constraint graphs, orchestration graphs, and UI bindings under governance.
- `O_meta`: meta-agent orchestrator (see Volume 4) coordinating agents, tools, and federated knowledge nodes under policy and badge constraints.
- `FKF`: Federated Knowledge Fabric composed of Federated Knowledge Nodes (FKNs), governed by federated constraint envelopes and federated ledger continuums (see Volumes 2, 4, 6).

Key metric functions (notation is canonical across all volumes):
```math
\mu_i(y) = 1 - c_i(y) \\
\Phi(y) = \sum_i w_i \, \mu_i(y) \\
d(a,c) = \text{bounded divergence metric (embedding or edit distance)} \\
\sigma(\text{level}) \in [0,1] = \text{strictness scaling function}
```
Control references:
```math
S_{t+1} = F(S_t, u_t; \theta, \sigma) \quad \text{(see Volume 4 for full definition)} \\
||S_t|| \le BSE \Rightarrow \text{stable domain; } x_t \equiv S_t \text{ used interchangeably}
```

Global operator domains/codomains (common across volumes):
- `A: X \times G \times C -> Y` (deterministic)
- `C: Y \times \Xi \times C -> Y` with `\Xi` noise space
- `M: Y \times Y \times C -> Y`
- `V: Y \times C -> {0,1}`
- `F: S \times U -> S` where `S` is governed state, `U` is input/telemetry

Global strictness and bounds (defaults; override per deployment):
- `\sigma_{min} \in [0,0.2]`, `\sigma_{max} \in [0.8,1]`
- `\epsilon = \epsilon_{base} (1 - \sigma(level))`, `\epsilon_{base}` configured per deployment
- Divergence cap for C1: `E[d(c,m1)] \le \delta_0 (1-\sigma(level))`

### Global Lipschitz and Stability Summary

Throughout cd/ai, the governed runtime is treated as a Lipschitz system with respect to state and inputs.

Let:
- `S_t` be the governed state (Volume 4),
- `u_t` the control inputs (telemetry-dependent),
- `F(S_t, u_t; \sigma)` the state update map.

Assume there exist functions `\alpha(\sigma)` and `\beta(\sigma)` such that:

```math
\|F(S_1, u_1; \sigma) - F(S_2, u_2; \sigma)\|
\le \alpha(\sigma) \|S_1 - S_2\| + \beta(\sigma) \|u_1 - u_2\|
```
with:

```
0 <= \alpha(\sigma) < 1 in the governed operating regime,

\beta(\sigma) bounded by constants in registry/constants.md.
```

The Global Constants Registry stores:

- strictness bounds `\sigma_{min}, \sigma_{max}`,
- envelope parameter `\epsilon`,
- safety margin `m_safety`,
- and any derived Lipschitz bounds.

Stability condition (high-level):

If `\alpha(\sigma) < 1` and disturbances are bounded as in Volume 4, then `S_t` remains in the bounded state envelope (BSE) defined by `\epsilon`.

Volumes 4 and 5 instantiate this generic bound for the MCP and cognitive/narrative layers.

## Global Constants Table (defaults; may be tightened per deployment)
- Strictness: `\sigma_{min}=0.1`, `\sigma_{max}=0.9`, `s(level)` monotone in `[0,1]`.
- Stability: `\epsilon_{base}` chosen per system; `\epsilon = \epsilon_{base} (1-\sigma)`.
- Divergence thresholds: `\tau_{ok}=0.2`, `\tau_{warn}=0.35`, `\tau_{div}=0.2`.
- Telemetry: `T_batch=5s` (max batch window), `T_critical=30-90d`, `T_std=7-30d`.
- Consensus/merge: `T_consensus=2s`, `retry_consensus=2`; `T_merge=5s`, `retry_merge=2`.
- CRL freshness: `T_crl` policy-defined (e.g., 1-24h); stale CRL blocks governance actions.
- Quorums (min N=3): safety/invariant = ceil(2N/3); policy/badge = ceil(2N/3)+authority badge; semantic = governed-eventual with timeout+revalidation.
- Training SLA example: C1 latency p95 < 500ms; `\sigma >= 0.6` in shadow; divergence `<= \tau_{ok}` for promotion.

The values above are canonical defaults. The authoritative, deployment-checked values live in the Global Constants Registry:
- See `registry/constants.md` for the full registry and machine-readable parameter set.
- All later volumes (2–6) must treat `registry/constants.md` as the source of truth; any local overrides must be ledgered as governance overrides.

## Global Invariants (applies to all volumes)
- **Monotone constraints:** `C_{t+1} = C_t \cup \Delta C` and admissible region never expands (`A_{t+1} \subseteq A_t`).
- **Admissibility:** `V(y)=1` iff all active constraints hold; no commit without `V=1`.
- **Lineage:** every state transition, decision, and payload is hash-chained into `L_t`.
- **Stability:** governed state stays inside domain `D` where `||S_{t+1}-S_t|| \le \epsilon`.
- **Safety envelope:** constraint graph contains explicit safety nodes that gate progress; violation forces rollback or quarantine.
- **Deterministic boundary:** only C1 is stochastic; all other stages must be reproducible for identical inputs and seeds.
- **Badge gating:** governance-critical actions (constraint edits, builder activation, validator override, routing of sensitive outputs) require verified badges; badges are enforced in the constraint graph, MCP, and ledger (see Volumes 1.1, 3, 4, 6).
- **Federated governance:** federated nodes obey Federated Constraint Envelopes (FCE) and share lineage through a Federated Ledger Continuum (FLC); cross-node actions require badge propagation and federated admissibility (see Volumes 2, 4, 6).
- **Long-horizon continuation:** continuation checkpoints (GCL) preserve state envelopes and temporal invariants for multi-cycle execution (see Volume 1.1 and Volume 4).

## Hemispheric Roles
- **Analytical hemisphere (A1):** deterministic reasoning that grounds goals, extracts structure, and populates initial constraint deltas.
- **Creative hemisphere (C1):** bounded stochastic exploration that proposes novel material without violating hard constraints.
- **Moderator (M1/M2):** deterministic reconciliation that reduces violations and aligns analytic and creative products.
- **Validator (V):** deterministic admissibility check over the active constraint graph.
- **MCP (G1):** control loop that adjusts constraints, modes, and penalties based on telemetry and ledger lineage.

## Federated Knowledge Fabric (overview)
- **FKN:** a governed data/logic node with local constraints, ledger segment, and telemetry stream.
- **FKF:** the set of FKNs plus routing and constraint propagation rules; governed by FCE (constraint envelopes) and FLC (ledger links).
- **Federated invariants:** cross-node constraint propagation (FIP) ensures shared invariants (safety, identity, badge, jurisdiction) remain consistent across nodes.
- **Federated admissibility:** a payload is admissible only if local CGL and applicable federated constraints are satisfied; conflicts resolved via federated conflict graph and recovery rules (see Volume 2).
- **Federated telemetry:** time-ordered telemetry packets carry node id, badge context, constraint ids, and hashes; visibility is badge- and policy-scoped (see Volume 6).

## Long-Horizon Governed Continuation (overview)
- Governed Continuation Layer (GCL) maintains state envelopes for long-running tasks across cycles.
- Continuation checkpoints: `(S_t, H_t, G_version, strictness, mode, jurisdiction_tag, badge_set)`.
- Temporal invariants: latency bounds, freshness windows, and scheduled re-validation; enforced by CGL temporal nodes and MCP timers.

## Deterministic vs Nondeterministic Boundary
- Deterministic: A1, M1, M2, V, Ledger, G1 control logic, Routing, continuation checkpoints.
- Nondeterministic but bounded: C1 sampling; MCP penalty tuning uses bounded stochasticity but must converge.

## Cross-Volume Map
- Volume 1: canonical architecture and federated/continuation overviews (this file).
- Volume 1.1: specification parameters, guards, strictness functions, badge/identity substrate, enterprise graph hooks, continuation layer, federated identity propagation.
- Volume 2: CGL mathematics including hierarchical/federated constraint envelopes, conflict graphs, and distributed satisfaction.
- Volume 3: Builder Layer v2 (DSL, templates, lifecycle, meta-builders, multi-tenant separation, ledgered lineage).
- Volume 4: MCP control law, meta-agent orchestrator, multi-agent safety, federated orchestration, continuation execution.
- Volume 5: Cognitive/narrative layer, meta-cognition, cross-node coherence, governed learning loops.
- Volume 6: Ledger/telemetry, federated ledgers, strictness formalism, badge auditability, training lineage, federated observability.

## Volume 1.2 — Data Scope Governance Layer (Work/Web Modes)
Volume 1.2 introduces a formal data scope dimension that constrains how the governed runtime reasons about data origin, provenance, and permissible sharing paths. This layer is mandatory before Volume 2 so constraint algebra, canonical traces, and telemetry all encode whether a cycle stays inside enterprise-only data or intentionally reaches into the public web.

### Formal Definition of DataScopeMode
Let `dataScopeMode ∈ { work, web }` with default `work`. The mode is selected during envelope assembly based on classification, user badges, deployment policy, and explicit user intent; it cannot be reassigned mid-cycle without a full MCP restart.

- **work mode:** scope is limited to internal, enterprise, or explicitly whitelisted datasets. External fetching, browsing, or referencing is forbidden unless elevated by MCP governance overrides. Provenance is implicit (enterprise ledger), and safety emphasis tightens external-sharing constraints.
- **web mode:** scope permits public web data plus the same internal sources; every external artifact must be tracked with citation + provenance metadata and is subject to heightened validator review.
- **Motivation:** provenance fidelity, safety differentiation, constraint clarity, and data origin governance require an explicit dimension so that downstream algebra and telemetry can reason about what data was allowed, requested, and emitted.

Invariants:
- If `dataScopeMode = work`: external data access is forbidden, strictness baseline is `1`, and external-sharing constraints are elevated (e.g., `no_external_sharing` becomes hard-enforced).
- If `dataScopeMode = web`: external data is allowed, provenance + citation are required, and strictness elevation is conditional on rule set composition (e.g., citation gaps raise strictness).

### Governance Impact Summary
DataScopeMode influences every governed subsystem:
- **Classification:** request typing and envelope.actionCategory incorporate data scope hints so the correct mode is selected before A1 begins.
- **Constraint algebra + normalization:** rule parsing injects scope constraints (no web access, citation requirements) and normalizes them into deterministic summaries.
- **Governance decision matrix:** decision branches consider mode-specific violations (e.g., blocking web access attempts from work mode).
- **Validator:** enforces external sharing bans, citation/provenance requirements, and clarifies when intent is ambiguous relative to the active mode.
- **Output shaping:** governed prompt builder emits `[Data Scope]` context plus citations/provenance expectations.
- **Canonical trace:** every trace entry logs mode, provenance state, and external references for audit replay.
- **Telemetry:** adds mode-aware packets (`v1.2-data-scope`) so downstream monitors can reconcile strictness and constraint activations.
- **Clarification logic:** strictness-aware clarification triggers fire when mode + user intent conflict (e.g., web-needed tasks in work mode or missing citations in web mode).

| DataScopeMode | Allowed Data Sources | Required Constraints             | Strictness Adjustments |
|---------------|---------------------|----------------------------------|------------------------|
| work          | internal only       | `no_external_sharing` enforced   | `strictness ≥ 1`       |
| web           | public + internal   | `citation + provenance` required | dynamic per rule set   |

### CycleState Additions
- `cycleState.dataScopeMode: "work" | "web"` persists for the entire cycle. Default assignment is `"work"` unless classification or badge-gated intent explicitly sets `"web"`.
- Propagation rules: A1 writes the initial mode into cycleState; every hemisphere receives it as immutable context. Any attempt to switch modes mid-cycle must be rejected with a governance event so the MCP can restart in the requested mode.
- Canonical trace logging: each trace node records `dataScopeMode`, `provenanceRequired`, and `citationRequired`; resume checkpoints copy this data so clarification flows cannot lose scope context.
- Constraint + telemetry binding: constraintSummary, MPC telemetry, and governance narratives echo the current mode so downstream reviewers can tell whether external data was authorized.

### Governance Rationale
- The lattice requires provenance-awareness before Volume 2 introduces federated constraint propagation; DataScopeMode provides the primitive.
- Propagation engines and rule normalizers need source-aware constraints to prevent silent mixing of internal and public data.
- Governance decisions must account for data origin so matrices, validators, and narratives can articulate why external data was blocked or demanded.
- Many enterprise deployments forbid external access by default; a formal mode prevents accidental leaks while still enabling explicit web usage when governance approves.

## Global Glossary and Notation (canonical)
- Strictness: `\sigma(level) = \sigma_{min} + (\sigma_{max}-\sigma_{min}) s(level)`, `s(level) \in [0,1]` monotone.
- Governed state: `S_t` (a.k.a. `x_t`) with partitions `S_t^{det}, S_t^{stoch}`, jurisdictions `S_{t,j}`, fkf context `fkf_ctx`.
- Control law: `S_{t+1} = F(S_t, u_t; \theta, \sigma) = A(\sigma) S_t + B(\sigma) u_t + g(\sigma, \theta)`, Bounded State Envelope `BSE: ||S_{t+1}-S_t|| \le \epsilon`.
- Cycle stages: `A1, M1, C1, M2, V, LEDGER, G1, ROUTE`; modes: `NORMAL, SAFE_ANALYTIC, QUARANTINE, CONTINUATION`.
- Constraints: `G=(V,E,\tau)`, node types `{safety, semantic, policy, badge, fkn, meta}`, closure `Cl(C)`, conflict graph `K`, admissibility `V(y)=1` iff all active constraints hold.
- Federated: `FKN` (node), `FKF` (fabric), `FCE` (envelope), `FLC` (ledger continuum), `FIP` (propagation); fkf_scope tags scope federated applicability.
- Ledger: entries `e_t`, hashes `h_t`, segments (local/regional/federated), classes `{safety/invariant, policy/badge, semantic}`; signatures canonical multi-sig over `(hash || fkf_scope || jurisdiction || ts || signer_id)`.
- Telemetry: packets with `ts, stage, mu, phi, divergence, decision, hash, mode, strictness, constraint_ids, badges, fkf_node, jurisdiction`; promotion thresholds `\tau_{ok}, \tau_{warn}, \tau_{div}`, batch window `T_batch`.
- Drift/divergence: creative divergence bounded by `\delta_{creative}`; semantic drift metric `D(y, y_ref)` with thresholds `\tau_{ok}, \tau_{warn}` (see Volume 5); drift/violation vectors `\mu`, penalties `\Phi`.
- Continuation: checkpoint `(S_t, G_version, strictness, mode, seeds, fkf_scope, ttl, ts_checkpoint, prev_hash)`; restore enforces `strictness_{resume} >= strictness_{checkpoint}`, causal replay to `prev_hash`, CRL freshness `<= T_crl`.
- Badges/identity: activation `(id, badge_set, validity_window, jurisdiction, fkf_scope)`, delegation/renewal/revocation (CRL), minimal safe badge set and delegatable classes in Volume 6.
- Builder DSL: plan spec with `workflow, constraints, invariants, policies, agents, tools, connectors, panels, badges_required, runtime_topology, fkf_scope, jurisdiction, tenant, seeds`, meta-constraints grammar (Volume 2).
- Serialization/hashing: canonical JSON (UTF-8, sorted keys) for seeds, configs, fixtures, and proofs; hash with SHA-256 (big-endian digest) to align ledger, continuation, and replay across nodes; signature suite default Ed25519 (P-256 allowed via governance override). Deployment parameter registry is canonical JSON (UTF-8, sorted keys, SHA-256 hashed) with fields `{T_consensus, T_merge, T_batch, jitter_policy, backoff_caps, m_safety, q, gamma, caps_V, caps_E, skew_bound, crypto_suite}`; nodes fetch registry, recompute hash, and refuse participation on mismatch.
