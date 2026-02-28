import React from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-layout-body">
        <Topbar />
        <main className="app-layout-main">
          {children}
        </main>
      </div>
    </div>
  );
};
