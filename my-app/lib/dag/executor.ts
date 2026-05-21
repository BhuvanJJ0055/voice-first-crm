// lib/dag/executor.ts
// VoxCRM Parallel DAG Execution Engine
// Treats each DB write and audit log as an independent graph node.
// Nodes with no unresolved dependencies execute simultaneously via Promise.allSettled(),
// reducing multi-intent command latency by running independent operations in parallel.

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

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function executeWithRetry(
  node: DAGNode,
  results: Map<string, any>,
  maxAttempts: number,
): Promise<any> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await node.execute(results);
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      // Exponential backoff: 2s, 4s, 8s between retries
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
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
      ready.map(node => executeWithRetry(node, results, node.retry ?? 3)),
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
