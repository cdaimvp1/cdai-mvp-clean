# cd/ai Volume 3 - Builder Layer v2 and Runtime Assembly Model

## Scope
Volume 3 defines Builder Layer v2, the declarative system that materializes the canonical governed cycle into runnable, federated pipelines. It ingests declarative specifications, binds them to the Constraint Graph Layer (CGL), assembles orchestration graphs, UI bindings, and MCP configurations, and packages artifacts with governance, badge checks, multi-tenant separation, and safe injection paths. It maintains deterministic vs nondeterministic boundaries and integrates with ledger, orchestration, cognitive, and federated fabrics.

**Constants:** Builder v2 uses the global constants in `registry/constants.md` (Volume 1). All timing, drift, and cap values referenced in this volume are read from the registry.

## 1. Builder v2 Responsibilities
- Parse declarative specs and produce canonical plans aligned with the Volume 1 cycle.
- Instantiate and version CGL graphs (Volume 2) per plan, including badge/policy, connector, and federated envelopes.
- Generate execution DAGs for A1->M1->C1->M2->V->Ledger->G1->Route and orchestrator task graphs.
- Produce test fixtures, probes, telemetry contracts, and UI bindings.
- Package artifacts (models, prompts, constraints, orchestration policies, routing rules) with lineage and badge gating.
- Support multi-tenant isolation (separate namespaces, templates, and badge scopes).
- Support meta-builder flows (builders that emit new builder templates under governance).

## 2. Declarative Build Specifications (DSL)
- JSON Schema (abbrev):
```json
{
  "type": "object",
  "required": ["workflow", "constraints", "badges_required", "runtime_topology"],
  "properties": {
    "workflow": {"type": "string"},
    "constraints": {"type": "array", "items": {"type": "string"}},
    "invariants": {"type": "array", "items": {"type": "string"}},
    "policies": {"type": "array", "items": {"type": "string"}},
    "agents": {"type": "array", "items": {"type": "object"}},
    "tools": {"type": "array", "items": {"type": "object"}},
    "connectors": {"type": "array", "items": {"type": "object"}},
    "panels": {"type": "array", "items": {"type": "object"}},
    "badges_required": {"type": "array", "items": {"type": "string"}},
    "runtime_topology": {"type": "object"},
    "fkf_scope": {"type": "array", "items": {"type": "string"}},
    "jurisdiction": {"type": "string"},
    "tenant": {"type": "string"},
    "seeds": {"type": "object"}
  },
  "additionalProperties": false
}
```
- BNF fragment (non-exhaustive):
```
spec ::= workflow constraints badges_required runtime_topology [fkf_scope] [jurisdiction] [tenant] [agents] [tools] [connectors] [panels] [policies] [invariants] [seeds]
workflow ::= string
constraints ::= "[" constraint_id {"," constraint_id} "]"
badges_required ::= "[" badge_id {"," badge_id} "]"
runtime_topology ::= object
agents ::= "[" agent_obj {"," agent_obj} "]"
agent_obj ::= "{ id: string, capabilities: array<string>, badges: array<string>, deterministic: bool }"
tools ::= "[" "{ id: string, type: string, config: object, badges: array<string> }" {"," ...} "]"
connectors ::= "[" "{ id: string, policy: string, badges: array<string>, fkf_scope: array<string> }" {"," ...} "]"
panels ::= "[" "{ id: string, bindings: array<string> }" {"," ...} "]"
policies ::= "[" string {"," string} "]"
invariants ::= "[" string {"," string} "]"
seeds ::= "{ stage: seed }"
meta_constraint ::= "RequireBadge(" action "," badge_set ")" | "AllowForm(" op ")" | "ForbidRemoval(" type ")" | "MaxRecursion(" depth ")" | "DisallowTemplateCycle"
```
- Blueprint-level DSL is deterministic; all invariants must be closed under `Cl(C)`; tenant and fkf_scope are mandatory for federated builds; meta-constraints from Volume 2 apply; badge requirements must respect the minimal safe set and delegatable classes in Volume 6.
- Example (abbrev):
```json
{
  "workflow": "governed-cycle",
  "constraints": ["safety.pi", "semantic.coherence"],
  "badges_required": ["builder.author", "validator.run"],
  "connectors": [{"id": "graph.default", "policy": "read-safe"}],
  "panels": [{"id": "review", "bindings": ["telemetry", "violations"]}],
  "fkf_scope": ["node-a"]
}
```
- Governance rules: required badge sets declared; missing coverage fails validation.

