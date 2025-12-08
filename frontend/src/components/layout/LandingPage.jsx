import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Header from "./Header";
import Footer from "./Footer";
import CommandPaletteModal from "./CommandPaletteModal";
import ChatHistoryDrawer from "../drawer/ChatHistoryDrawer";
import ChatMessagesList from "../chat/ChatMessagesList";
import ChatInputBar from "../chat/ChatInputBar";
import CanvasPanel from "../canvas/CanvasPanel";
import Sidebar from "../sidebar/Sidebar";
import ChatPanel from "../chat/ChatPanel";
import socket, { connectSocket, disconnectSocket } from "../../socket";
import { panelDisplayNames } from "../../panels/panelRegistry";
import { useGovernanceStore } from "../../state/governanceStore";
import { usePanelInvoker } from "../../panels/usePanelInvoker";
import {
  detectPanelIntent,
  shouldConfirmPanelInvocation,
  describePanelOptions,
  classifyConfirmationResponse,
} from "../../panels/panelIntent";
import { PanelLayoutProvider, getRequiredPanelsForLayout } from "../../context/PanelLayoutContext";

const PANEL_ACTION_TOKENS = ["open", "show", "display", "bring up", "pull up", "let me see", "can i see", "close", "hide"];
const PANEL_MENTION_TOKENS = [
  "panel",
  "runtime governance",
  "governance controls",
  "governance panel",
  "ledger",
  "diagnostic",
  "telemetry",
  "validator",
  "rules",
  "constraints",
  "state",
  "system info",
];

const containsKeyword = (text, tokens) => tokens.some((token) => text.includes(token));
const HEADER_PANEL_CAPACITY = 5;

