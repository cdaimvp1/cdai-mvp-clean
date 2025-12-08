import { detectPanelIntent, shouldConfirmPanelInvocation } from "../src/panels/panelIntent";

interface TestCase {
  name: string;
  run: () => void;
}

const tests: TestCase[] = [
  {
    name: "open governance panel -> governance without confirmation",
    run: () => {
      const result = detectPanelIntent("open governance panel");
      if (result.panelId !== "governance") {
        throw new Error(`Expected governance, received ${result.panelId}`);
      }
      if (shouldConfirmPanelInvocation(result)) {
        throw new Error("Direct governance request should not require confirmation.");
      }
    },
  },
  {
    name: "can I see the ledger? -> ledger match",
    run: () => {
      const result = detectPanelIntent("can I see the ledger?");
      if (result.panelId !== "ledger") {
        throw new Error(`Expected ledger, received ${result.panelId}`);
      }
    },
  },
  {
    name: "show me that -> ambiguous",
    run: () => {
      const result = detectPanelIntent("show me that");
      if (result.status !== "ambiguous") {
        throw new Error(`Expected ambiguous status, received ${result.status}`);
      }
    },
  },
  {
    name: "open logs panel -> governance panel",
    run: () => {
      const result = detectPanelIntent("open logs panel");
      if (result.panelId !== "governance") {
        throw new Error(`Expected governance for logs panel, received ${result.panelId}`);
      }
    },
  },
  {
    name: "single-word 'logs' should not trigger",
    run: () => {
      const result = detectPanelIntent("logs");
      if (result.status !== "none") {
        throw new Error(`Expected no intent, received ${result.status}`);
      }
    },
  },
  {
    name: "show me the panel that displays errors -> governance panel",
    run: () => {
      const result = detectPanelIntent("show me the panel that displays errors");
      if (result.panelId !== "governance") {
        throw new Error(`Expected governance for errors panel, received ${result.panelId}`);
      }
    },
  },
];

let failures = 0;

tests.forEach((test) => {
  try {
    test.run();
    console.log(`✔ ${test.name}`);
  } catch (err) {
    failures += 1;
    console.error(`✖ ${test.name}`);
    console.error(err instanceof Error ? err.message : err);
  }
});

if (failures > 0) {
  console.error(`${failures} panel intent test(s) failed.`);
  process.exit(1);
} else {
  console.log("All panel intent tests passed.");
}