### Example: Minimal Governed Build Specification

A canonical example build is provided in  
`fixtures/builder/example_build.json`.

Key features demonstrated:
- fkf_scope and jurisdiction tagging  
- topological constraints  
- strictness applied from registry  
- hash computed using canonical SHA-256 rules  

This example serves as the reference for test harnesses and cross-language validators.

## 3. Template & Blueprint Library
- Reusable templates for governed workflow patterns (analytic-only, full cycle with orchestration, shadow-mode, continuation-enabled).
- Parameterized by constraints, policies, badge requirements, runtime topology, fkf_scope.
- Versioning: immutable template hash recorded in the ledger/FLC; instantiation references template hash plus parameters.
- Library access is badge-gated (`builder.template.use`, `builder.template.publish`); meta-builder can emit new templates but requires `builder.meta` badge plus validator approval.

## 4. Build-Time Validation
- Closure: apply `Cl(C)`; fail if non-terminating or unsatisfied implications.
- Invariant validation: safety node presence, badge coverage, connector policy coverage, jurisdiction tagging.
- Conflict detection: derive conflict graph; block unsatisfiable sets or require governance override.
- Multi-tenant checks: ensure namespace isolation; disallow cross-tenant constraint leakage.
- Federated readiness: verify FCE references and fkf_scope compatibility.
- Validation ordering (multi-tenant): namespace isolation -> schema validation -> badge coverage -> closure -> conflict detection -> federated gates -> fixtures sanity.

### Example: Federated Build (Cross-Jurisdiction)

The file `fixtures/builder/federated_build.json` provides a canonical federated build including:
- Multiple jurisdictions  
- Badge chains  
- Federated semantic edges  
- Cluster signature  
- Deterministic hash  

All federated build validation tests MUST use this fixture.

### Namespace Collision Handling
- Namespace isolation rules:
  - Constraint ids are namespaced: `tenant::local_id`.
  - Cross-tenant references prohibited unless declared `federated_ref` with badge proof and fkf_scope; otherwise build fails.
  - Closure computed per tenant namespace, then federated constraints applied with gateway checks.
  - Duplicate `tenant::local_id` within the same plan/tenant is a hard error; builds must fail on collision.
  - Validation error code for namespace collision: `ERR_NAMESPACE_COLLISION`; build aborts and logs to ledger with badge context.
  - Meta-constraints enforced: DSL must satisfy meta_constraint grammar (Volume 2); violations yield `ERR_META_CONSTRAINT` and require governance override with `builder.meta` + `validator.run`.

## 5. Build Pipeline & Artifact Generation
- Compilation steps:
  1. Validate DSL schema, tenant scope, and badge requirements.
  2. Expand template parameters; bind to constraints and FCE.
  3. Generate CGL (`G_plan`) with closure and versioning; generate orchestration task graph and agent DAG.
  4. Generate stage configs (models, prompts, penalties, seeds, strictness schedules) and UI bindings.
  5. Generate MCP configs (guards, retries, strictness modulation, continuation checkpoints).
  6. Generate telemetry contracts and routing envelopes with badge-conditioned visibility.
  7. Package artifacts; compute hashes; prepare ledger/FLC entries.
- Outputs: `{plan_dag, orchestration_graph, G_plan, fixtures, routing_config, telemetry_contract, ui_bindings, fkf_scope}`.

