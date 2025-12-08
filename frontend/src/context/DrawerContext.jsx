import React, { createContext, useContext, useState, useCallback } from "react";

const DrawerContext = createContext({
  isOpen: false,
  toggleDrawer: () => {},
});

export function DrawerProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const toggleDrawer = useCallback(() => setIsOpen((prev) => !prev), []);
  return (
    <DrawerContext.Provider value={{ isOpen, toggleDrawer }}>
      {children}
    </DrawerContext.Provider>
  );
}

export function useDrawerContext() {
  return useContext(DrawerContext);
}

export default DrawerContext;
