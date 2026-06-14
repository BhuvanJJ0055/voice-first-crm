// lib/dag/types.ts
// Shared types for the VoxCRM Parallel DAG Execution Engine

export interface DAGNode {
  id: string;
  type: 'validation' | 'database' | 'audit' | 'event' | 'ui';
  // Results map is passed in so downstream nodes can read upstream outputs
  execute: (results: Map<string, any>) => Promise<any>;
  dependencies: string[];
  retry?: number;
}

export interface DAGResult {
  completed: Set<string>;
  failed: Map<string, Error>;
  results: Map<string, any>;
}
