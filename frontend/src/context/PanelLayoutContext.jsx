import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

import {
  IconLayoutDefault,
  IconLayout1,
  IconLayout2,
  IconLayout3,
  IconLayout4,
  IconLayout5,
  IconLayout6,
} from "../components/icons";

const PANEL_TYPE_SEEDS = ["Dashboard", "Analytics", "Reports", "Settings", "Workflow", "Data", "Charts", "Tasks"];

export const PANEL_LAYOUTS = [
  {
    id: "1panel",
    icon: IconLayoutDefault,
    slots: 1,
    grid: [["A"]],
  },
  {
    id: "2v",
    icon: IconLayout1,
    slots: 2,
    grid: [["A", "B"]],
  },
  {
    id: "2h",
    icon: IconLayout2,
    slots: 2,
    grid: [
      ["A"],
      ["B"],
    ],
  },
  {
    id: "3grid",
    icon: IconLayout3,
    slots: 3,
    grid: [
      ["A", "A"],
      ["B", "C"],
    ],
  },
  {
    id: "4grid",
    icon: IconLayout4,
    slots: 4,
    grid: [
      ["A", "B"],
      ["C", "D"],
    ],
  },
  {
    id: "tallLeft2",
    icon: IconLayout5,
    slots: 3,
    grid: [
      ["A", "B"],
      ["A", "C"],
    ],
  },
  {
    id: "tallLeft3",
    icon: IconLayout6,
    slots: 4,
    grid: [
      ["A", "B"],
      ["A", "C"],
      ["A", "D"],
    ],
  },
];

export const getRequiredPanelsForLayout = (layoutId) =>
  PANEL_LAYOUTS.find((layout) => layout.id === layoutId)?.slots || 1;

const samplePanels = [
  { id: "p1", title: "Governance Console", content: "Governance settings and constraints. TODO: wire governed artifacts." },
  { id: "p2", title: "Ledger", content: "Compliance ledger stream. TODO: governed data feed." },
  { id: "p3", title: "Workflow Status", content: "Active workflow cycles. TODO: real-time updates." },
  { id: "p4", title: "Narrative", content: "Narrative outputs. TODO: connect narrative builder." },
  { id: "p5", title: "Risk Register", content: "Risk items and mitigations." },
  { id: "p6", title: "Tasks", content: "Open tasks and ownership." },
  { id: "p7", title: "Pinned Panels", content: "Pinned artifacts." },
  { id: "p8", title: "Analytics", content: "Analytics and metrics." },
];

const PanelLayoutContext = createContext({
  layout: "2v",
  layoutVersion: 0,
  setLayout: () => {},
  visiblePanels: [],
  hiddenPanels: [],
  swapPanels: () => {},
  showPanel: () => {},
  hidePanel: () => {},
  reorderVisible: () => {},
  ensurePanelsForLayout: () => {},
  setPanels: () => {},
});

