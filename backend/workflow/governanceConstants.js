// Centralized governance constants to avoid circular exports across MCP modules.

const REQUEST_TYPES = {
  CONVERSATIONAL: "conversational",
  GOVERNED: "governed_request",
  UNGOVERNED: "ungoverned_request",
  CLARIFICATION_RESPONSE: "clarification_response",
  UNKNOWN: "unknown_request",
};

const GOVERNANCE_DECISIONS = {
  ALLOW: "allow",
  REQUIRE_RULES: "require_rules",
  BLOCK: "block",
  ASK_CLARIFICATION: "ask_clarification",
  SIMULATE_DESIGN_ONLY: "simulate_design_only",
};

const DATA_SCOPE_MODES = {
  WORK: "work",
  WEB: "web",
};

const DEFAULT_DATA_SCOPE_MODE = DATA_SCOPE_MODES.WORK;

const GOVERNANCE_MODES = {
  STRICT: "strict",
  SIMULATION: "simulation",
  PHI_COMPLIANT: "phi_compliant",
};

module.exports = {
  REQUEST_TYPES,
  GOVERNANCE_DECISIONS,
  DATA_SCOPE_MODES,
  DEFAULT_DATA_SCOPE_MODE,
  GOVERNANCE_MODES,
};
