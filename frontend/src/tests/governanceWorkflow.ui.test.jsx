/** @jest-environment jsdom */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import RuntimeGovernancePanel from "../panels/RuntimeGovernancePanel";
import { useGovernanceStore } from "../state/governanceStore";

const timestamp = "2025-01-01T00:00:00.000Z";
const makeEntry = (id, text, cycle = 1) => ({
  id,
  text,
  cycle,
  timestamp,
});

const seedGovernanceState = (width) => {
  useGovernanceStore.setState({
    cycleStatus: "Validator",
    analyticalOutput: [makeEntry("a1", "Analytical pass tightened safeguards.")],
    moderatorOutputPre: [makeEntry("m1", "Moderator pre-creative clipped risky phrasing.")],
    creativeOutput: [makeEntry("c1", "Creative polish preserved structure.")],
    moderatorOutputPost: [makeEntry("m2", "Moderator (Post-Creative) confirmed hedged tone.")],
    validatorOutput: [makeEntry("v1", "Validator PASS — scope within governed lanes.")],
    validationSignals: [makeEntry("vs1", "Strictness high; validator satisfied.")],
    governanceNotices: [makeEntry("gn1", "Elevated strictness active for this run.")],
    deliveryWarnings: [makeEntry("dw1", "Network jitter detected.")],
    deliveryFailures: [makeEntry("df1", "Retrying governed-output delivery.")],
  });
  global.__RO_WIDTH__ = width;
  act(() => global.__triggerResizeObservers?.());
};

const findScrollableParent = (node) => {
  let current = node;
  while (current) {
    if (current.style && current.style.overflowY === "auto") {
      return current;
    }
    current = current.parentElement;
  }
  return null;
};

describe("RuntimeGovernancePanel harness", () => {
  afterEach(() => {
    const reset = useGovernanceStore.getState().resetLogs;
    reset();
    useGovernanceStore.setState({
      governanceNotices: [],
      validationSignals: [],
      deliveryWarnings: [],
      deliveryFailures: [],
      cycleStatus: "Idle",
    });
  });

  test("renders full pass grid with governance details and scrollable feeds", () => {
    seedGovernanceState(1200);
    render(<RuntimeGovernancePanel />);

    expect(screen.getByText("Analytical pass tightened safeguards.")).toBeInTheDocument();
    expect(screen.getByText("Moderator pre-creative clipped risky phrasing.")).toBeInTheDocument();
    expect(screen.getByText("Creative polish preserved structure.")).toBeInTheDocument();
    expect(screen.getByText("Moderator (Post-Creative) confirmed hedged tone.")).toBeInTheDocument();
    expect(screen.getByText("Validator PASS — scope within governed lanes.")).toBeInTheDocument();

    // Delivery failures should auto-expand the collapsible section.
    expect(screen.getByText("Delivery Failures")).toBeInTheDocument();
    expect(screen.getByText("Retrying governed-output delivery.")).toBeInTheDocument();

    const warningNode = screen.getByText("Network jitter detected.");
    const scrollableContainer = findScrollableParent(warningNode);
    expect(scrollableContainer).not.toBeNull();
    expect(scrollableContainer.style.overflowY).toBe("auto");
  });

  test("compact mode condenses layout and switches to single column under 600px", () => {
    seedGovernanceState(800);
    render(<RuntimeGovernancePanel />);

    const analyticalTitle = screen.getByText("Analytical Pass");
    let card = analyticalTitle.parentElement;
    while (card && !card.style.minHeight) {
      card = card.parentElement;
    }
    expect(card).toBeTruthy();
    expect(card.style.minHeight).toBe("90px");

    const twoColumnWrapper = Array.from(document.querySelectorAll("div")).find(
      (node) => node.style?.gridTemplateColumns === "repeat(2, minmax(0, 1fr))"
    );
    expect(twoColumnWrapper).toBeTruthy();

    act(() => {
      global.__RO_WIDTH__ = 500;
      global.__triggerResizeObservers?.();
    });

    const columnWrapper = Array.from(document.querySelectorAll("div")).find(
      (node) =>
        node.style?.flexDirection === "column" &&
        node.textContent?.includes("Analytical Pass") &&
        node.textContent?.includes("Validator Pass")
    );
    expect(columnWrapper).toBeTruthy();
  });
});