## 6. Artifact Lifecycle
- States: `draft -> validated -> staging -> activated -> retired`.
- Transitions require badges:
  - Draft -> validated: `builder.author` + `validator.run`.
  - Validated -> staging: `builder.author` + `builder.activate`.
  - Staging -> activated: `builder.activate` + `validator.run` (fixtures pass) + optional `output.review`.
  - Activated -> retired/rollback: `builder.activate` + `orchestrator.policy` or `ledger.admin`.
- Ledger/FLC records each transition with hashes, badge sets, fkf_scope, and jurisdiction.

## 7. Safe Injection into Runtime
- Staging: runs with shadow telemetry; outputs quarantined unless explicitly promoted.
- Production activation: requires validator pass on fixtures, badge approvals, and ledger entry; MCP loads new plan atomically.
- Rollback: prior plan hashes retained; MCP can revert on failure; ledger records rollback cause and badge context.
- Multi-tenant isolation: activation scoped to tenant namespace; orchestrator enforces isolation via badge and constraint gates.

## 8. Plan Model
```math
P = (N, E, \lambda, fkf) \\
N = \{A1, M1, C1, M2, V, LEDGER, G1, ROUTE\} \\
E = \text{canonical forward edges} \cup \text{guarded back-edges} \\
\lambda(n) = \text{stage configuration (model, prompt, penalties, strictness, badges, fkf_scope)}
```
- Deterministic nodes must have replayable configs; badge requirements attached.
- C1 includes sampling policy and seed strategy (can derive from ledger/FLC head for replay).
- Seed derivation: `seed_stage = H(h_{plan} \| stage \| seq)`; overrides allowed only with validator and badge approval; stored in ledger.
- Seed uniqueness: seeds are deterministic per `(plan_hash, stage, seq)`; collisions across tenants prevented by namespace prefix `tenant::plan_hash`.

## 9. CGL Binding
- Builder binds constraints to artifacts, generating `G_plan` scoped to the plan and fkf_scope.
- Each node references relevant constraint subsets; safety nodes attached to all stages; badge/connector/federated constraints attached where required.
- Binding output: `G_plan`, `constraint_map: stage -> constraint_ids`, `badge_map: action -> badge_set`, `fce_map: fkf_scope -> FCE_ids`.

## 10. Fixtures, Probes, and UI Bindings
- Fixtures provide deterministic inputs for regression (A1 seeds, prompts, routes).
- Probes measure divergence, latency, violation metrics, badge failures, connector calls, federated hops.
- UI bindings for oversight dashboards (telemetry, violations, badge decisions, connector/federated usage).
- Example probe spec:
```json
{
  "stage": "C1",
  "metric": "divergence",
  "threshold": 0.15,
  "strictness_link": "sigma(level)",
  "fkf_scope": ["node-a"]
}
```

## 11. Execution DAG and Orchestration Graph
- Builder emits DAG manifest consumed by MCP scheduler and meta-agent orchestrator (Volume 4).
- Orchestration graph extends DAG with task agents, tool calls, connector invocations, federated gates, and policy/badge guards.
- DAG includes guard expressions (`guard_V`, `guard_div`, `guard_stability`, `guard_badge`, `guard_federated`) and rollback edges.
- Deterministic ordering enforced; parallelism allowed when constraints and badge checks permit.

## 12. Packaging, Identity, and Lineage
- Packaging format includes:
  - `G_plan` snapshot with ids, versions, weights, badge/federated requirements.
  - Stage configs (models, prompts, penalties, seeds, strictness schedule).
  - Orchestration policies and routing rules.
  - Telemetry contract and UI bindings.
  - Tenant namespace and fkf_scope.
- Hashes:
```math
h_{plan} = H(plan_dag \| orchestration \| G_{plan} \| configs \| routing \| ui \| fkf)
```
- Ledger/FLC entry records `h_plan`, build time, jurisdiction, fkf_scope, badge set used to publish, and author.
- Namespace isolation: `constraint_id = tenant::local_id`; Builder rejects references crossing tenants unless explicit federated constraint with badge proof.

