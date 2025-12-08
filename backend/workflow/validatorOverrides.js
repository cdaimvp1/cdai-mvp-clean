const overrideLedger = [];

function hasOverrideAuthority(overrideRequest = {}) {
  if (!overrideRequest) return false;
  if (overrideRequest.authorized === true) return true;
  const badges = Array.isArray(overrideRequest.badges) ? overrideRequest.badges : [];
  return badges.includes("validator.override") || badges.includes("validator.run");
}

function normalizeSignature(overrideRequest = {}, context = {}) {
  const timestamp = new Date().toISOString();
  return {
    userId: overrideRequest.userId || "unknown-user",
    userName: overrideRequest.userName || "unknown",
    badgeSet: Array.isArray(overrideRequest.badges) ? overrideRequest.badges : [],
    justification: overrideRequest.justification || "No justification provided.",
    timestamp,
    sessionId: context.sessionId || null,
    requestId: context.requestId || null,
  };
}

function registerOverrideRecord(record = {}) {
  const entry = {
    id: `override-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...record,
  };
  overrideLedger.push(entry);
  return entry;
}

function listOverrideRecords() {
  return overrideLedger.slice();
}

function collectIssueIds(result = {}) {
  const collect = [];
  ["absoluteIssues", "contextualIssues", "softIssues"].forEach((key) => {
    (result[key] || []).forEach((issue) => {
      if (issue?.id) collect.push(issue.id);
    });
  });
  return collect;
}

function applyOverridesToIssues(result = {}, overrideRequest = null, context = {}) {
  if (!overrideRequest) {
    return { applied: [], records: [], denied: false };
  }
  if (!hasOverrideAuthority(overrideRequest)) {
    return { applied: [], records: [], denied: true, reason: "unauthorized" };
  }

  const availableIssueIds = collectIssueIds(result);
  if (!availableIssueIds.length) {
    return { applied: [], records: [], denied: false };
  }

  const targetIds = new Set(
    Array.isArray(overrideRequest.issueIds) && overrideRequest.issueIds.length
      ? overrideRequest.issueIds
      : availableIssueIds
  );
  const signature = normalizeSignature(overrideRequest, context);
  const appliedIssues = [];

  ["absoluteIssues", "contextualIssues", "softIssues"].forEach((key) => {
    (result[key] || []).forEach((issue) => {
      if (!issue || !issue.id || issue.override) return;
      if (!targetIds.has(issue.id)) return;
      issue.override = { ...signature };
      appliedIssues.push({
        issueId: issue.id,
        ruleId: issue.ruleId || null,
        category: issue.category || key.replace("Issues", "").toLowerCase(),
      });
    });
  });

  if (!appliedIssues.length) {
    return { applied: [], records: [], denied: false };
  }

  const record = registerOverrideRecord({
    ...signature,
    issues: appliedIssues,
  });

  return { applied: appliedIssues, records: [record], denied: false };
}

module.exports = {
  applyOverridesToIssues,
  listOverrideRecords,
  registerOverrideRecord,
  hasOverrideAuthority,
};
