# cd/ai Volume 6 - Ledger, Telemetry, and Governance Runtime

## Scope
Volume 6 defines the ledger, telemetry bus, strictness scaling, and governance runtime. It covers multi-ledger topology, federated observability, badge auditability, training lineage, and governance invariants. It integrates the federated knowledge fabric (FKN/FKF), federated ledger continuum (FLC), and telemetry taxonomy.

**Constants:** Ledger, telemetry, and merge timing parameters (`T_batch`, `T_consensus`, `T_merge`, `retry_*`, `T_crl`, and crypto suite defaults) are taken from `registry/constants.md` and Volume 1. Nodes MUST verify local parameters against the registry hash before participating.

## 1. Ledger Model
- Append-only chain `L = {e_0, e_1, ...}` with hashes:
```math
e_t = (seq, ts, stage, actor, badges, payload_hash, violations, connector_calls, fkf_node, jurisdiction, prev_hash) \\
h_t = H(e_t \| h_{t-1}), \quad h_0 = \text{genesis}
```
- Commit rule: commit only when `V=1`, telemetry contract satisfied, badge requirements satisfied, routing policy approved, and FCE conditions met.

## 2. Multi-Ledger Topology and Federated Ledger Continuum
- Topology: local ledgers per tenant/node, optional regional ledgers, and a federated ledger continuum (FLC) linking segments via hash pointers.
- Ledger segment boundary rules: safety and badge-critical entries must anchor to both local and federated segments; semantic-only entries may stay local.
- Consistency models: safety entries require strong/quorum consistency; semantic/policy entries may use governed-eventual with bounded delay.
- Ledger snapshot semantics: snapshot `(h_t, ts, jurisdiction, fkf_scope, strictness, mode)` supports replay and continuation.
- Merge/reconciliation algorithm (outline):
  1. Exchange heads and Merkle proofs for the range since last sync.
  2. Verify hashes and badge proofs for each entry; drop revoked badge entries.
  3. Classify entries: safety/invariant -> require quorum signatures; policy/badge -> require authority badge + majority; semantic -> merge by timestamp with revalidation.
  4. Apply entries in order; on conflict, prefer safety-dominant path; unresolved -> governance vote recorded.
  5. Emit merge record with conflict set, chosen resolution, quorum proof.

### Merge Conflict Example

Suppose two ledgers contain conflicting entries for the same logical update:

