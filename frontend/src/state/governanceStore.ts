import { create } from "zustand";

type CycleStatus = "Idle" | "Analytical" | "Moderator" | "Creative" | "Validator";
type GilState = "idle" | "green" | "amber" | "red";

export interface LogEntry {
  id: string;
  timestamp: string;
  text: string;
  cycle?: number;
  phase?: string;
  decision?: string;
  hemisphere?: string;
  strictness?: number | string | null;
  ruleIds?: string[];
  rationale?: string;
  meta?: Record<string, any>;
}

export interface LedgerEntry {
  id: string;
  text: string;
  cycle?: number;
  stage?: string;
  timestamp?: string;
  decision?: string;
  hemisphere?: string;
  strictness?: number | string | null;
  ruleIds?: string[];
  rationale?: string;
  snippet?: string;
  simulationMode?: boolean;
  simulationAdvisory?: string;
}

interface ArchivedSession {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  normalizedRules: any[];
  analyticalLog: LogEntry[];
  analyticalOutput: LogEntry[];
  moderatorLog: LogEntry[];
  moderatorOutputPre: LogEntry[];
  moderatorOutputPost: LogEntry[];
  creativeLog: LogEntry[];
  creativeOutput: LogEntry[];
  ledgerEvents: LedgerEntry[];
  validatorOutput: LogEntry[];
  validationSignals: LogEntry[];
  dataScopeMode: "work" | "web";
  governanceMode: "strict" | "simulation" | "phi_compliant";
  strictnessLevel: number | null;
  canonicalTrace: GovernanceState["canonicalTrace"];
  canonicalTraceHistory: GovernanceState["canonicalTraceHistory"];
  externalReferences: string[];
}

type DeliveryIssueEntry = LogEntry & {
  ackId?: string;
  sessionId?: string | null;
  event?: string;
};

interface GovernanceState {
  activeSessionId: string | null;
  activeStartedAt: string | null;
  normalizedRules: any[];
  dataScopeMode: "work" | "web";
  governanceMode: "strict" | "simulation" | "phi_compliant";
  strictnessLevel: number | null;
  governanceStrictnessSetting: number;
  cycleLimitSetting: number;
  perfMode: "real" | "fast" | "turbo";
  cyclePlan: number | null;
  currentCycle: number | null;
  cycleStatus: CycleStatus;
  gilState: GilState;
  pendingClarification: { question: string; runId: string | null; sessionId: string | null } | null;
  analyticalLog: LogEntry[];
  analyticalOutput: LogEntry[];
  moderatorLog: LogEntry[];
  moderatorOutputPre: LogEntry[];
  moderatorOutputPost: LogEntry[];
  creativeLog: LogEntry[];
  creativeOutput: LogEntry[];
  ledgerEvents: LedgerEntry[];
  governanceErrors: LogEntry[];
  governanceNotices: LogEntry[];
  canonicalTrace: {
    core?: Record<string, any>;
    dataScope?: Record<string, any>;
  } | null;
  canonicalTraceHistory: Array<{
    cycle: number | null;
    timestamp: string;
    core?: Record<string, any>;
    dataScope?: Record<string, any>;
  }>;
  mcpTimeline: LogEntry[];
  matrixEvaluations: LogEntry[];
  validationEvents: LogEntry[];
  validatorOutput: LogEntry[];
  validationSignals: LogEntry[];
  externalReferences: string[];
  deliveryWarnings: LogEntry[];
  deliveryFailures: DeliveryIssueEntry[];
  archivedSessions: ArchivedSession[];
  startSession: (sessionId: string) => void;
  endSession: () => void;
  setRules: (rules: any[]) => void;
  setDataScopeMode: (mode: "work" | "web") => void;
  setGovernanceMode: (mode: "strict" | "simulation" | "phi_compliant") => void;
  setStrictnessLevel: (level: number | null) => void;
  setGovernanceStrictnessSetting: (level: number) => void;
  setCycleLimitSetting: (limit: number) => void;
  setPerfMode: (mode: "real" | "fast" | "turbo") => void;
  setCyclePlan: (plan: number | null) => void;
  setCurrentCycle: (cycle: number | null) => void;
  setCanonicalTrace: (trace: { core?: Record<string, any>; dataScope?: Record<string, any>; cycle?: number | null }) => void;
  setExternalReferences: (refs: string[]) => void;
  setCycleStatus: (status: CycleStatus) => void;
  setGilState: (state: GilState) => void;
  setPendingClarification: (payload: { question: string; runId?: string | null; sessionId?: string | null } | null) => void;
  addAnalyticalLog: (text: string, cycle?: number) => void;
  addModeratorLog: (payload: { text: string; cycle?: number; phase?: string; timestamp?: string }) => void;
  addCreativeLog: (text: string, cycle?: number) => void;
  addLedgerEvent: (entry: {
    text: string;
    cycle?: number;
    stage?: string;
    timestamp?: string;
    decision?: string;
    hemisphere?: string;
    strictness?: number | string | null;
    ruleIds?: string[];
    rationale?: string;
    snippet?: string;
    simulationMode?: boolean;
    simulationAdvisory?: string;
  }) => void;
  addError: (text: string) => void;
  addGovernanceNotice: (text: string) => void;
  addMcpEvent: (text: string, cycle?: number) => void;
  addMatrixEvaluation: (text: string, cycle?: number) => void;
  addValidationEvent: (text: string, cycle?: number, extras?: Partial<LogEntry>) => void;
  addDeliveryFailure: (entry: { text: string; ackId?: string; sessionId?: string | null; event?: string }) => void;
  removeDeliveryFailure: (ackId?: string) => void;
  resetLogs: () => void;
}

