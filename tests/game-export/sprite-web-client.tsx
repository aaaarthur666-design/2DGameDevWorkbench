import React from 'react';
import {createRoot} from 'react-dom/client';
import {WorkbenchProvider} from '../../components/workbench/workbench-provider';
import {SpritePipelineWorkspace} from '../../components/sprite-generator/sprite-pipeline-workspace';
import {workbenchModules} from '../../lib/workbench/modules';
import '../../app/globals.css';
import '../../components/workbench/workbench.css';
const spriteModule = workbenchModules.find(m=>m.id==='sprite-generator')!;
createRoot(document.getElementById('root')!).render(<WorkbenchProvider><SpritePipelineWorkspace module={spriteModule}/></WorkbenchProvider>);