```text
e1: {hash=H1, ts=100, signer=A, jurisdiction="global", type="semantic"}
e2: {hash=H2, ts=100, signer=B, jurisdiction="global", type="semantic"}
Conflict resolution proceeds as follows:

Verify both entries have valid badge proofs and jurisdiction tags.

Check whether either entry would relax safety constraints; if so, prefer the safer entry or escalate.

If both are purely semantic and safety-equivalent:

Prefer the entry whose signer has higher badge authority, if defined.

If authority equal, choose the entry with lexicographically smaller (hash, signer_id).

Record a CONFLICT_RESOLUTION entry in the ledger with:

the conflicting hashes [H1, H2],

the chosen winner,

quorum signatures and badge context.

This example is canonical and MUST be reproduced in test harnesses.
- Timing and failure handling:
  - Message model: partially synchronous; merge round timeout `T_merge`; retries `retry_merge=2` before escalation.
  - Anti-entropy: periodic pull of missing ranges using Merkle diff; missing safety entries block commits until resolved.
### Anti-Entropy Example

Consider two nodes A and B that last synchronized at height `h_k`.

1. Node A computes a Merkle root `root_A` over entries `[h_k+1, h_m]`.
2. Node B computes `root_B` over the same height range.
3. If `root_A == root_B`, no action needed.
4. If `root_A != root_B`:
   - A and B exchange segment hashes for sub-ranges within `[h_k+1, h_m]`.
   - Identify sub-range(s) where segment hashes differ.
   - For each differing sub-range:
     - Request missing entries from the peer.
     - Verify:
       - hash-chain integrity,
       - badge proofs,
       - jurisdiction tags,
       - quorum signatures for safety/policy entries.
5. Apply reconciled entries locally, then recompute and confirm the new Merkle root.

Missing **safety** entries MUST block local commits until anti-entropy completes; missing **semantic** entries MAY temporarily block promotion but not basic safety checks.
  - Reconfiguration: quorum membership changes require ledger entry signed by authority badge and quorum proof.
  - Safety/liveness: safety preserved by only accepting entries with quorum proof; liveness via retries then governance vote; eventual consistency guaranteed once quorum achieved or governance vote applied.
- Safety invariant during merge: do not apply semantic/policy entries that would relax safety until safety set from quorum is established; merges proceed in safety-first order with causal ordering by hash.
- Causal ordering: ledger/FLC merges respect hash order; semantic/policy updates are applied after all preceding safety entries; conflicting jurisdiction entries resolved via tie-break rules (see Volume 2).
- Quorum timing defaults (`T_merge`, `retry_merge`) and signature format must align to Volume 1 constants; signatures over `(entry_hash, fkf_scope, jurisdiction, ts)` with badge proofs.
- End-to-end latency/backoff (example): merge round target `T_merge=5s`, backoff schedule exponential with cap 20s across `retry_merge=2`; if exceeded, escalate to governance vote; consensus rounds target `T_consensus=2s` with similar capped backoff.

### Governance Override Timing Matrix

Override actions must tighten strictness, shorten TTL, and be ledger-auditable.

| Condition                        | Required Strictness      | TTL              | Notes                                                                |
|----------------------------------|--------------------------|------------------|----------------------------------------------------------------------|
| Critical invariant violation     | `σ = σ_max`              | 60s              | Immediate SAFE_ANALYTIC or QUARANTINE; human/badge review required. |
| Constraint-store / registry hash mismatch | `σ ≥ 0.75`          | 120s             | Node must execute full resync before rejoining governance actions.  |
| CRL stale (`age > T_crl`)        | `σ ≥ 0.60`               | until CRL refresh | Block all governance-critical actions until CRL updated.           |
| Semantic drift `D > τ_warn`      | `σ ← min(σ+0.1, σ_max)`  | 30s              | Increase strictness temporarily; revert when drift clears.          |

Ledger entries for overrides MUST include:

- `(node_id, reason, scope, ttl, strictness_before, strictness_after, ts_start)`
- proof of authority badge and jurisdiction,
- hash of the parameter registry at time of override.

Overrides that exceed their TTL without resolution MUST escalate to governance vote or QUARANTINE.
- Message envelope: `(entry_hash, fkf_scope, jurisdiction, ts, ttl, signer_id, badge_proof)` serialized deterministically; signatures aggregated as canonical multi-sig; applied consistently with Volume 2 consensus encoding.
 - Deployment guidance: set `T_merge` and `T_consensus` per node count and RTT; apply jitter window ±10% to stagger retries; anti-entropy sync every `k` rounds (e.g., every 3 merges) to heal gaps; backoff cap = `4*T_merge` in high-latency federations with governance override logged.
- Deployment tuning table (example):
  - `N<=5`, RTT<=50ms: `T_merge=5s`, jitter ±10%, backoff cap 15s, anti-entropy every 3 merges.
  - `5<N<=15`, RTT<=150ms: `T_merge=7s`, jitter ±15%, backoff cap 21s, anti-entropy every 2 merges.
  - `N>15` or geo-distributed: `T_merge=10s`, jitter ±20%, backoff cap 40s, anti-entropy every merge; governance override if exceeded.
- Clock and skew assumptions: nodes maintain skew <=50ms via trusted time source; merge messages carry `ts, ttl`; receivers drop messages outside `[ts-Δ, ts+ttl]` and log; repeated skew violations trigger governance alert.
- Dynamic tuning: monitor observed RTT; adjust `T_merge` proportionally within policy bounds and ledger the change; if skew persists beyond bound, place node in SAFE_ANALYTIC for merge participation until resynced.

### Adaptive Merge Timing and Resync Hooks
- Compute `T_merge_adapt = clamp( T_merge * (observed_p95_RTT / baseline_RTT), [T_min_merge, T_max_merge] )`.
- Hysteresis threshold Volume 1 default `H_merge = 15%`.
- Resync procedure mirrors Volume 2 consensus resync but adds:
  - FLC pull of missing semantic entries
  - CRL freshness verification (`<= T_crl`)
  - Governance badge audit
- Rejoin logged via ledger with deterministic hash.
- Nodes exceeding skew bounds enter SAFE_ANALYTIC until resynced.

## 3. Ledger Formalism and Privacy
- Hash-chain or Merkle-tree lineage; subtrees per workflow/tenant for efficient proofs.
- Privacy envelopes: redact fields by policy; hashes preserve integrity; badge-conditioned visibility.
- Ledger-critical invariants: immutability, completeness of governance-critical actions, badge context presence, jurisdiction tags, fkf_node tags.
- Continuous auditability: periodic proofs emitted to governance channel; auditors verify inclusion and badge validity.

## 4. Telemetry Model and Taxonomy
- Telemetry packets are time-ordered, signed, and may be transformed into ledger entries.
- Schema taxonomy:
  - `governance`: mode changes, policy updates, badge changes.
  - `validation`: V outcomes, constraint ids, mu vectors.
  - `routing`: projection decisions, destinations, redactions.
  - `error`: exception class, recovery path.
  - `connector`: connector id, policy, badge, fkf_node.
  - `orchestration`: agent graph events, delegation, self-eval.
  - `training`: datasets, configs, metrics, approval badges.
  - `federated`: fkf hops, FCE ids, conflict resolutions.
- Required fields (base): `ts, stage, mu, phi, divergence, decision, hash, mode, strictness, constraint_ids, badges, fkf_node, jurisdiction`.
- Precedent-based inference telemetry: derived decisions include source hashes.
- Telemetry-led control loops: MCP uses aggregates to adjust `\sigma(level)`, penalties, and policies.
- Boundary rules: telemetry redaction at federated boundaries based on FCE and badge visibility.
- Retention/compression (fixed policy):
  - Critical (safety, badge, ledger, consensus): raw retained `T_critical=90d`.
  - Standard validation/orchestration: raw retained `T_std=30d`, then summarized (mu/divergence stats, counts).
  - Token-level or verbose telemetry: sampled at 10% and summarized after `T_std`; summaries retained for audit.
- Exception flows: error/drift/conflict packets prioritized; may trigger mode escalation.
- Telemetry -> ledger promotion:
  - Always promote: safety violations, badge checks, mode changes, connector/federated calls, consensus failures.
  - Promote on threshold: divergence > \tau_div, drift `D > \tau_warn`, latency > SLA. Typical defaults: `\tau_div=0.2`, `\tau_warn=0.35`, SLA = policy-defined per stage.
  - Batching: aggregate validation events per stage into micro-batches with shared header hash; batch window bounded by `T_batch`.
  - Parameter registry check: nodes must verify locally stored constants (`T_batch`, `T_consensus`, `T_merge`, caps, safety margins) against ledgered registry hash before participating; mismatch -> SAFE_ANALYTIC + governance alert.
  - Crypto suite defaults: hashes use SHA-256 (big-endian digest); signatures/multi-sig default Ed25519; P-256 allowed with ledgered override; any change in suite requires governance entry and cross-node hash check.

### Crypto Suite Negotiation and Test Vectors
- Nodes negotiate crypto suite using registry defaults:
  - Primary: `Ed25519 + SHA-256`
  - Optional override: `P-256` (must be ledgered).
- Multi-sig tests include:
  - Signature validity over canonical envelope
  - Sorting of signer ids
  - Deterministic big-endian digest
- Reference vectors stored in `fixtures/crypto/test_vectors.json` with fields: `{msg, sig_ed25519, sig_p256, expected_hash}`.
- Nodes must verify test vectors at startup; failure triggers SAFE_ANALYTIC.

### Cryptographic Test Vectors (Canonical)

All languages MUST validate against the test vectors in:

`fixtures/crypto/test_vectors.json`

Vector fields include:
- SHA-256 canonical digest  
- Ed25519 signature  
- P-256 signature  
- Public keys  
- Expected outcomes  

Nodes MUST reject participation if local crypto does not reproduce these vectors.
- Training SLA alignment: promotion rules honor Volume 5 SLAs (e.g., C1 latency p95 < 500ms, `\sigma >= 0.6`, divergence <= `\tau_{ok}`) before allowing production.
- Enforced per-stage SLA linkage: promotion checks include Volume 5 per-stage SLA table; if any stage exceeds latency/divergence bounds, promotion denied and logged.
- Constants alignment: uses Volume 1 defaults for `\sigma_{min/max}`, `\tau_{ok}`, `\tau_{warn}`, `\tau_{div}`, `T_batch`, `T_consensus`, `T_merge`; deviations require ledgered governance override to avoid drift.
- Quorum signature format: canonical multi-sig over `(entry_hash || fkf_scope || jurisdiction || ts || signer_id)` using sorted keys and deterministic serialization; quorum proof includes signer ids, badges, and aggregate signature.

### Quorum Signature Example

For a ledger entry with hash `H_entry`, scope `"node-a"`, jurisdiction `"global"`, and timestamp `T`, let the signer set be:

```text
signers = ["A","C","D"]  // sorted lexicographically
```

The canonical message to sign is:

```text
canonical_msg = H(entry_hash || fkf_scope || jurisdiction || ts || signer_id)
```

for each signer id in sorted order. The ledger then records:

```json
{
  "type": "QUORUM_SIGNATURE",
  "entry_hash": "H_entry",
  "signers": ["A","C","D"],
  "signature": "multi_sig(A,C,D)",
  "badges": ["ledger.admin","safety"],
  "jurisdiction": "global",
  "fkf_scope": ["node-a"],
  "ts": "2024-01-01T12:00:00Z"
}
```

Any implementation that cannot reproduce this record from the same inputs must be treated as non-conformant.

### Privacy Envelope Example

The canonical privacy envelope is located at:  
`fixtures/privacy/example_envelope.json`

It demonstrates:
- Visible and redacted fields  
- zk-based redaction proof (example)  
- Canonical hashing rules  

This envelope MUST be used in:
- privacy verification  
- cross-language redaction validation  
- audit harness behavior  
- Privacy envelopes:
  - Sensitive fields hashed with salt; payloads redacted; commitments stored.
  - Zero-knowledge or redaction proofs may be attached: `Proof(commitment, policy)` using Merkle inclusion plus range/policy satisfaction proof to show compliance without revealing content.
  - Proof flow: producer commits to redacted fields, attaches ZK/redaction proof of policy compliance; auditor verifies proof + Merkle path + badge signatures; no plaintext required.
- Privacy invariants: fields in policy class `sensitive` must have commitments; class `restricted` must have ZK/redaction proof; proofs must reference ledger hash and badge set.
- Field-to-proof mapping (policy-driven):
  - `sensitive`: hash commitment + Merkle inclusion proof to lineage.
  - `restricted`: commitment + ZK/redaction proof (e.g., Merkle+range/policy satisfaction).
  - `public`: cleartext allowed.
  - Enforcement: CGL badge/policy nodes require presence of proof types per field class; MCP refuses commit if proof missing or invalid; auditors verify deterministic encoding of proofs against ledger hash.
- Privacy enforcement test matrix (implementation guide): include cases for missing proof, wrong proof type for field class, stale badge proof, tampered Merkle path, and invalid signature; all must fail commit and emit ledger error codes (`PRIV_MISSING`, `PRIV_CLASS_MISMATCH`, `PRIV_STALE_BADGE`, `PRIV_TAMPERED_PATH`, `PRIV_BAD_SIG`) with badge context.
- Proof serialization example: Merkle path encoded as array of `(direction, hash)` pairs with canonical JSON, UTF-8, sorted keys; commitments and proofs hashed with SHA-256 big-endian; badge proofs attached as canonical multi-sig over `(entry_hash || fkf_scope || jurisdiction || ts || signer_id)`.
- Sample vector (interop): for a `restricted` field, produce `commit = SHA256(value || salt)`, Merkle path `[{"dir":"L","hash":"..."}, ...]`, badge proof `sig` over `(entry_hash || fkf_scope || jurisdiction || ts || signer_id)`; serialize canonically and validate end-to-end in tests.
- Sample proof payload (illustrative):
```json
{
  "commit": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "merkle_path": [
    {"dir": "L", "hash": "abcd..."},
    {"dir": "R", "hash": "1234..."}
  ],
  "badge_sig": "sig_ed25519_base64",
  "fkf_scope": ["node-a"],
  "jurisdiction": "global",
  "ts": "2024-01-01T00:00:00Z",
  "ttl": 5
}
```

### Reference Fixtures and Proof Sets
- Reference fixtures stored under `fixtures/reference/` include:
  - `merkle_paths.json`
  - `zk_proofs.json`
  - `badge_proofs.json`
  - `continuation.canonical.json`
- Each fixture entry contains `(hash, ts, signer_set, jurisdiction)`.
- Nodes verify fixture hashes against ledger registry on startup.
- Cross-language validation required before enabling connector/federated features.

## 5. Strictness Scaling Functions
- Strictness function `\sigma(level) \in [0,1]` controls penalties, divergence bounds, routing sensitivity:
```math
\sigma(level) = \sigma_{min} + (\sigma_{max} - \sigma_{min}) \cdot s(level), \quad s(level) \in [0,1] \\
\delta_{creative}(level) = \delta_0 \cdot (1 - \sigma(level)) \\
w_i(level) = w_i^{base} (1 + k_i \, \sigma(level))
```
- Control law links telemetry density and violation rates to level adjustments; governed by MCP.

## 6. Governance Runtime Loop
- Inputs: ledger head(s), telemetry aggregates, constraint deltas, risk posture, orchestrator metrics, fkf summaries.
- Outputs: strictness level, penalty updates, constraint updates, mode transitions, orchestration policy adjustments.
- Control step:
```math
penalties_{t+1} = penalties_t + \eta \cdot \sigma(level) \cdot \nabla \Phi \\
mode_{t+1} =
\begin{cases}
\text{SAFE_ANALYTIC}, & ||S_{t+1}-S_t|| > \epsilon \\
\text{QUARANTINE}, & \text{repeated safety or ledger failures} \\
\text{CONTINUATION}, & \text{long-horizon active and stable} \\
\text{NORMAL}, & \text{otherwise}
\end{cases}
```
- All updates committed to ledger/FLC with reason codes, badge context, fkf_node, and hashes.
- Continuation ordering: before resuming, replay ledger/FLC entries up to checkpoint prev_hash, verify CRL freshness `<= T_crl`, re-derive seeds from stored hashes, then re-run V and guard_stability.
- TTL/strictness: checkpoints expire at `ttl`; on resume strictness must be `>=` checkpoint strictness; stale checkpoints require governance override; causal order enforced by replaying to `prev_hash` before any mode transition.

## 7. Event and Schema Definitions (abbrev)
- Ledger entry (SQL-style):
```sql
CREATE TABLE ledger(
  seq INT PRIMARY KEY,
  ts TIMESTAMP,
  stage TEXT,
  actor TEXT,
  badges JSONB,
  payload_hash CHAR(64),
  violations JSONB,
  connector_calls JSONB,
  fkf_node TEXT,
  jurisdiction TEXT,
  prev_hash CHAR(64),
  hash CHAR(64),
  mode TEXT,
  strictness NUMERIC
);
```
- Telemetry envelope (JSON):
```json
{
  "ts": "...",
  "stage": "V",
  "mu": 0.0,
  "phi": 0.0,
  "divergence": 0.05,
  "decision": "allow",
  "violations": [],
  "hash": "...",
  "mode": "NORMAL",
  "strictness": 0.6,
  "badges": ["validator.run"],
  "connector_calls": [],
  "fkf_node": "node-a",
  "jurisdiction": "global"
}
```

## 8. Output Routing and Enforcement
- Routing `R(y', \rho)` signs decisions with ledger head and badge context; downstream verifies signatures and badge tags.
- Projection `Proj_{C_out}(y)` applies redaction and formatting constraints before routing.
- Validator `V_out` uses CGL (including FCE) to confirm admissibility post-projection.
- Failures recorded with reason codes (`ROUTING_QUARANTINE`, `BADGE_FAIL`, `FCE_FAIL`).

## 9. Error Bounding and Correction
- Recovery bounds: `T_recov` limits retries; exceeding triggers QUARANTINE.
- Correction steps: re-evaluate constraints with updated penalties; replay with stored seeds; tighten strictness; require badge-authorized approval for governance-critical corrections.
- MCP escalates to human review on repeated safety, badge, or ledger failures; escalation logged.

## 10. Federated, Jurisdictional, and Connector Considerations
- Ledger entries include `jurisdiction_tag` and `fkf_node`; routing enforces tag compatibility.
- Federated Knowledge Node accesses logged with node id, policy, badge context; connector channel captures external graph interactions.
- Cross-node ledger synchronization uses signed lineage proofs; conflicts require reconciliation with safety dominance and badge quorum.
- Telemetry redaction rules prevent leakage across jurisdictions/tenants; visibility conditioned by badge and policy.

## 11. Badge and Role Auditability
- Every governance-critical action (builder publish/activate, validator override, orchestration policy change, connector invocation, training approval) is logged with badge sets and validity windows.
- Ledger-backed identity snapshots: `(principal, badge_set, validity, jurisdiction, fkf_scope, hash)` recorded to bind identity context to actions.
- Constraint nodes requiring badges leave audit trails linking decisions to badge evidence.
- CRL freshness invariant: CRL age must be `<= T_crl` (policy-defined); stale CRL triggers SAFE_ANALYTIC for governance actions until refreshed.
- Minimal safe badge set for core ops: {`builder.author`, `builder.activate`, `validator.run`, `orchestrator.execute`, `ledger.admin`}; absence blocks respective operations (referenced by Volumes 1.1/3/4).
- Delegatable vs non-delegatable: `builder.author`, `validator.run`, `orchestrator.execute` non-delegatable; `builder.activate`, `training.approve`, `graph.access` delegatable with `badge.delegate` (referenced by Volumes 1.1/3/4).

## 12. Training and Learning Observability
- Training runs (sandbox, shadow, staged rollout) log datasets, prompts/models, badge approvals, evaluation metrics, fkf_scope.
- Learning updates to constraints, templates, or orchestration policies are committed with before/after hashes and badge context; negative outcomes trigger rollback entries.
- Shadow-mode evaluation logs comparative metrics; acceptance requires badge approval and ledger entry.
- Multi-node training consistency: quorum signatures required for federated safety constraints; recorded in FLC.
- Promotion to production: requires `training.approve` badge quorum, validator check on evaluation metrics vs thresholds, and ledger entry with hashes of artifacts and datasets.

## 13. Ledger-Triggered MCP Control Events
- Ledger entries can trigger MCP policy adjustments (e.g., strictness raise on repeated safety violations, connector suspension on repeated denies).
- Control triggers are encoded as policy nodes with badge gates; execution is logged.

## 14. Guarantees
- Immutability via hash chaining/Merkle proofs.
- Auditability: every decision, mode change, badge check, connector access, federated hop, continuation event, and governance update is ledgered.
- Deterministic replay: seeds, config hashes, fkf_scope recorded enable reconstruction.
- Safety dominance: no output routed without successful safety/federated validation, badge verification, and ledger commit.

## 15. Cross-Volume Integration
- Volume 1/1.1: consumes strictness and governance rules; badge model mirrored here; continuation states anchored in ledger.
- Volume 2: uses ledgered constraint versions and deltas, including badge, connector, and federated nodes.
- Volume 3: Builder records plan/template hashes, badge context, tenant, fkf_scope, and activation decisions.
- Volume 4: MCP and orchestrator write mode transitions, badge checks, connector/federated usage, routing decisions, and continuation events.
- Volume 5: GIL, rendered outputs, feedback, training updates, and coherence checks are hashed and stored for lineage.




