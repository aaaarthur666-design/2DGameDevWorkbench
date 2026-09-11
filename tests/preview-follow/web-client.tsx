import React from 'react';
import { createRoot } from 'react-dom/client';
import { AgentFollow } from '../../components/workbench/agent-follow';
import '../../app/globals.css';
import '../../components/workbench/workbench.css';
createRoot(document.getElementById('root')!).render(<main><h1>会话预览测试</h1><p>{location.pathname + location.search}</p><AgentFollow /></main>);