export default function LandingPage({ onLogout }) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [chatWidthPct, setChatWidthPct] = useState(22); // percentage width of chat column
  const minPct = 18;
  const maxPct = 30;
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef(null);
  const [canvasPanels, setCanvasPanels] = useState(() => {
    const seedPanels = [
      { id: "gov", component: "governance", title: "Runtime Governance" },
      { id: "rules", component: "rules", title: "Parsed Governance Rules" },
      { id: "ledger", component: "ledger", title: "Ledger" },
    ];
    const now = Date.now();
    return seedPanels.map((panel, index) => ({ ...panel, lastAccessed: now + index }));
  });
  const [headerPanels, setHeaderPanels] = useState([]);
  const [canvasLayout, setCanvasLayout] = useState("tallLeft2");
  const [headerOverflowPrompt, setHeaderOverflowPrompt] = useState(null);
  const [headerPromptSelection, setHeaderPromptSelection] = useState(null);
  const panelUsageRef = useRef(new Map());
  useEffect(() => {
    connectSocket();
    return () => {
      disconnectSocket();
    };
  }, []);
  const canvasPanelsRef = useRef(canvasPanels);
  const headerPanelsRef = useRef(headerPanels);
  useEffect(() => {
    canvasPanelsRef.current = canvasPanels;
    canvasPanels.forEach((panel) => {
      if (panel.component) {
        panelUsageRef.current.set(panel.component, panel.lastAccessed ?? Date.now());
      }
    });
  }, [canvasPanels]);
  useEffect(() => {
    headerPanelsRef.current = headerPanels;
  }, [headerPanels]);
  useEffect(() => {
    if (!headerOverflowPrompt) {
      setHeaderPromptSelection(null);
      return;
    }
    const suggested = headerOverflowPrompt.suggestedCloseId || headerOverflowPrompt.pendingHeader?.[0]?.component || null;
    setHeaderPromptSelection(suggested);
  }, [headerOverflowPrompt]);

  const [messages, setMessages] = useState(() => []);
  const [pendingPanelConfirmation, setPendingPanelConfirmation] = useState(null);
  const [lastPanelTopic, setLastPanelTopic] = useState(null);
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const currentSessionRef = useRef(null);
  const chatInputRef = useRef(null);
  const [globalBanner, setGlobalBanner] = useState(null);
  const [simulationBannerActive, setSimulationBannerActive] = useState(false);
  const setRules = useGovernanceStore((s) => s.setRules);
  const setCycleStatus = useGovernanceStore((s) => s.setCycleStatus);
  const setGilState = useGovernanceStore((s) => s.setGilState);
  const addAnalyticalLog = useGovernanceStore((s) => s.addAnalyticalLog);
  const addModeratorLog = useGovernanceStore((s) => s.addModeratorLog);
  const addCreativeLog = useGovernanceStore((s) => s.addCreativeLog);
  const addLedgerEvent = useGovernanceStore((s) => s.addLedgerEvent);
  const addError = useGovernanceStore((s) => s.addError);
  const addGovernanceNotice = useGovernanceStore((s) => s.addGovernanceNotice);
  const addMcpEvent = useGovernanceStore((s) => s.addMcpEvent);
  const addMatrixEvaluation = useGovernanceStore((s) => s.addMatrixEvaluation);
  const addValidationEvent = useGovernanceStore((s) => s.addValidationEvent);
  const resetLogs = useGovernanceStore((s) => s.resetLogs);
  const startSession = useGovernanceStore((s) => s.startSession);
  const pendingClarification = useGovernanceStore((s) => s.pendingClarification);
  const setPendingClarification = useGovernanceStore((s) => s.setPendingClarification);
  const setDataScopeMode = useGovernanceStore((s) => s.setDataScopeMode);
  const setStrictnessLevel = useGovernanceStore((s) => s.setStrictnessLevel);
  const setCyclePlan = useGovernanceStore((s) => s.setCyclePlan);
  const setCurrentCycle = useGovernanceStore((s) => s.setCurrentCycle);
  const setCanonicalTrace = useGovernanceStore((s) => s.setCanonicalTrace);
  const setExternalReferences = useGovernanceStore((s) => s.setExternalReferences);
  const addDeliveryWarning = useGovernanceStore((s) => s.addDeliveryWarning);
  const addDeliveryFailure = useGovernanceStore((s) => s.addDeliveryFailure);
  const removeDeliveryFailure = useGovernanceStore((s) => s.removeDeliveryFailure);
  const governanceStrictnessSetting = useGovernanceStore((s) => s.governanceStrictnessSetting);
  const cycleLimitSetting = useGovernanceStore((s) => s.cycleLimitSetting);
  const perfModeSetting = useGovernanceStore((s) => s.perfMode);
  const governanceMode = useGovernanceStore((s) => s.governanceMode);
  const setGovernanceModeStore = useGovernanceStore((s) => s.setGovernanceMode);
  const getStore = useGovernanceStore;
  const processedAckIdsRef = useRef(new Set());
  const appendAssistantMessage = useCallback((text, author = "cd\\ai Governed Response") => {
    if (!text) return;
    setMessages((prev) => {
      const nextId = (prev[prev.length - 1]?.id || 0) + 1;
      return [
        ...prev,
        {
          id: nextId,
          role: "assistant",
          author,
          text,
          timestamp: Date.now(),
        },
      ];
    });
  }, []);
  const appendPanelRouterMessage = useCallback(
    (text) => appendAssistantMessage(text, "cd\\ai Panel Router"),
    [appendAssistantMessage]
  );
  const getPanelTitleById = useCallback((panelId) => panelDisplayNames[panelId] || panelId, []);
  const buildPanelDescriptor = useCallback(
    (panelId) => ({
      id: `${panelId}-panel`,
      component: panelId,
      title: getPanelTitleById(panelId),
      lastAccessed: Date.now(),
    }),
    [getPanelTitleById]
  );
  const findLeastUsedPanel = useCallback(
    (panels, excludeComponent) => {
      const candidates = excludeComponent ? panels.filter((panel) => panel.component !== excludeComponent) : panels.slice();
      if (!candidates.length) return null;
      return candidates.reduce((least, panel) => {
        const leastValue = panelUsageRef.current.get(least.component) ?? least.lastAccessed ?? 0;
        const panelValue = panelUsageRef.current.get(panel.component) ?? panel.lastAccessed ?? 0;
        return panelValue < leastValue ? panel : least;
      });
    },
    []
  );
  const processHeaderAdditions = useCallback(
    (pendingCanvas, headerBase, pendingAdds) => {
      const normalizedHeader = Array.isArray(headerBase) ? headerBase.slice() : [];
      const additions = Array.isArray(pendingAdds) ? pendingAdds.slice() : [];
      if (!additions.length) {
        setCanvasPanels(pendingCanvas);
        setHeaderPanels(normalizedHeader);
        setHeaderOverflowPrompt(null);
        return true;
      }
      let workingHeader = normalizedHeader;
      while (additions.length) {
        if (workingHeader.length >= HEADER_PANEL_CAPACITY) {
          setHeaderOverflowPrompt({
            pendingCanvas,
            pendingHeader: workingHeader,
            pendingAdds: additions.slice(),
            suggestedCloseId: findLeastUsedPanel(workingHeader)?.component || workingHeader[0]?.component || null,
          });
          return false;
        }
        const nextPanel = additions.shift();
        const stampedPanel = {
          ...nextPanel,
          lastAccessed: nextPanel?.lastAccessed ?? Date.now(),
        };
        panelUsageRef.current.set(stampedPanel.component, stampedPanel.lastAccessed);
        workingHeader = [...workingHeader, stampedPanel];
      }
      setCanvasPanels(pendingCanvas);
      setHeaderPanels(workingHeader);
      setHeaderOverflowPrompt(null);
      return true;
    },
    [findLeastUsedPanel]
  );
  const addPanelToCanvas = useCallback(
    (panelDescriptor) => {
      const capacity = getRequiredPanelsForLayout(canvasLayout);
      const normalizedPanel = { ...panelDescriptor, lastAccessed: Date.now() };
      const currentCanvas = canvasPanelsRef.current || [];
      const currentHeader = headerPanelsRef.current || [];
      const sanitizedCanvas = currentCanvas.filter((panel) => panel.component !== normalizedPanel.component);
      const sanitizedHeader = currentHeader.filter((panel) => panel.component !== normalizedPanel.component);
      let workingCanvas = [...sanitizedCanvas, normalizedPanel];
      const demotedPanels = [];
      while (workingCanvas.length > capacity) {
        const demoteTarget =
          findLeastUsedPanel(workingCanvas, normalizedPanel.component) || workingCanvas.find((panel) => panel.component !== normalizedPanel.component);
        if (!demoteTarget) break;
        demotedPanels.push(demoteTarget);
        workingCanvas = workingCanvas.filter((panel) => panel.component !== demoteTarget.component);
      }
      panelUsageRef.current.set(normalizedPanel.component, normalizedPanel.lastAccessed);
      const datedDemoted = demotedPanels.map((panel) => {
        const updatedAt = panelUsageRef.current.get(panel.component) ?? Date.now();
        panelUsageRef.current.set(panel.component, updatedAt);
        return { ...panel, lastAccessed: updatedAt };
      });
      if (!datedDemoted.length) {
        setCanvasPanels(workingCanvas);
        setHeaderPanels(sanitizedHeader);
        return;
      }
      const headerReady = processHeaderAdditions(workingCanvas, sanitizedHeader, datedDemoted);
      if (!headerReady) return;
    },
    [canvasLayout, findLeastUsedPanel, processHeaderAdditions]
  );
  const handleCanvasPanelClose = useCallback((panelId) => {
    let removedComponent = null;
    setCanvasPanels((prev) => {
      const target = prev.find((panel) => panel.id === panelId);
      if (!target) return prev;
      removedComponent = target.component;
      return prev.filter((panel) => panel.id !== panelId);
    });
    if (removedComponent) {
      setHeaderPanels((prev) => prev.filter((panel) => panel.component !== removedComponent));
    }
  }, []);
  const handleHeaderPanelSelect = useCallback(
    (componentId) => {
      const target = headerPanelsRef.current.find((panel) => panel.component === componentId);
      if (!target) return;
      addPanelToCanvas({ ...target, lastAccessed: Date.now() });
    },
    [addPanelToCanvas]
  );
  const handleHeaderPanelClose = useCallback((componentId) => {
    setHeaderPanels((prev) => prev.filter((panel) => panel.component !== componentId));
  }, []);
  const handleHeaderOverflowConfirm = useCallback(() => {
    if (!headerOverflowPrompt || !headerPromptSelection) return;
    const { pendingCanvas, pendingHeader = [], pendingAdds = [] } = headerOverflowPrompt;
    if (!pendingCanvas || !pendingAdds.length) return;
    const filteredHeader = pendingHeader.filter((panel) => panel.component !== headerPromptSelection);
    const resolved = processHeaderAdditions(pendingCanvas, filteredHeader, pendingAdds);
    if (resolved) {
      setHeaderPromptSelection(null);
    }
  }, [headerOverflowPrompt, headerPromptSelection, processHeaderAdditions]);
  const handleHeaderOverflowCancel = useCallback(() => {
    setHeaderOverflowPrompt(null);
    setHeaderPromptSelection(null);
    appendPanelRouterMessage("Okay, I left the header unchanged.");
  }, [appendPanelRouterMessage]);
  const handlePanelOpen = useCallback(
    (panelId, opts = {}) => {
      if (!panelId) return;
      if (panelId === "governance") {
        const now = Date.now();
        const governancePanels = [
          { id: "gov", component: "governance", title: "Runtime Governance", lastAccessed: now },
          { id: "rules", component: "rules", title: "Parsed Governance Rules", lastAccessed: now + 1 },
          { id: "ledger", component: "ledger", title: "Ledger", lastAccessed: now + 2 },
        ];
        governancePanels.forEach((panel) => {
          panelUsageRef.current.set(panel.component, panel.lastAccessed);
        });
        setCanvasLayout("tallLeft2");
        setCanvasPanels(governancePanels);
        setHeaderPanels((prev) => prev.filter((panel) => !governancePanels.some((p) => p.component === panel.component)));
        return;
      }
      if (panelId === "mvp") {
        const descriptor = { id: "mvp-panel", component: "mvp", title: getPanelTitleById("mvp"), lastAccessed: Date.now() };
        panelUsageRef.current.set(descriptor.component, descriptor.lastAccessed);
        setCanvasLayout("1panel");
        setCanvasPanels([descriptor]);
        setHeaderPanels((prev) => prev.filter((panel) => panel.component !== descriptor.component));
        return;
      }
      if (panelId === "archivedLedger") {
        const descriptor = { id: "arch-ledger", component: "archivedLedger", title: getPanelTitleById("archivedLedger"), lastAccessed: Date.now() };
        panelUsageRef.current.set(descriptor.component, descriptor.lastAccessed);
        setCanvasLayout("1panel");
        setCanvasPanels([descriptor]);
        setHeaderPanels((prev) => prev.filter((panel) => panel.component !== descriptor.component));
        return;
      }
      if (opts.replaceOnly === true) {
        const descriptor = buildPanelDescriptor(panelId);
        panelUsageRef.current.set(descriptor.component, descriptor.lastAccessed);
        setCanvasPanels((prev) => {
          if (!prev || !prev.length) {
            return [descriptor];
          }
          const replaced = prev[prev.length - 1];
          setHeaderPanels((headerPrev) => {
            if (!replaced) return headerPrev;
            const sanitized = headerPrev.filter((panel) => panel.component !== replaced.component);
            return [...sanitized, { ...replaced, lastAccessed: Date.now() }].slice(-HEADER_PANEL_CAPACITY);
          });
          return [...prev.slice(0, prev.length - 1), descriptor];
        });
        return;
      }
      addPanelToCanvas(buildPanelDescriptor(panelId));
    },
    [addPanelToCanvas, buildPanelDescriptor, getPanelTitleById]
  );
  const { invokePanel, getPanelTitle } = usePanelInvoker({
    openPanelHandler: handlePanelOpen,
  });
  const handleLayoutSelect = useCallback(
    (layoutId) => {
      if (!layoutId) return;
      const capacity = getRequiredPanelsForLayout(layoutId);
      const currentCanvas = canvasPanelsRef.current || [];
      const currentHeader = headerPanelsRef.current || [];
      let workingCanvas = currentCanvas.slice();
      let workingHeader = currentHeader.slice();
      while (workingCanvas.length < capacity && workingHeader.length) {
        const promoteTarget = workingHeader.shift();
        if (!promoteTarget) break;
        const stamped = { ...promoteTarget, lastAccessed: Date.now() };
        panelUsageRef.current.set(stamped.component, stamped.lastAccessed);
        workingCanvas = [...workingCanvas, stamped];
      }
      const demotedPanels = [];
      while (workingCanvas.length > capacity) {
        const demoteTarget = findLeastUsedPanel(workingCanvas);
        if (!demoteTarget) break;
        demotedPanels.push(demoteTarget);
        workingCanvas = workingCanvas.filter((panel) => panel.id !== demoteTarget.id);
      }
      workingHeader = workingHeader.filter((panel) => !workingCanvas.some((canvasPanel) => canvasPanel.component === panel.component));
      if (demotedPanels.length) {
        const normalizedDemoted = demotedPanels.map((panel) => ({
          ...panel,
          lastAccessed: panelUsageRef.current.get(panel.component) ?? panel.lastAccessed ?? Date.now(),
        }));
        const applied = processHeaderAdditions(workingCanvas, workingHeader, normalizedDemoted);
        if (!applied) {
          setCanvasLayout(layoutId);
          return;
        }
      } else {
        setCanvasPanels(workingCanvas);
        setHeaderPanels(workingHeader);
      }
      setCanvasLayout(layoutId);
    },
    [findLeastUsedPanel, processHeaderAdditions]
  );
  const openPanelFromUI = useCallback(
    async (panelId, context = {}, opts = {}) => {
      if (!panelId) return false;
      const normalizedContext = { source: "panel-router", ...context };
      const result = await invokePanel(panelId, normalizedContext, opts);
      if (!result.opened) {
        if (result.reason) {
          appendPanelRouterMessage(result.reason);
        }
        return false;
      }
      setLastPanelTopic(panelId);
      setPendingPanelConfirmation(null);
      return true;
    },
    [invokePanel, appendPanelRouterMessage]
  );
  const promptForPanelConfirmation = useCallback(
    (panelIds = [], context = {}) => {
      const normalizedIds = Array.isArray(panelIds) ? panelIds : [];
      let question = "Which panel would you like me to open?";
      if (normalizedIds.length === 1) {
        question = `Do you want me to open the ${getPanelTitle(normalizedIds[0])} panel?`;
      } else if (normalizedIds.length > 1) {
        question = `Do you want me to open the ${describePanelOptions(normalizedIds)}?`;
      }
      appendPanelRouterMessage(question);
      setPendingPanelConfirmation({
        type: normalizedIds.length === 0 ? "any" : normalizedIds.length === 1 ? "single" : "multi",
        panelId: normalizedIds.length === 1 ? normalizedIds[0] : null,
        matches: normalizedIds,
        context,
        question,
      });
    },
    [appendPanelRouterMessage, getPanelTitle]
  );
  const handlePanelIntentResult = useCallback(
    async (utterance, result, meta = {}) => {
      if (!result || result.status === "none" || !Array.isArray(result.matches) || result.matches.length === 0) {
        return false;
      }
      if (result.status === "match" && result.panelId && !shouldConfirmPanelInvocation(result)) {
        const opened = await openPanelFromUI(result.panelId, {
          ...meta,
          utterance,
          intentKeyword: result.matches[0]?.keyword,
        });
        if (opened) {
          appendPanelRouterMessage(`Opening the ${getPanelTitle(result.panelId)} panel.`);
          return true;
        }
        return false;
      }
      const candidateIds = result.matches?.map((m) => m.panelId) || [];
      if (!candidateIds.length && lastPanelTopic) {
        candidateIds.push(lastPanelTopic);
      }
      promptForPanelConfirmation(candidateIds, { ...meta, utterance, reason: result.reason });
      return true;
    },
    [appendPanelRouterMessage, getPanelTitle, lastPanelTopic, openPanelFromUI, promptForPanelConfirmation]
  );
  const handlePanelConfirmationResponse = useCallback(
    async (text) => {
      if (!pendingPanelConfirmation) return false;
      const normalized = (text || "").trim().toLowerCase();
      if (!normalized) return false;
      const confirmation = classifyConfirmationResponse(normalized);
      const { panelId, matches, type } = pendingPanelConfirmation;

      const openAndAnnounce = async (targetPanel) => {
        const opened = await openPanelFromUI(targetPanel, {
          source: "chat-confirmation",
          ...pendingPanelConfirmation.context,
        });
        if (opened) {
          appendPanelRouterMessage(`Opening the ${getPanelTitle(targetPanel)} panel.`);
        }
        return opened;
      };

      if (type === "single" && panelId) {
        if (confirmation === "yes") {
          return openAndAnnounce(panelId);
        }
        if (confirmation === "no") {
          setPendingPanelConfirmation(null);
          appendPanelRouterMessage("Okay, I will keep the current panels as-is.");
          return true;
        }
        return false;
      }

      if (type === "multi" && Array.isArray(matches)) {
        const matchedPanel =
          matches.find((candidate) => {
            const label = getPanelTitle(candidate).toLowerCase();
            return (
              normalized.includes(candidate) ||
              normalized.includes(label) ||
              normalized.includes(label.split(" " )[0])
            );
          }) || (confirmation === "yes" && panelId ? panelId : null);
        if (matchedPanel) {
          return openAndAnnounce(matchedPanel);
        }
        if (confirmation === "no") {
          setPendingPanelConfirmation(null);
          appendPanelRouterMessage("No panel changes will be made.");
          return true;
        }
        return false;
      }

      if (type === "any") {
        if (confirmation === "no") {
          setPendingPanelConfirmation(null);
          appendPanelRouterMessage("Understood?no panels were opened.");
          return true;
        }
        if (confirmation === "yes" && lastPanelTopic) {
          return openAndAnnounce(lastPanelTopic);
        }
        const guess = detectPanelIntent(text, { suggestedPanel: lastPanelTopic || undefined });
        if (guess.panelId && guess.status === "match" && !shouldConfirmPanelInvocation(guess)) {
          return openAndAnnounce(guess.panelId);
        }
        return false;
      }

      return false;
    },
    [appendPanelRouterMessage, getPanelTitle, lastPanelTopic, openPanelFromUI, pendingPanelConfirmation, setPendingPanelConfirmation]
  );
  const handleSidebarPanelOpen = useCallback(
    (panelId, opts = {}) => {
      void openPanelFromUI(panelId, { source: "sidebar" }, opts);
    },
    [openPanelFromUI]
  );

  const sortedMessages = useMemo(
    () => messages.slice().sort((a, b) => a.id - b.id),
    [messages]
  );

  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), []);
  const closeCommandPalette = useCallback(() => setCommandPaletteOpen(false), []);

  useEffect(() => {
    const handler = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommandPalette();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openCommandPalette]);

  const panelPaletteOptions = useMemo(() => {
    const basePanels = Object.entries(panelDisplayNames || {}).map(([id, label]) => ({
      id,
      label,
      type: "panel",
    }));
    basePanels.sort((a, b) => a.label.localeCompare(b.label));
    return [{ id: "__chat__", label: "Chat Panel", type: "action" }, ...basePanels];
  }, []);

  const panelCommandEntries = useMemo(
    () =>
      panelPaletteOptions
        .filter((option) => option.type === "panel")
        .map((option) => ({
          id: `open-${option.id}`,
          label: `Open ${option.label} panel`,
          action: () => {
            void openPanelFromUI(option.id);
          },
        })),
    [openPanelFromUI, panelPaletteOptions]
  );

  const commandPaletteCommands = useMemo(
    () => [
      {
        id: "new-chat",
        label: "Start a new chat",
        action: () => setMessages([]),
      },
      {
        id: "toggle-history",
        label: `${isHistoryOpen ? "Close" : "Open"} chat history`,
        action: () => setIsHistoryOpen((prev) => !prev),
      },
      ...panelCommandEntries,
    ],
    [isHistoryOpen, panelCommandEntries, setIsHistoryOpen, setMessages]
  );

  const focusChatInput = useCallback(() => {
    if (chatInputRef.current) {
      chatInputRef.current.focus();
      chatInputRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, []);

  const handlePanelCommandSelect = useCallback(
    (optionId) => {
      if (!optionId) return;
      if (optionId === "__chat__") {
        focusChatInput();
        return;
      }
      void openPanelFromUI(optionId);
    },
    [focusChatInput, openPanelFromUI]
  );

  const runGovernanceHarness = useCallback(() => {
    const harnessInput = "Governance harness: create a governed 3-step project plan for migrating a database.";
    const sessionId = `harness-${Date.now()}`;
    currentSessionRef.current = sessionId;
    startSession(sessionId);
    processedAckIdsRef.current.clear();
    socket.emit("join-session", { sessionId });
    const normalizedStrictness = typeof governanceStrictnessSetting === "number" ? governanceStrictnessSetting : 0.85;
    const normalizedMaxCycles = cycleLimitSetting > 0 ? cycleLimitSetting : null;
    const resolvedPerfMode = perfModeSetting || "real";
    socket.emit("run-workflow", {
      input: harnessInput,
      goal: "Harness verification cycle",
      governanceStrictness: normalizedStrictness,
      maxCycles: normalizedMaxCycles,
      perfMode: resolvedPerfMode,
      sessionId,
      requiresGovernedOutput: true,
      metadata: { harness: "governance-workflow-test", issuedFrom: "chat-command" },
    });
    const noticeText = `[Harness] Governance workflow test triggered at ${new Date().toLocaleTimeString()}.`;
    addGovernanceNotice(noticeText);
    appendAssistantMessage(
      "Launching the governance workflow harness. Monitor Runtime Governance and Diagnostics for streaming output.",
      "cd\\ai Harness"
    );
  }, [
    addGovernanceNotice,
    appendAssistantMessage,
    cycleLimitSetting,
    governanceStrictnessSetting,
    perfModeSetting,
    processedAckIdsRef,
    socket,
    startSession,
  ]);

  const handleSend = async (text) => {
    if (pendingClarification) {
      return;
    }
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const nextId = (messages[messages.length - 1]?.id || 0) + 1;
    const userMessage = {
      id: nextId,
      role: "user",
      author: "Marc Lane",
      text: trimmed,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    if (lower === "/test governance") {
      appendPanelRouterMessage("Launching the governance workflow harness...");
      runGovernanceHarness();
      return;
    }

    const handledConfirmation = await handlePanelConfirmationResponse(trimmed);
    if (handledConfirmation) {
      return;
    }

    const wantsPanelCommand =
      containsKeyword(lower, PANEL_ACTION_TOKENS) && containsKeyword(lower, PANEL_MENTION_TOKENS);
    if (wantsPanelCommand) {
      const detection = detectPanelIntent(trimmed, { suggestedPanel: lastPanelTopic || undefined });
      if (detection && detection.status !== "none") {
        const handled = await handlePanelIntentResult(trimmed, detection, { source: "chat" });
        if (handled) {
          return;
        }
      }
    }

    if (lower.includes("governance controls")) {
      await openPanelFromUI("govControls", { source: "chat-command" }, { replaceOnly: true });
      return;
    }

    const sessionId = `session-${Date.now()}`;
    currentSessionRef.current = sessionId;
    startSession(sessionId);
    processedAckIdsRef.current.clear();
    socket.emit("join-session", { sessionId }); // EVENT MODEL FIX: join room
    const normalizedStrictness = typeof governanceStrictnessSetting === "number" ? governanceStrictnessSetting : 0.85;
    const normalizedMaxCycles = cycleLimitSetting > 0 ? cycleLimitSetting : null;
    const resolvedPerfMode = perfModeSetting || "real";

    socket.emit("run-workflow", {
      input: trimmed,
      // send no rules so the server preserves any existing governance set
      goal: "",
      governanceStrictness: normalizedStrictness,
      maxCycles: normalizedMaxCycles,
      perfMode: resolvedPerfMode,
      sessionId,
    });
  };

  const handleClarificationSubmit = (answer) => {
    if (!pendingClarification) return;
    socket.emit("clarification-response", {
      sessionId: pendingClarification.sessionId || getStore.getState().activeSessionId,
      runId: pendingClarification.runId,
      clarificationAnswer: answer,
    });
  };

  const updateWidthFromClientX = useCallback(
    (clientX) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(maxPct, Math.max(minPct, pct));
      setChatWidthPct(clamped);
    },
    [maxPct, minPct]
  );

  const handleMouseMove = useCallback(
    (e) => {
      updateWidthFromClientX(e.clientX);
    },
    [updateWidthFromClientX]
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleResizeEnd);
  }, [handleMouseMove]);

  const handleResizeStart = useCallback(
    (e) => {
      e.preventDefault();
      setIsResizing(true);
      updateWidthFromClientX(e.clientX);
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleResizeEnd);
    },
    [handleMouseMove, handleResizeEnd, updateWidthFromClientX]
  );

  const formatTelemetryTimestamp = useCallback((iso) => {
    if (!iso) return undefined;
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return undefined;
    return new Date(parsed).toLocaleString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  }, []);

  useEffect(() => {
    const getActiveSessionId = () => getStore.getState().activeSessionId || currentSessionRef.current;

    const handleSocketConnect = () => {
      try {
        const session = getActiveSessionId();
        if (session) {
          socket.emit("join-session", { sessionId: session });
        }
      } catch (error) {
        console.error("[socket] connect handler failed", error);
      }
    };

    const emitDeliveryAck = (ackId, sessionIdOverride) => {
      if (!ackId) return;
      socket.emit("delivery-ack", {
        ackId,
        sessionId: sessionIdOverride || getActiveSessionId() || null,
      });
    };

    const handleTelemetry = (msg) => {
      try {
        if (!msg || typeof msg !== "object") return;
        const incomingSession =
          msg.sessionId || msg.runId || msg.workflowId || msg.traceId;
        const activeSessionId = getActiveSessionId();
        if (incomingSession && incomingSession !== activeSessionId) {
          return; // EVENT MODEL FIX: ignore events from other sessions
        }
        const subtype = msg.subtype || msg.type;
        const data = msg.data || msg;
        const phase = (msg.phase || msg.cyclePhase || msg.status || "").toString().toLowerCase();
        if (phase.includes("analytical")) setCycleStatus("Analytical");
        else if (phase.includes("moderator")) setCycleStatus("Moderator");
        else if (phase.includes("creative")) setCycleStatus("Creative");
        else if (phase.includes("validator")) setCycleStatus("Validator");
        if (subtype === "final-output") {
          setCycleStatus("Idle");
          setSimulationBannerActive(Boolean(data?.simulation));
        }
        if (subtype === "hemisphere-log" && typeof data.message === "string") {
          const hemi = (data.hemisphere || "").toUpperCase();
          if (hemi === "A") addAnalyticalLog(data.message, data.cycle);
          if (hemi === "C") addCreativeLog(data.message, data.cycle);
        }
        if (subtype === "moderator-log" && typeof data.message === "string") {
          addModeratorLog({
            text: data.message,
            cycle: data.cycle,
            phase: data.phase || data.passId || "pre",
            timestamp: data.timestamp,
          });
        }
        if (subtype === "hemisphere-validation" && data.validation) {
          const validationState = data.validation;
          if (validationState.isCompliant === true) setGilState("green");
          else if (validationState.isCompliant === false) setGilState("red");
          const decisionLabel = (validationState.decision || (validationState.isCompliant ? "PASS" : "FAIL")).toUpperCase();
          const validationText = `Hemisphere ${decisionLabel} ??" ${
            validationState.reason || validationState.message || "no rationale"
          }`;
          addValidationEvent(validationText, data.cycle ?? validationState.cycle, {
            decision: decisionLabel,
            hemisphere: validationState.hemisphere || "validator",
            strictness: validationState.strictnessLevel,
            ruleIds: validationState.ruleIds,
            rationale: validationState.rationale,
            timestamp: formatTelemetryTimestamp(validationState.timestamp),
            meta: { source: "hemisphere-validation" },
          });
        }
        if (subtype === "validator-event" && data.entry) {
          const validatorEntry = data.entry;
          const summary =
            validatorEntry.summary || validatorEntry.rationale || validatorEntry.text || "Validator event received.";
          const decisionLabel = (validatorEntry.decision || "").toString().toUpperCase() || undefined;
          addValidationEvent(summary, validatorEntry.cycle, {
            decision: decisionLabel,
            hemisphere: validatorEntry.hemisphere || "validator",
            strictness: validatorEntry.strictness,
            ruleIds: validatorEntry.ruleIds,
            rationale: validatorEntry.rationale,
            timestamp: formatTelemetryTimestamp(validatorEntry.timestamp) || validatorEntry.timestamp,
            meta: { source: "validator-event" },
          });
        }
        if (subtype === "gil-state") {
          if (msg.active === true) setGilState("green");
          else setGilState("idle");
        }
        if (subtype === "mcp-status") {
          const status = (data.status || "").toString().toLowerCase();
          if (status.includes("analytical")) setCycleStatus("Analytical");
          else if (status.includes("moderator")) setCycleStatus("Moderator");
          else if (status.includes("creative")) setCycleStatus("Creative");
          else if (status.includes("validator")) setCycleStatus("Validator");
          else if (status.includes("finalized") || status.includes("idle")) {
            setCycleStatus("Idle");
          }
        }
        if (subtype === "parsed-rules") {
          const rulesPayload = data.rules || data.payload?.rules || data.payload?.payload?.rules;
          if (Array.isArray(rulesPayload)) setRules(rulesPayload);
        }
        if (subtype === "ledger" || subtype === "ledger-entry" || subtype === "ledger-updated") {
          const entries = Array.isArray(data.entries)
            ? data.entries
            : data.entry
            ? [data.entry]
            : null;
          entries?.forEach((entry) =>
            addLedgerEvent({
              text: entry?.summary || "",
              stage: entry?.stage,
              cycle: entry?.cycle,
              timestamp: formatTelemetryTimestamp(entry?.timestamp) || entry?.timestamp,
              decision: entry?.decision,
              hemisphere: entry?.hemisphere,
              strictness: entry?.strictness,
              ruleIds: entry?.ruleIds,
              rationale: entry?.rationale,
              snippet: entry?.snippet,
              simulationMode: entry?.simulationMode || data?.simulation === true,
              simulationAdvisory: entry?.simulationAdvisory,
            })
          );
        }
        if (subtype === "strictness") {
          const level = typeof data.level === "number" ? data.level : data?.strictness?.level;
          setStrictnessLevel(level ?? null);
          if (typeof level === "number" && level >= 2) {
            setGlobalBanner({
              type: "strictness-alert",
              message: `Strictness elevated to ${level}. Review outputs carefully.`,
              timestamp: Date.now(),
            });
          }
        }
        if (subtype === "v1.2-matrix-eval" || subtype === "v1.1-governance-matrix") {
          const text = `Matrix decision: ${data?.governanceDecision || data?.outcome || "unknown"}${
            data?.rationale ? ` ??" ${data.rationale}` : ""
          }`;
          addMatrixEvaluation(text.trim(), data?.cycle);
        }
        if (subtype === "cycle-plan") {
          const planned = typeof data.plannedCycles === "number" ? data.plannedCycles : null;
          setCyclePlan(planned);
        }
        if (subtype === "cycle-update" && typeof data.cycle === "number") {
          setCurrentCycle(data.cycle);
        }
        if (subtype === "mcp-step" && data?.message) {
          addMcpEvent(data.message, data.cycle);
        }
        if (subtype === "v1.1-validation") {
          const validationState = data?.validation || {};
          const status =
            validationState.isCompliant === true ? "PASS" : validationState.isCompliant === false ? "FAIL" : "CHECK";
          const text = `Validator ${status} ??" ${validationState.reason || validationState.message || "no rationale"}`;
          addValidationEvent(text, data?.cycle ?? validationState.cycle, {
            decision: status,
            hemisphere: validationState.hemisphere || "validator",
            strictness: validationState.strictnessLevel,
            ruleIds: validationState.ruleIds,
            rationale: validationState.rationale,
            timestamp: formatTelemetryTimestamp(validationState.timestamp),
            meta: { source: "v1.1-validation" },
          });
          if (status === "FAIL" || validationState.outcome === "block") {
            setGlobalBanner({
              type: "validation-alert",
              message: validationState.reason || validationState.message || "Validator blocked the response.",
              timestamp: Date.now(),
            });
          }
        }
        if (subtype === "v1.2-validator-scope") {
          const text = `Scope Check ??" external:${data?.containsExternal ? "yes" : "no"}, citation:${
            data?.citationProvided ? "yes" : "no"
          }, provenance:${data?.provenanceAttached ? "yes" : "no"}, mixed:${data?.mixesPublicAndInternal ? "yes" : "no"}`;
          addValidationEvent(text);
          if (
            data?.containsExternal &&
            (!data?.citationProvided || !data?.provenanceAttached || data?.mixesPublicAndInternal)
          ) {
            setGlobalBanner({
              type: "validation-alert",
              message: "Validator flagged external data without proper attribution/provenance.",
              timestamp: Date.now(),
            });
          }
        }
        if (subtype === "v1.1-canonical-trace") {
          setCanonicalTrace({ core: data, cycle: typeof data.cycle === "number" ? data.cycle : msg.cycle ?? null });
          if (Array.isArray(data?.externalReferences)) setExternalReferences(data.externalReferences);
        }
        if (subtype === "v1.2-data-scope-trace") {
          setCanonicalTrace({ dataScope: data, cycle: typeof data.cycle === "number" ? data.cycle : msg.cycle ?? null });
          if (Array.isArray(data?.externalReferences)) setExternalReferences(data.externalReferences);
        }
        if (
          (subtype === "v1.2-mode-change" ||
            subtype === "v1.2-mcp-entry-mode" ||
            subtype === "v1.2-clarification-mode") &&
          data.mode
        ) {
          setDataScopeMode(data.mode === "web" ? "web" : "work");
        }
        if (subtype === "socket-delivery" && data.event) {
          if (data.delivered !== true) {
            const warning = `Socket delivery warning: ${data.event} (session ${data.sessionId || "unknown"})`;
            addDeliveryWarning(warning);
            setGlobalBanner({ type: "socket-warning", message: warning, timestamp: Date.now() });
          }
        }
        if (subtype === "socket-delivery-final-fail" && data.event) {
          const failure = `Delivery failed after retries: ${data.event} (session ${data.sessionId || "unknown"})`;
          addDeliveryFailure({
            text: failure,
            ackId: data.ackId,
            sessionId: data.sessionId || getActiveSessionId() || null,
            event: data.event,
          });
          setGlobalBanner({
            type: "socket-failure",
            message: `${failure}. Request manual resend.`,
            timestamp: Date.Now(),
          });
        }
        if (subtype === "socket-delivery-resend" && data.ackId) {
          removeDeliveryFailure(data.ackId);
        }
        if (subtype === "reset") {
          resetLogs();
        }
      } catch (error) {
        console.error("[socket] telemetry handler failed", error, msg);
      }
    };


    const handleWorkflowOutput = (payload) => {
      try {
        const incomingSession =
          payload?.sessionId || payload?.runId || payload?.workflowId;
        const activeSessionId = getActiveSessionId();
        if (incomingSession && incomingSession !== activeSessionId) return; // EVENT MODEL FIX: ignore cross-session
        const content = payload?.text || payload?.output || payload?.message || "";
        appendAssistantMessage(content);
      } catch (error) {
        console.error("[socket] workflow-output handler failed", error, payload);
      }
    };

    const handleGovernedOutput = (payload) => {
      try {
        const incomingSession = payload?.sessionId;
        const activeSessionId = getStore.getState().activeSessionId;
        if (incomingSession && incomingSession !== activeSessionId) return;
        const block = payload?.payload || payload;
        const content = block?.text || "";
        const narrative = block?.narrative;
        const ackId = block?.ackId || payload?.ackId;
        const ackCache = processedAckIdsRef.current;
        const alreadySeen = ackId ? ackCache.has(ackId) : false;
        if (!alreadySeen) {
          if (ackId) {
            ackCache.add(ackId);
            if (ackCache.size > 200) {
              const oldest = ackCache.values().next().value;
              ackCache.delete(oldest);
            }
          }
          appendAssistantMessage([content, narrative].filter(Boolean).join("\n\n"));
        }
        emitDeliveryAck(ackId, incomingSession);
      } catch (error) {
        console.error("[socket] governed-output handler failed", error, payload);
      }
    };

    const handleWorkflowFinished = (payload = {}) => {
      try {
        currentSessionRef.current = null;
        setCycleStatus("Idle");
        emitDeliveryAck(payload?.ackId, payload?.sessionId);
      } catch (error) {
        console.error("[socket] workflow-finished handler failed", error, payload);
      }
    };

    const handleGovernanceErrors = (msg) => {
      try {
        if (msg?.error) {
          addError(msg.error);
          setGlobalBanner({ type: msg.type || "error", message: msg.error, timestamp: Date.now() });
        }
      } catch (error) {
        console.error("[socket] governance-error handler failed", error, msg);
      }
    };

    const handleParsedRulesEvent = (payload) => {
      try {
        const rulesPayload = payload?.rules || payload?.payload?.rules;
        if (Array.isArray(rulesPayload)) {
          setRules(rulesPayload);
        }
      } catch (error) {
        console.error("[socket] parsed-rules handler failed", error, payload);
      }
    };

    const handleModeEvent = (payload) => {
      try {
        const mode = payload?.mode || payload?.data?.mode;
        if (mode) {
          setDataScopeMode(mode === "web" ? "web" : "work");
        }
      } catch (error) {
        console.error("[socket] data-scope-mode handler failed", error, payload);
      }
    };

    const handleGovernanceModeEvent = (payload) => {
      try {
        const mode = payload?.mode || payload?.data?.mode;
        if (!mode) return;
        if (mode === "simulation" || mode === "phi_compliant" || mode === "strict") {
          setGovernanceModeStore(mode);
        } else {
          setGovernanceModeStore("strict");
        }
      } catch (error) {
        console.error("[socket] governance-mode handler failed", error, payload);
      }
    };

    const handleGovernanceNotice = (payload) => {
      try {
        const message = payload?.message;
        if (message) {
          addGovernanceNotice(message);
        }
      } catch (error) {
        console.error("[socket] governance-notice handler failed", error, payload);
      }
    };

    const handleUngovernedOutput = (payload = {}) => {
      try {
        const suppressed = payload?.suppressResponse || payload?.metadata?.suppressed;
        const content = payload?.text || payload?.output || payload?.message || "";
        if (suppressed || !content) return;
        appendAssistantMessage(content);
      } catch (error) {
        console.error("[socket] ungoverned-output handler failed", error, payload);
      }
    };

    const handleGilEvent = (msg) => {
      try {
        const state = msg?.state;
        if (state === "green") setGilState("green");
        else if (state === "red") setGilState("red");
        else if (state === "amber") setGilState("amber");
        else setGilState("idle");
      } catch (error) {
        console.error("[socket] gil-event handler failed", error, msg);
      }
    };

    const handleGovernanceClarification = (payload) => {
      try {
        const question =
          payload?.payload?.question ||
          payload?.question ||
          "Please clarify the key constraint.";
        setCycleStatus("Idle");
        setPendingClarification({
          question,
          runId: payload?.runId || null,
          sessionId: payload?.sessionId || getStore.getState().activeSessionId,
        });
        setMessages((prev) => {
          const nextId = (prev[prev.length - 1]?.id || 0) + 1;
          return [
            ...prev,
            {
              id: nextId,
              role: "assistant",
              author: "cd\\ai Moderator",
              text: question,
              timestamp: Date.now(),
            },
          ];
        });
        emitDeliveryAck(payload?.ackId, payload?.sessionId);
      } catch (error) {
        console.error("[socket] governance-clarification handler failed", error, payload);
      }
    };

    const handleClarificationAccepted = (payload = {}) => {
      try {
        setPendingClarification(null);
        setCycleStatus("Idle");
        emitDeliveryAck(payload?.ackId, payload?.sessionId);
      } catch (error) {
        console.error("[socket] clarification-accepted handler failed", error, payload);
      }
    };

    socket.on("connect", handleSocketConnect);
    socket.on("telemetry", handleTelemetry);
    socket.on("workflow-output", handleWorkflowOutput);
    socket.on("workflow-finished", handleWorkflowFinished);
    socket.on("governed-output", handleGovernedOutput);
    socket.on("parsed-rules", handleParsedRulesEvent);
    socket.on("governance-rules", handleParsedRulesEvent);
    socket.on("ungoverned-output", handleUngovernedOutput);
    socket.on("gil-event", handleGilEvent);
    socket.on("governance-clarification", handleGovernanceClarification);
    socket.on("clarification-accepted", handleClarificationAccepted);
    socket.on("governance-errors", handleGovernanceErrors);
    socket.on("governance-error", handleGovernanceErrors);
    socket.on("data-scope-mode-initial", handleModeEvent);
    socket.on("data-scope-mode-updated", handleModeEvent);
    socket.on("governance-mode-initial", handleGovernanceModeEvent);
    socket.on("governance-mode-updated", handleGovernanceModeEvent);
    socket.on("governance-notice", handleGovernanceNotice);

    return () => {
      socket.off("connect", handleSocketConnect);
      socket.off("telemetry", handleTelemetry);
      socket.off("workflow-output", handleWorkflowOutput);
      socket.off("workflow-finished", handleWorkflowFinished);
      socket.off("governed-output", handleGovernedOutput);
      socket.off("parsed-rules", handleParsedRulesEvent);
      socket.off("governance-rules", handleParsedRulesEvent);
      socket.off("ungoverned-output", handleUngovernedOutput);
      socket.off("gil-event", handleGilEvent);
      socket.off("governance-clarification", handleGovernanceClarification);
      socket.off("clarification-accepted", handleClarificationAccepted);
      socket.off("governance-errors", handleGovernanceErrors);
      socket.off("governance-error", handleGovernanceErrors);
      socket.off("data-scope-mode-initial", handleModeEvent);
      socket.off("data-scope-mode-updated", handleModeEvent);
      socket.off("governance-mode-initial", handleGovernanceModeEvent);
      socket.off("governance-mode-updated", handleGovernanceModeEvent);
      socket.off("governance-notice", handleGovernanceNotice);
    };
  }, [
    addAnalyticalLog,
    addCreativeLog,
    addError,
    addGovernanceNotice,
    addMcpEvent,
    addMatrixEvaluation,
    addValidationEvent,
    addDeliveryWarning,
    addLedgerEvent,
    addModeratorLog,
    resetLogs,
    setCycleStatus,
    setCanonicalTrace,
    setExternalReferences,
    setCurrentCycle,
    setCyclePlan,
    setDataScopeMode,
    setGovernanceModeStore,
    setGilState,
    setStrictnessLevel,
    setRules,
    startSession,
    setPendingClarification,
    addDeliveryFailure,
    removeDeliveryFailure,
    formatTelemetryTimestamp,
    getStore,
    appendAssistantMessage,
  ]);

  useEffect(() => {
    const mcpEvents = [
      "mcp:cycle_start",
      "mcp:enter_analytical",
      "mcp:enter_moderator_1",
      "mcp:enter_creative",
      "mcp:enter_moderator_2",
      "mcp:enter_validator",
      "mcp:cycle_complete",
      "mcp:clarification_required",
      "mcp:clarification_received",
    ];

    const formatLabel = (eventName, cycle) => {
      const label = eventName.replace("mcp:", "").replace(/_/g, " ").toUpperCase();
      return cycle != null ? `${label} — Cycle ${cycle}` : label;
    };

    const handlers = mcpEvents.map((eventName) => {
      const handler = (payload = {}) => {
        try {
          const cycle = typeof payload.cycle === "number" ? payload.cycle : undefined;
          addMcpEvent(formatLabel(eventName, cycle), cycle);
          if (eventName === "mcp:cycle_complete" && typeof payload.cycle === "number") {
            setCurrentCycle(payload.cycle);
          }
        } catch (error) {
          console.error(`[socket] ${eventName} handler failed`, error, payload);
        }
      };
      socket.on(eventName, handler);
      return { eventName, handler };
    });

    return () => {
      handlers.forEach(({ eventName, handler }) => socket.off(eventName, handler));
    };
  }, [addMcpEvent, setCurrentCycle]);

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [handleMouseMove, handleResizeEnd]);

  return (
    <PanelLayoutProvider layoutProp={canvasLayout} panelsProp={canvasPanels} hiddenPanelsProp={headerPanels}>
      <div className="app-shell bg-black text-cdai-text">
        {globalBanner && (
          <div
            className="global-alert"
            style={{
              background: globalBanner.type === "mode-change-blocked" ? "#f59e0b" : "#ef4444",
              color: "#0b0b0b",
              padding: "10px 16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontFamily: "Arimo, sans-serif", fontSize: 12, fontWeight: 600 }}>{globalBanner.message}</span>
            <button
              type="button"
              onClick={() => setGlobalBanner(null)}
              style={{ fontSize: 11, fontWeight: 700, color: "#0b0b0b" }}
            >
              Dismiss
            </button>
          </div>
        )}
        {simulationBannerActive && (
          <div
            style={{
              background: "#1f2937",
              color: "#fef08a",
              padding: "8px 14px",
              fontFamily: "Arimo, sans-serif",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Design-Only Simulation -- Non-Operational Output
          </div>
        )}
        {governanceMode === "simulation" && (
          <div
            style={{
              background: "#10b981",
              color: "#0b0b0b",
              padding: "8px 14px",
              fontFamily: "Arimo, sans-serif",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Governance Simulation Mode enabled -- fictional or synthetic data will run as design-only simulations.
          </div>
        )}
        {governanceMode === "phi_compliant" && (
          <div
            style={{
              background: "#f59e0b",
              color: "#0b0b0b",
              padding: "8px 14px",
              fontFamily: "Arimo, sans-serif",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            PHI-Compliant Governance Mode (preview) -- additional safeguards pending future release.
          </div>
        )}
      <Header
        onLogout={onLogout}
        governanceMode={governanceMode}
        panelOptions={panelPaletteOptions}
        onPanelSelect={handlePanelCommandSelect}
        layoutId={canvasLayout}
        onLayoutChange={handleLayoutSelect}
        headerPanels={headerPanels}
        onHeaderPanelSelect={handleHeaderPanelSelect}
        onHeaderPanelClose={handleHeaderPanelClose}
      />
      <main className="app-main">
        <div className="middle-container" ref={containerRef}>
          <section
            className="chat-panel bg-cdai-body border border-cdai-border rounded-none relative"
            style={{
              width: `${chatWidthPct}%`,
              flex: `0 0 ${chatWidthPct}%`,
              maxWidth: `${maxPct}%`,
              minWidth: `${minPct}%`,
              flexShrink: 0,
            }}
          >
            <ChatPanel>
              <Sidebar
                onToggleHistory={() => setIsHistoryOpen((v) => !v)}
                isHistoryOpen={isHistoryOpen}
                onNewChat={() => setMessages([])}
                onOpenPanel={handleSidebarPanelOpen}
              />
              <ChatHistoryDrawer
                open={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
              />
              <div className="chat-body">
                <ChatMessagesList messages={sortedMessages} />
              </div>
              <ChatInputBar
                onSend={handleSend}
                pendingClarification={pendingClarification}
                onSubmitClarification={handleClarificationSubmit}
                disableChat={!!pendingClarification}
                inputRef={chatInputRef}
              />
            </ChatPanel>
          </section>
          <div
            className="vertical-divider bg-cdai-border rounded-none"
            aria-hidden
            onMouseDown={handleResizeStart}
            style={{
              cursor: "col-resize",
              width: 6,
              background: isResizing ? "#007aff" : undefined,
            }}
          />
          <CanvasPanel panelsOverride={canvasPanels} layoutOverride={canvasLayout} onPanelClose={handleCanvasPanelClose} />
        </div>
      </main>
      <Footer />
      {headerOverflowPrompt && (
        <div
          className="panel-overflow-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            className="panel-overflow-modal"
            style={{
              background: "#0f0f0f",
              border: "1px solid #2d2d2d",
              borderRadius: 12,
              padding: 24,
              width: "90%",
              maxWidth: 520,
              color: "#f5f5f5",
              boxShadow: "0 20px 60px rgba(0,0,0,0.65)",
              fontFamily: "Arimo, sans-serif",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 18, fontWeight: 600 }}>Header is full</h3>
            <p style={{ marginBottom: 16, color: "#d1d5db", fontSize: 13 }}>
              Choose a panel to close so I can keep <strong>{headerOverflowPrompt.pendingAdds?.[0]?.title || "the displaced panel"}</strong> available in the header.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {headerOverflowPrompt.pendingHeader?.map((panel) => (
                <label
                  key={panel.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,0.3)",
                    background: headerPromptSelection === panel.component ? "rgba(37,99,235,0.18)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="panel-close-choice"
                    value={panel.component}
                    checked={headerPromptSelection === panel.component}
                    onChange={() => setHeaderPromptSelection(panel.component)}
                  />
                  <span>{panel.title}</span>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button
                type="button"
                onClick={handleHeaderOverflowCancel}
                style={{
                  background: "transparent",
                  border: "1px solid #374151",
                  color: "#f5f5f5",
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!headerPromptSelection}
                onClick={handleHeaderOverflowConfirm}
                style={{
                  background: headerPromptSelection ? "#2563eb" : "#1f2937",
                  border: "none",
                  color: "#fff",
                  padding: "8px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  opacity: headerPromptSelection ? 1 : 0.6,
                  cursor: headerPromptSelection ? "pointer" : "not-allowed",
                }}
              >
                Close Selected Panel
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      <CommandPaletteModal open={isCommandPaletteOpen} onClose={closeCommandPalette} commands={commandPaletteCommands} />
    </PanelLayoutProvider>
  );
}