## 13. Governance, Policy, and Badge Injection
- Policy and badge tags embedded into constraints, orchestration nodes, routing rules, and builder actions.
- Governance-critical actions are badge-gated and logged; builder operations require declared badge sets.
- Connector usage and federated access require explicit policy and badge coverage; enforced by CGL nodes and orchestrator guards.
- Multi-tenant permissions enforced via namespace-specific badge sets and constraint gates.
- Badge checks require fresh CRL (age <= T_crl); stale CRL blocks activation until refreshed.
 - Minimal safe badge set and delegatable classes live in Volume 6; builder validation cross-checks required badges against that set and refuses plans that weaken non-delegatable requirements.

## 14. Meta-Builder Capabilities
- Meta-builder can emit new templates or DSL extensions; requires `builder.meta` + `validator.run` + `ledger.admin` for activation.
- Meta-constraints govern allowable template shapes; encoded in CGL meta-nodes.
- All meta-builder outputs must pass the same lifecycle (draft -> validated -> staging -> activated) with heightened badge requirements.
- Meta-builder guardrails: disallow new safety constraints removal; disallow disabling badge gates; enforce namespace isolation inheritance.
- Meta-builder invariants:
  - Must preserve safety nodes and badge gates across derived templates.
  - Must emit updated DSL schema hashes; mismatches fail activation.
  - Must write lineage of source templates and transformations to ledger/FLC.
  - Recursion depth for meta-build is capped (e.g., 2 levels); deeper chains require governance override with `builder.meta` + `ledger.admin`.

### Example: Namespace Collision Resolution

See `fixtures/builder/namespace_collision.json` for a full example.

The example demonstrates:
- Incoming constraint attempts to overwrite existing symbol  
- Collision resolution strategy (rename-incoming)  
- Deterministic conflict recording  
- Registry-consistent hashing  

This example MUST be used by all language implementations.

## 15. Testing and Verification
- Static checks: DAG validity, closure termination, constraint coverage, badge coverage, schema validation, connector permissions, fkf_scope consistency, conflict graph sanity.
- Dynamic checks: run fixtures, verify `V=1`, compare `\Phi` against baselines, ensure telemetry emission, ensure badge and federated guards trigger as expected.
- Regression guardrails: baseline `\Phi`, divergence, badge-failure rates, and federated failure rates stored; MCP rejects deployments exceeding budgets.

## 16. Failure Modes in Build Time
- Missing constraints or safety nodes -> build fail.
- Non-deterministic config in deterministic nodes -> build fail.
- Missing badge coverage for governance actions -> build fail.
- Hash mismatch on packaged artifacts -> build fail and ledger note.
- Connector or federated policy mismatch -> build fail.
- Conflict graph contains unsatisfied hard constraints -> build fail unless governance override recorded.

## 17. Builder -> MCP Transformation Pipeline
- Builder emits plan + orchestration manifest + `G_plan`.
- MCP loads configs, seeds, strictness schedule, guards, fkf_scope, and routing policies; verifies hashes against ledger/FLC.
- Continuation parameters (checkpoints, ttl, temporal constraints) are passed to MCP for long-horizon execution.
- Any mismatch halts activation and logs a ledger error.

## 18. Multi-Tenant Separation
- Tenant namespaces isolate templates, constraints, badges, telemetry visibility, and routing policies.
- Cross-tenant calls require explicit federated constraints plus badge sets from both tenants; default deny.
- Ledger/FLC entries include tenant id; audits enforce isolation.

## 19. Interface to Other Volumes
- Volume 2: constraint algebra, closure, inheritance, federated envelopes, conflict graphs.
- Volume 4: MCP/meta-orchestrator consumes plan DAG, orchestration graph, guards, badge/federated requirements, continuation parameters.
- Volume 5: cognitive/narrative assets (prompts, GIL templates) and training hooks packaged by Builder.
- Volume 6: ledger schema and telemetry contracts emitted during packaging; badge and activation events recorded across tenants and federated scopes.



