const runtimeConfig = {
  mode: "work",
};

function normalizeMode(mode) {
  const value = (mode || "").toString().toLowerCase();
  return value === "web" ? "web" : "work";
}

function setRuntimeMode(mode) {
  runtimeConfig.mode = normalizeMode(mode);
  return runtimeConfig.mode;
}

function getModeCapabilities(mode = runtimeConfig.mode) {
  const normalized = normalizeMode(mode);
  if (normalized === "web") {
    return {
      mode: "web",
      allowedSources: ["internal", "public:web"],
      allowWeb: true,
      provenanceMode: "mixed",
    };
  }
  return {
    mode: "work",
    allowedSources: ["internal"],
    allowWeb: false,
    provenanceMode: "internal-only",
  };
}

function deriveRequestSignals(text = "") {
  const normalized = (text || "").toLowerCase();
  let intent = "general";
  if (/\bemail|inbox|outbox|reply\b/.test(normalized)) {
    intent = "email";
  } else if (/\brewrite|re-write|revise|reword\b/.test(normalized)) {
    intent = "rewrite";
  } else if (/\bsummariz|summary|synopsis\b/.test(normalized)) {
    intent = "summarization";
  }

  let domain = "general-knowledge";
  if (/\blegal|attorney|contract|regulat|compliance\b/.test(normalized)) {
    domain = "legal";
  } else if (/\bpolicy|governance|procedure|handbook\b/.test(normalized)) {
    domain = "policy";
  }

  let sensitivity = "normal";
  if (/\bconfidential|secret|phi|pii|sensitive|nda|restricted\b/.test(normalized)) {
    sensitivity = "high";
  }

  return { intent, domain, sensitivity };
}

function computeDynamicStrictness({ intent, domain, sensitivity, dataSources = [] } = {}) {
  const normalizedIntent = (intent || "").toLowerCase();
  if (normalizedIntent === "email" || normalizedIntent === "rewrite" || normalizedIntent === "summarization") {
    return "low";
  }

  const normalizedDomain = (domain || "").toLowerCase();
  if (dataSources.includes("public:web") || normalizedDomain === "general-knowledge") {
    return "medium";
  }

  if (normalizedDomain === "legal" || normalizedDomain === "policy" || (sensitivity || "").toLowerCase() === "high") {
    return "high";
  }

  return "medium";
}

function strictnessLabelToValue(label) {
  switch ((label || "").toLowerCase()) {
    case "low":
      return 0.35;
    case "high":
      return 0.95;
    default:
      return 0.65;
  }
}

module.exports = {
  runtimeConfig,
  setRuntimeMode,
  getModeCapabilities,
  computeDynamicStrictness,
  deriveRequestSignals,
  strictnessLabelToValue,
};
