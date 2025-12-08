export interface ComponentPanel {
  id: string;
  component: string; // key in panelRegistry
  title?: string;
  collapsed?: boolean;
  width?: string;
  height?: string;
}

export interface ContentPanel {
  id: string;
  title: string;
  content: string;
  collapsed?: boolean;
  width?: string;
  height?: string;
}

export type UIPanel = ComponentPanel | ContentPanel;
