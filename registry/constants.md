# Global Constants Registry (cd/ai)

This registry defines all constants referenced across Volumes 1–6.  
All implementation layers MUST import these values instead of defining
internal constants.

## 1. Stability, Lipschitz, and Envelope Parameters
| Name | Description | Default | Allowed Range |
|------|-------------|---------|----------------|
| σ_min | Minimum strictness | 0.25 | [0.0–1.0] |
| σ_max | Maximum strictness | 1.0 | [0.0–1.0] |
| ε_base | Base envelope radius | 0.10 | (0–1] |
| m_safety | Envelope safety multiplier | 2.0 | ≥1 |
| δ_creative | Creative hemisphere expansion factor | 0.15 | [0–1] |

## 2. Semantic Drift Thresholds
| Name | Description | Default |
|------|-------------|---------|
| τ_ok | Drift accepted as normal | 0.20 |
| τ_warn | Drift that triggers WARN | 0.35 |
| τ_div | Drift requiring QUARANTINE / fail-closed | 0.60 |

## 3. Consensus & Merge Timing
| Name | Description | Default |
|------|-------------|---------|
| T_consensus | Baseline consensus round time (s) | 2.0 |
| T_merge | Baseline merge cycle time (s) | 5.0 |
| H_consensus | Hysteresis threshold for consensus timing | 0.10 |
| H_merge | Hysteresis threshold for merge timing | 0.10 |

## 4. Retry & Backoff
| Name | Description | Default |
|------|-------------|---------|
| retry_consensus | Max consensus retries | 2 |
| retry_merge | Max merge retries | 2 |
| backoff_cap_factor | Cap factor relative to T_consensus/T_merge | 3.0 |

## 5. Graph Caps & Semantic Pruning
| Name | Description | Default |
|------|-------------|---------|
| cap_nodes | Max validator nodes | 200 |
| cap_edges | Max validator edges | 400 |
| T_sem | Semantic pruning threshold multiplier | 0.10 |

## 6. Governance, CRL, and SLA Requirements
| Name | Description | Default |
|------|-------------|---------|
| T_crl | Max CRL age (seconds) | 3600 |
| Conf_min | Minimum confidence for training promotion | 0.80 |

## 7. Clock & Drift Policy
| Name | Description | Default |
|------|-------------|---------|
| skew_bound | Max allowed clock skew in ms | 50 |
