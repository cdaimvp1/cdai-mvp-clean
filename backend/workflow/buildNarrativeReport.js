function buildNarrativeReport({
  input,
  goal,
  mode,
  converged,
  validation,
  plannedCycles,
  cyclesRun,
  stubbornViolations,
  clarifications,
  rules,
  hitRunaway,
}) {
  const compliant = !!validation?.isCompliant;
  const violationsCount = Array.isArray(stubbornViolations)
    ? stubbornViolations.length
    : 0;
  const requestedClarifications = (clarifications || []).filter(
    (c) => c.status === "requested"
  ).length;
  const answeredClarifications = (clarifications || []).filter(
    (c) => c.status === "answered"
  ).length;
  const timeouts = (clarifications || []).filter(
    (c) => c.status === "timeout"
  ).length;
  const inferredCount = (rules || []).filter((r) => r.origin === "system").length;
  const clarifiedCount = (rules || []).filter(
    (r) => r.origin === "user-clarified" || r.status === "clarified"
  ).length;
  const failedRules = (rules || []).filter((r) => r.status === "failed");

  const outcomePhrase = converged
    ? "Convergence achieved."
    : hitRunaway
    ? "Run halted by fail-safe protections before convergence."
    : "Output locked without convergence after reaching the configured cap.";

  const governancePhrase = compliant
    ? "Governance checks passed."
    : violationsCount > 0 || failedRules.length > 0
    ? "Governance issues remain; review flagged rules and conflicts."
    : "Governance alignment uncertain; review before acting.";

  const warningsPhrase =
    violationsCount > 0
      ? `Detected ${violationsCount} unresolved governance conflict(s).`
      : "";

  const summarySentences = [
    `Governed run executed in ${String(mode || "real").toUpperCase()} mode over ${cyclesRun || 0} of ${plannedCycles} planned cycle(s).`,
    outcomePhrase,
    governancePhrase,
    warningsPhrase,
  ]
    .filter(Boolean)
    .slice(0, 4);

  const summaryText = summarySentences.join(" ");

  const outcomeSummary = `Completed governed pass with final output delivered; ${converged ? "stopped after convergence" : "stopped at a safety limit"}.`;
  const governanceAlignment = compliant
    ? "Validator marked draft as compliant with provided governance rules."
    : "Validator signaled outstanding governance risks; consult rule failures/conflicts before execution.";
  const cycleBehavior = `Planned cycles: ${plannedCycles}. Executed cycles: ${cyclesRun}. ${hitRunaway ? "Fail-safe triggered (runaway/limit reached)." : converged ? "Converged within planned window." : "Stopped at cap without convergence."}`;
  const clarificationSummary =
    requestedClarifications + answeredClarifications + timeouts > 0
      ? `Requested ${requestedClarifications}, answered ${answeredClarifications}, timeouts ${timeouts}.`
      : "No clarifications were requested.";
  const inferredSummary =
    inferredCount > 0
      ? `${inferredCount} system-inferred constraint(s) enforced; ${clarifiedCount} user-clarified rule(s).`
      : `${clarifiedCount} user-clarified rule(s); no additional inferred constraints applied.`;
  const confidenceSummary = compliant && converged
    ? "High confidence based on validator compliance and stable stop condition."
    : "Moderate confidence; treat output as provisional until governance issues are cleared.";
  const ruleFailureSummary =
    failedRules.length > 0
      ? failedRules
          .map((r) => (r.text || "").trim().slice(0, 120))
          .filter(Boolean)
          .slice(0, 3)
          .join(" | ")
      : "None recorded.";
  const runawayNotes = hitRunaway
    ? "Execution stopped by fail-safe guardrails before convergence."
    : "None triggered.";
  const recommendations = compliant
    ? "Proceed with the governed output; retain evidence of rules applied and clarifications."
    : "Review flagged rules/conflicts, address clarifications, and rerun for governance alignment.";

  const summarySection = [
    "NARRATIVE SUMMARY",
    `- ${summaryText}`,
  ];

  const detailSection = [
    "DIAGNOSTIC DETAILS",
    `- Outcome Summary: ${outcomeSummary}`,
    `- Governance Alignment: ${governanceAlignment}`,
    `- Cycle Behavior: ${cycleBehavior}`,
    `- Clarifications: ${clarificationSummary}`,
    `- Inferred Constraints: ${inferredSummary}`,
    `- Confidence & Tradeoffs: ${confidenceSummary}`,
    `- Rule Failures: ${ruleFailureSummary}`,
    `- Runaway / Fail-Safe Notes: ${runawayNotes}`,
    `- Recommendations: ${recommendations}`,
  ];

  return [...summarySection, "", ...detailSection].join("\n");
}

module.exports = {
  buildNarrativeReport,
};
