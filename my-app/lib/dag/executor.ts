// lib/dag/executor.ts
// VoxCRM Parallel DAG Execution Engine
// Treats each DB write and audit log as an independent graph node.
// Nodes with no unresolved dependencies execute simultaneously via Promise.allSettled(),
// reducing multi-intent command latency by running independent operations in parallel.

import { DAGNode, DAGResult } from './types';
export type { DAGNode, DAGResult };


const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function executeWithRetry(
  node: DAGNode,
  results: Map<string, any>,
  maxAttempts: number,
): Promise<any> {
  const attempts = Math.max(1, maxAttempts);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await node.execute(results);
    } catch (error) {
      if (attempt === attempts) throw error;
      // Exponential backoff: 2s, 4s, 8s between retries
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}

/**
 * Validates that the constructed Workflow is a true Directed Acyclic Graph (DAG)
 * Runs a Depth-First Search (DFS) Cycle Detection algorithm to prevent processing deadlocks.
 */
export function validateDag(nodes: DAGNode[]): boolean {
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const nodeMap = new Map<string, DAGNode>(nodes.map(n => [n.id, n]));

  function hasCycle(nodeId: string): boolean {
    if (recStack.has(nodeId)) return true; // Cycle discovered!
    if (visited.has(nodeId)) return false;

    visited.add(nodeId);
    recStack.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (node && node.dependencies) {
      for (const depId of node.dependencies) {
        if (hasCycle(depId)) return true;
      }
    }

    recStack.delete(nodeId);
    return false;
  }

  // Evaluate every entry node in the workflow graph
  for (const node of nodes) {
    if (hasCycle(node.id)) {
      throw new Error(`CRITICAL COMPLIANCE FAILURE: Cyclic dependency loop caught at Node ID: [${node.id}]`);
    }
  }
  return true; // Graph is completely clean and acyclic
}

/**
 * executeDag
 *
 * Processes a list of DAGNodes in topological waves.
 * In each wave, all nodes whose dependencies are satisfied run in parallel
 * via Promise.allSettled(). The loop continues until every node has either
 * completed or failed, or no more nodes can be scheduled (broken dependency chain).
 *
 * Time complexity vs sequential: O(critical_path) instead of O(n_nodes).
 * For a 2-intent command (2 DB writes + 2 audit logs), this cuts sequential
 * round-trips from 4 to 2 (wave 1: both DB writes; wave 2: both audit logs).
 */
export async function executeDag(nodes: DAGNode[]): Promise<DAGResult> {
  // Run the explicit Layer 3 Acyclic Check matching your methodology blueprint
  validateDag(nodes);

  const completed = new Set<string>();
  const failed    = new Map<string, Error>();
  const results   = new Map<string, any>();

  while (completed.size + failed.size < nodes.length) {
    // Find every node whose upstream dependencies are all satisfied
    const ready = nodes.filter(node =>
      !completed.has(node.id) &&
      !failed.has(node.id) &&
      node.dependencies.every(dep => completed.has(dep)),
    );

    // No progress possible — broken dependency chain, exit safely
    if (ready.length === 0) break;

    // CRITICAL PERFORMANCE POINT: fire all ready nodes simultaneously
    const settled = await Promise.allSettled(
      ready.map(node => executeWithRetry(node, results, node.retry ?? 0)),
    );

    // Merge results back into the shared map for downstream nodes to read
    settled.forEach((outcome, idx) => {
      const nodeId = ready[idx].id;
      if (outcome.status === 'fulfilled') {
        completed.add(nodeId);
        results.set(nodeId, outcome.value);
      } else {
        failed.set(nodeId, outcome.reason as Error);
      }
    });
  }

  return { completed, failed, results };
}