export function PanelLayoutProvider({ children, layoutProp, panelsProp, hiddenPanelsProp }) {
  const [layout, setLayout] = useState("1panel");
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [visiblePanels, setVisiblePanels] = useState(samplePanels.slice(0, 1));
  const [hiddenPanels, setHiddenPanels] = useState(samplePanels.slice(1, 1));

  const applyLayout = useCallback((nextLayout) => {
    setLayout(nextLayout);
    setLayoutVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (layoutProp) {
      applyLayout(layoutProp);
    }
  }, [applyLayout, layoutProp]);

  useEffect(() => {
    if (Array.isArray(panelsProp)) {
      setVisiblePanels(panelsProp);
      setHiddenPanels([]);
    }
  }, [panelsProp]);

  useEffect(() => {
    if (Array.isArray(hiddenPanelsProp)) {
      setHiddenPanels(hiddenPanelsProp);
    }
  }, [hiddenPanelsProp]);

  const ensurePanelsForLayout = useCallback(
    (layoutId) => {
      const requiredPanels = getRequiredPanelsForLayout(layoutId);
      applyLayout(layoutId);

      setVisiblePanels((currentVisible) => {
        if (currentVisible.length >= requiredPanels) return currentVisible;

        const nextVisible = [...currentVisible];
        let remaining = requiredPanels - nextVisible.length;
        let updatedHidden = hiddenPanels;

        if (remaining > 0 && hiddenPanels.length) {
          const bringForward = hiddenPanels.slice(0, remaining);
          nextVisible.push(...bringForward);
          remaining -= bringForward.length;
          updatedHidden = hiddenPanels.slice(bringForward.length);
        }

        if (updatedHidden !== hiddenPanels) {
          setHiddenPanels(updatedHidden);
        }

        if (remaining > 0) {
          const existingNumbers = [...nextVisible, ...hiddenPanels]
            .map((panel) => parseInt(String(panel.id).replace(/\D+/g, ""), 10))
            .filter((num) => !Number.isNaN(num));
          let counter = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;

          for (let i = 0; i < remaining; i++) {
            const panelType = PANEL_TYPE_SEEDS[(counter + i - 1) % PANEL_TYPE_SEEDS.length];
            const panelNumber = counter + i;
            nextVisible.push({
              id: `p${panelNumber}`,
              title: `${panelType} ${panelNumber}`,
              content: `Content for ${panelType.toLowerCase()} panel ${panelNumber}. This panel was automatically added to fill the ${layoutId} layout.`,
            });
          }
        }

        return nextVisible;
      });
    },
    [applyLayout, hiddenPanels]
  );

  const swapPanels = useCallback(
    (hiddenId, visibleId) => {
      setVisiblePanels((vp) => {
        const visibleIdx = vp.findIndex((p) => p.id === visibleId);
        const hidden = hiddenPanels.find((p) => p.id === hiddenId);
        if (visibleIdx === -1 || !hidden) return vp;
        const newVisible = [...vp];
        const displaced = newVisible[visibleIdx];
        newVisible[visibleIdx] = hidden;
        setHiddenPanels((hp) => {
          const filtered = hp
            .filter((p) => p.id !== hiddenId)
            .filter((p) => !displaced || p.id !== displaced.id);
          const nextHidden = displaced ? [...filtered, displaced].slice(0, 7) : filtered.slice(0, 7);
          return nextHidden;
        });
        return newVisible;
      });
    },
    [hiddenPanels]
  );

  const showPanel = useCallback((panelId) => {
    setHiddenPanels((hp) => {
      const target = hp.find((p) => p.id === panelId);
      if (!target) return hp;
      setVisiblePanels((vp) => {
        const maxVisible = 8;
        const capped = vp.slice(0, maxVisible);
        const displaced = capped.length >= maxVisible ? capped[capped.length - 1] : null;
        const updatedVisible = [...capped.slice(0, maxVisible - 1), target].slice(0, maxVisible);
        setHiddenPanels((innerHp) => {
          const withoutTarget = innerHp.filter((p) => p.id !== panelId);
          return displaced ? [...withoutTarget, displaced] : withoutTarget;
        });
        return updatedVisible;
      });
      return hp.filter((p) => p.id !== panelId);
    });
  }, []);

  const hidePanel = useCallback((panelId) => {
    setVisiblePanels((vp) => vp.filter((p) => p.id !== panelId));
  }, []);

  const reorderVisible = useCallback((sourceId, targetId) => {
    setVisiblePanels((vp) => {
      const sourceIdx = vp.findIndex((p) => p.id === sourceId);
      const targetIdx = vp.findIndex((p) => p.id === targetId);
      if (sourceIdx === -1 || targetIdx === -1) return vp;
      const newVisible = [...vp];
      [newVisible[sourceIdx], newVisible[targetIdx]] = [newVisible[targetIdx], newVisible[sourceIdx]];
      return newVisible;
    });
  }, []);

  const setPanels = useCallback((panels) => {
    if (!Array.isArray(panels)) return;
    setVisiblePanels(panels);
    setHiddenPanels([]);
  }, []);

  const value = {
    layout,
    layoutVersion,
    setLayout: applyLayout,
    visiblePanels,
    hiddenPanels,
    swapPanels,
    showPanel,
    hidePanel,
    reorderVisible,
    ensurePanelsForLayout,
    setPanels,
  };

  return (
    <PanelLayoutContext.Provider value={value}>
      {children}
    </PanelLayoutContext.Provider>
  );
}

export function usePanelLayoutContext() {
  return useContext(PanelLayoutContext);
}

export default PanelLayoutContext;
