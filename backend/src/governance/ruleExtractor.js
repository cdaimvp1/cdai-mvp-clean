const { extractExplicitRulesViaAPI } = require("../../workflow/openaiClient");

function normalizeExplicitRuleObject(r) {
  if (!r || typeof r !== "object") {
    return {
      text: "",
      type: "requirement",
      origin: "user",
      status: "pending",
    };
  }

  if (r.type === "required_section_order") {
    return {
      text: `Include sections in order: ${(r.sections || []).join(" > ")}`,
      type: r.type,
      sections: r.sections || [],
      origin: "user",
      status: "pending",
    };
  }
  if (r.type === "forbidden_section") {
    return {
      text: `Do not generate section: ${r.name}`,
      type: r.type,
      name: r.name,
      origin: "user",
      status: "pending",
    };
  }
  if (r.type === "forbidden_feature") {
    return {
      text: `Forbid feature: ${r.name}`,
      type: r.type,
      name: r.name,
      origin: "user",
      status: "pending",
    };
  }
  return {
    text: r.rule || r.text || "",
    type: r.type || "requirement",
    origin: "user",
    status: "pending",
  };
}

async function extractExplicitRules(rawSubmissionText, strictnessLevel) {
  const explicitExtraction =
    (await extractExplicitRulesViaAPI(rawSubmissionText, { strictness: strictnessLevel })) || {
      explicit_rules: [],
      parse_error: false,
    };

  const explicitRulesFromAPI = (explicitExtraction.explicit_rules || []).map((r) =>
    normalizeExplicitRuleObject(r)
  );

  return {
    explicitRulesFromAPI,
    rawExtraction: explicitExtraction,
  };
}

module.exports = {
  extractExplicitRules,
  normalizeExplicitRuleObject,
};
