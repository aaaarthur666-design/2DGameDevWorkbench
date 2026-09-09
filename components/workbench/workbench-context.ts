'use client';
import {createContext} from 'react';
import type {WorkbenchState} from './workbench-provider';

// Keep the context identity outside the provider's refresh boundary. Editor changes
// must not give the RSC provider and its client consumers different contexts.
export const workbenchContext=createContext<WorkbenchState|null>(null);
