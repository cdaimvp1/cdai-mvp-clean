import { useCallback } from "react";
import socket from "../socket";
import type { PanelId } from "./panelTypes";
import { getPanelDisplayName } from "./panelTypes";

interface PanelInvokerOptions {
  openPanelHandler: (panelId: PanelId, opts?: InvokePanelOptions) => void;
}

interface InvokePanelContext {
  source?: string;
  sessionId?: string | null;
  utterance?: string;
  reason?: string;
}

interface InvokePanelOptions {
  replaceOnly?: boolean;
}

interface InvokePanelResult {
  opened: boolean;
  reason?: string;
}

const PANELS_REQUIRING_APPROVAL: PanelId[] = ["ledger", "archivedLedger", "govControls"];
const panelNeedsApproval = (panelId: PanelId) => PANELS_REQUIRING_APPROVAL.includes(panelId);
let panelRequestCounter = 0;
const APPROVAL_TIMEOUT_MS = 2500;

function requestPanelAccess(panelId: PanelId, context: InvokePanelContext = {}): Promise<{ allowed: boolean; message?: string }> {
  return new Promise((resolve) => {
    const requestId = `panel-${Date.now()}-${panelRequestCounter++}`;
    const cleanup = (handler: (response?: any) => void, timeoutId: ReturnType<typeof setTimeout>) => {
      socket.off("panel-invocation-response", handler);
      clearTimeout(timeoutId);
    };

    const handler = (response: any = {}) => {
      if (response?.requestId !== requestId) return;
      cleanup(handler, timer);
      resolve({ allowed: response.allowed !== false, message: response.message });
    };

    const timer = setTimeout(() => {
      cleanup(handler, timer);
      resolve({ allowed: true, message: "Timed out waiting for approval; defaulting to allow." });
    }, APPROVAL_TIMEOUT_MS);

    socket.on("panel-invocation-response", handler);
    socket.emit("panel-invocation-request", {
      panelKey: panelId,
      requestId,
      context,
      timestamp: Date.now(),
    });
  });
}

export function usePanelInvoker({ openPanelHandler }: PanelInvokerOptions) {
  const openPanel = useCallback(
    (panelId: PanelId, opts: InvokePanelOptions = {}) => {
      if (!panelId) return;
      openPanelHandler(panelId, opts);
    },
    [openPanelHandler]
  );

  const invokePanel = useCallback(
    async (panelId: PanelId, context: InvokePanelContext = {}, opts: InvokePanelOptions = {}): Promise<InvokePanelResult> => {
      if (!panelId) return { opened: false, reason: "No panel specified." };

      if (panelNeedsApproval(panelId)) {
        const approval = await requestPanelAccess(panelId, context);
        if (!approval.allowed) {
          return { opened: false, reason: approval.message || "Panel access denied." };
        }
      }

      openPanel(panelId, opts);
      socket.emit("panel-open", {
        panelKey: panelId,
        sessionId: context.sessionId || null,
        context,
        timestamp: Date.now(),
      });
      return { opened: true };
    },
    [openPanel]
  );

  return {
    invokePanel,
    getPanelTitle: getPanelDisplayName,
  };
}