const fmtTimestamp = () =>
  new Date().toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

const makeLog = (text: string, cycle?: number, extras: Partial<LogEntry> = {}): LogEntry => {
  const { timestamp: providedTimestamp, ...rest } = extras || {};
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: providedTimestamp || fmtTimestamp(),
    text,
    cycle,
    ...rest,
  };
};

const makeLedger = (entry: {
  text: string;
  cycle?: number;
  stage?: string;
  timestamp?: string;
  decision?: string;
  hemisphere?: string;
  strictness?: number | string | null;
  ruleIds?: string[];
  rationale?: string;
  snippet?: string;
  simulationMode?: boolean;
  simulationAdvisory?: string;
}): LedgerEntry => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  text: entry.text,
  cycle: entry.cycle,
  stage: entry.stage,
  timestamp: entry.timestamp || fmtTimestamp(),
  decision: entry.decision,
  hemisphere: entry.hemisphere,
  strictness: entry.strictness,
  ruleIds: entry.ruleIds,
  rationale: entry.rationale,
  snippet: entry.snippet,
  simulationMode: entry.simulationMode,
  simulationAdvisory: entry.simulationAdvisory,
});

export const useGovernanceStore = create<GovernanceState>((set, get) => ({
  activeSessionId: null,
  activeStartedAt: null,
  normalizedRules: [],
  dataScopeMode: "work",
  governanceMode: "strict",
  strictnessLevel: null,
  governanceStrictnessSetting: 0.85,
  cycleLimitSetting: 0,
  perfMode: "real",
  cyclePlan: null,
  currentCycle: null,
  cycleStatus: "Idle",
  gilState: "idle",
  pendingClarification: null,
  analyticalLog: [],
  analyticalOutput: [],
  moderatorLog: [],
  moderatorOutputPre: [],
  moderatorOutputPost: [],
  creativeLog: [],
  creativeOutput: [],
  ledgerEvents: [],
  governanceErrors: [],
  governanceNotices: [],
  canonicalTrace: null,
  canonicalTraceHistory: [],
  mcpTimeline: [],
  matrixEvaluations: [],
  validationEvents: [],
  validatorOutput: [],
  validationSignals: [],
  externalReferences: [],
  deliveryWarnings: [],
  deliveryFailures: [] as DeliveryIssueEntry[],
  archivedSessions: [],

  startSession: (sessionId: string) =>
    set((state) => {
      const archived = state.activeSessionId
        ? [
            ...state.archivedSessions,
            {
              id: state.activeSessionId,
              startedAt: state.activeStartedAt,
              endedAt: new Date().toISOString(),
              normalizedRules: state.normalizedRules,
              analyticalLog: state.analyticalLog,
              analyticalOutput: state.analyticalOutput,
              moderatorLog: state.moderatorLog,
              moderatorOutputPre: state.moderatorOutputPre,
              moderatorOutputPost: state.moderatorOutputPost,
              creativeLog: state.creativeLog,
              creativeOutput: state.creativeOutput,
              ledgerEvents: state.ledgerEvents,
              validatorOutput: state.validatorOutput,
              validationSignals: state.validationSignals,
              dataScopeMode: state.dataScopeMode,
              governanceMode: state.governanceMode,
              strictnessLevel: state.strictnessLevel,
              canonicalTrace: state.canonicalTrace,
        canonicalTraceHistory: state.canonicalTraceHistory.map((entry) => ({ ...entry })),
        externalReferences: state.externalReferences.slice(),
      },
    ]
        : state.archivedSessions;
      return {
        archivedSessions: archived,
        activeSessionId: sessionId,
        activeStartedAt: new Date().toISOString(),
        normalizedRules: [],
        dataScopeMode: state.dataScopeMode,
        governanceMode: state.governanceMode,
        strictnessLevel: state.strictnessLevel,
        cyclePlan: state.cyclePlan,
        currentCycle: state.currentCycle,
        cycleStatus: "Idle",
        gilState: "idle",
        pendingClarification: null,
        analyticalLog: [],
        analyticalOutput: [],
        moderatorLog: [],
        moderatorOutputPre: [],
        moderatorOutputPost: [],
        creativeLog: [],
        creativeOutput: [],
        ledgerEvents: [],
        governanceErrors: [],
        governanceNotices: [],
        mcpTimeline: [],
        matrixEvaluations: [],
        validationEvents: [],
        validatorOutput: [],
        validationSignals: [],
        externalReferences: [],
        canonicalTrace: null,
        canonicalTraceHistory: [],
        deliveryWarnings: [],
        deliveryFailures: [] as DeliveryIssueEntry[],
      };
    }),

  endSession: () =>
    set((state) => {
      if (!state.activeSessionId) return state;
      return {
        archivedSessions: [
          ...state.archivedSessions,
          {
            id: state.activeSessionId,
            startedAt: state.activeStartedAt,
            endedAt: new Date().toISOString(),
            normalizedRules: state.normalizedRules,
            analyticalLog: state.analyticalLog,
            moderatorLog: state.moderatorLog,
              creativeLog: state.creativeLog,
              analyticalOutput: state.analyticalOutput,
              moderatorOutputPre: state.moderatorOutputPre,
              moderatorOutputPost: state.moderatorOutputPost,
              creativeOutput: state.creativeOutput,
              ledgerEvents: state.ledgerEvents,
              validatorOutput: state.validatorOutput,
              validationSignals: state.validationSignals,
              dataScopeMode: state.dataScopeMode,
              governanceMode: state.governanceMode,
              strictnessLevel: state.strictnessLevel,
            canonicalTrace: state.canonicalTrace,
            canonicalTraceHistory: state.canonicalTraceHistory.map((entry) => ({ ...entry })),
            externalReferences: state.externalReferences.slice(),
          },
        ],
        activeSessionId: null,
        activeStartedAt: null,
        normalizedRules: [],
        dataScopeMode: state.dataScopeMode,
        governanceMode: state.governanceMode,
        strictnessLevel: state.strictnessLevel,
        cyclePlan: state.cyclePlan,
        currentCycle: state.currentCycle,
        cycleStatus: "Idle",
        gilState: "idle",
        pendingClarification: null,
        analyticalLog: [],
        analyticalOutput: [],
        moderatorLog: [],
        moderatorOutputPre: [],
        moderatorOutputPost: [],
        creativeLog: [],
        creativeOutput: [],
        ledgerEvents: [],
        governanceErrors: [],
        governanceNotices: [],
        mcpTimeline: [],
        matrixEvaluations: [],
        validationEvents: [],
        validatorOutput: [],
        validationSignals: [],
        externalReferences: [],
        canonicalTrace: null,
        canonicalTraceHistory: [],
        deliveryWarnings: [],
        deliveryFailures: [] as DeliveryIssueEntry[],
      };
    }),

  setRules: (rules) => set({ normalizedRules: rules || [] }),
  setDataScopeMode: (mode) =>
    set({
      dataScopeMode: mode === "web" ? "web" : "work",
    }),
  setGovernanceMode: (mode) =>
    set({
      governanceMode: mode === "simulation" ? "simulation" : mode === "phi_compliant" ? "phi_compliant" : "strict",
    }),
  setStrictnessLevel: (level) => set({ strictnessLevel: level }),
  setGovernanceStrictnessSetting: (level) =>
    set({
      governanceStrictnessSetting: Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0.85)),
    }),
  setCycleLimitSetting: (limit) =>
    set({
      cycleLimitSetting: Math.max(0, Number.isFinite(limit) ? Math.round(limit) : 0),
    }),
  setPerfMode: (mode) =>
    set({
      perfMode: mode === "fast" || mode === "turbo" ? mode : "real",
    }),
  setCyclePlan: (plan) => set({ cyclePlan: plan }),
  setCurrentCycle: (cycle) => set({ currentCycle: cycle }),
  setCanonicalTrace: (trace) =>
    set((s) => ({
      canonicalTrace: {
        core: trace.core || s.canonicalTrace?.core,
        dataScope: trace.dataScope || s.canonicalTrace?.dataScope,
      },
        canonicalTraceHistory: [
          ...s.canonicalTraceHistory.slice(-40),
          {
            cycle: typeof trace.cycle === "number" ? trace.cycle : null,
          timestamp: new Date().toISOString(),
          core: trace.core || s.canonicalTrace?.core,
          dataScope: trace.dataScope || s.canonicalTrace?.dataScope,
        },
      ],
    })),
  setExternalReferences: (refs) => set({ externalReferences: refs || [] }),
  setCycleStatus: (status) => set({ cycleStatus: status }),
  setGilState: (state) => set({ gilState: state }),
  setPendingClarification: (payload) => set({ pendingClarification: payload }),
  addAnalyticalLog: (text, cycle) =>
    set((s) => {
      const entry = makeLog(text, cycle);
      const next = [...s.analyticalLog, entry];
      return { analyticalLog: next, analyticalOutput: next };
    }),
  addModeratorLog: (payload) =>
    set((s) => {
      if (!payload || typeof payload.text !== "string") {
        return s;
      }
      const rawPhase = (payload.phase || "").toLowerCase();
      const normalizedPhase = rawPhase.includes("post") ? "post" : "pre";
      const isPost = normalizedPhase === "post";
      let formattedTimestamp: string | undefined;
      if (payload.timestamp) {
        const parsed = Date.parse(payload.timestamp);
        if (!Number.isNaN(parsed)) {
          formattedTimestamp = new Date(parsed).toLocaleString("en-US", {
            month: "2-digit",
            day: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          });
        }
      }
      const entry = makeLog(payload.text, payload.cycle, {
        phase: normalizedPhase,
        timestamp: formattedTimestamp,
        meta: {
          ...((payload.phase && { phase: payload.phase }) || {}),
          rawTimestamp: payload.timestamp,
        },
      });
      const nextLog = [...s.moderatorLog, entry];
      const nextPre = isPost ? s.moderatorOutputPre : [...s.moderatorOutputPre, entry];
      const nextPost = isPost ? [...s.moderatorOutputPost, entry] : s.moderatorOutputPost;
      return {
        moderatorLog: nextLog,
        moderatorOutputPre: nextPre,
        moderatorOutputPost: nextPost,
      };
    }),
  addCreativeLog: (text, cycle) =>
    set((s) => {
      const entry = makeLog(text, cycle);
      const next = [...s.creativeLog, entry];
      return { creativeLog: next, creativeOutput: next };
    }),
  addLedgerEvent: (entry) => set((s) => ({ ledgerEvents: [...s.ledgerEvents, makeLedger(entry)] })),
  addError: (text) =>
    set((s) => ({
      governanceErrors: [...s.governanceErrors, makeLog(text)],
      ledgerEvents: [...s.ledgerEvents, makeLedger({ text })],
    })),
  addGovernanceNotice: (text) =>
    set((s) => ({
      governanceNotices: [...s.governanceNotices, makeLog(text)],
    })),
  addMcpEvent: (text, cycle) =>
    set((s) => ({
      mcpTimeline: [...s.mcpTimeline.slice(-40), makeLog(text, cycle)],
    })),
  addMatrixEvaluation: (text, cycle) =>
    set((s) => ({
      matrixEvaluations: [...s.matrixEvaluations.slice(-20), makeLog(text, cycle)],
    })),
  addValidationEvent: (text, cycle, extras) =>
    set((s) => {
      const entry = makeLog(text, cycle, extras);
      const next = [...s.validationEvents.slice(-20), entry];
      return {
        validationEvents: next,
        validatorOutput: next,
        validationSignals: next,
      };
    }),
  addDeliveryWarning: (text) =>
    set((s) => ({
      deliveryWarnings: [...s.deliveryWarnings.slice(-10), makeLog(text)],
    })),
  addDeliveryFailure: (entry: { text: string; ackId?: string; sessionId?: string | null; event?: string }) =>
    set((s) => {
      const record: DeliveryIssueEntry = { ...makeLog(entry.text), ackId: entry.ackId, sessionId: entry.sessionId, event: entry.event };
      return {
        deliveryFailures: [...s.deliveryFailures.slice(-10), record],
      };
    }),
  removeDeliveryFailure: (ackId) =>
    set((s) => ({
      deliveryFailures: ackId ? s.deliveryFailures.filter((entry) => entry.ackId !== ackId) : [],
    })),
  resetLogs: () =>
    set({
      analyticalLog: [],
      analyticalOutput: [],
      moderatorLog: [],
      moderatorOutputPre: [],
      moderatorOutputPost: [],
      creativeLog: [],
      creativeOutput: [],
      ledgerEvents: [],
      governanceErrors: [],
      governanceNotices: [],
      mcpTimeline: [],
      matrixEvaluations: [],
      validationEvents: [],
      validatorOutput: [],
      validationSignals: [],
      externalReferences: [],
      deliveryWarnings: [],
      deliveryFailures: [] as DeliveryIssueEntry[],
      cycleStatus: "Idle",
      gilState: "idle",
    }),
}));

export type { CycleStatus, GilState };
