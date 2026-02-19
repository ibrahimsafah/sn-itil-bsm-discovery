/**
 * HypergraphCore — Transposable Incidence-Matrix Hypergraph
 *
 * Builds a hypergraph from ITILDataSimulator output where:
 *   Original (H):  nodes = entities (CIs, groups, services)
 *                   hyperedges = change requests
 *   Transposed (H*): nodes = change requests
 *                     hyperedges = entities
 *
 * The incidence matrix is stored as a dictionary-of-sets for efficient
 * membership queries and O(1) transpose via key/value swap.
 *
 * Usage:
 *   var sim = new ITILDataSimulator();
 *   var data = sim.generate();
 *   var hg = new HypergraphCore();
 *   var graph = hg.build(data);         // original view
 *   var dual  = hg.transpose(graph);    // transposed view
 */

function HypergraphCore() {}

/**
 * Build the original hypergraph from task_ci records.
 *
 * Flat task_ci rows (each a change–CI pairing with dot-walked fields) are
 * grouped by task.number to form change hyperedges, and deduplicated by
 * ci_item.sys_id to form CI nodes.
 *
 * @param {Object} data - Output of ITILDataSimulator.generate()
 *   data.taskCiRecords — array of flat task_ci rows
 * @returns {Object} Hypergraph descriptor { nodes, edges, incidence, stats, isTransposed }
 */
HypergraphCore.prototype.build = function (data) {
  var records = data.taskCiRecords;
  var nodes = [];
  var nodeMap = {};  // uid -> node object
  var edges = [];
  var incidence = {}; // nodeUid -> Set of edgeUids

  var i, j;

  // Pass 1: Extract unique CIs as nodes
  var ciSeen = {};
  for (i = 0; i < records.length; i++) {
    var rec = records[i];
    var ciSysId = rec['ci_item.sys_id'];
    if (!ciSeen[ciSysId]) {
      ciSeen[ciSysId] = true;
      var node = {
        uid: 'ci:' + ciSysId,
        type: 'ci',
        name: rec['ci_item.name'],
        className: rec['ci_item.sys_class_name'],
        ipAddress: rec['ci_item.ip_address'],
        role: rec['ci_item.u_role'],
        model: rec['ci_item.model_id'],
        sysUpdatedOn: rec['ci_item.sys_updated_on']
      };
      nodes.push(node);
      nodeMap[node.uid] = node;
      incidence[node.uid] = new Set();
    }
  }

  // Pass 2: Group records by change number to build hyperedges
  var changeGroups = {};
  for (j = 0; j < records.length; j++) {
    var r = records[j];
    var chgNum = r['task.number'];
    if (!changeGroups[chgNum]) {
      changeGroups[chgNum] = {
        number: chgNum,
        changeType: r['task.type'],
        risk: r['task.risk'],
        impact: r['task.impact'],
        region: r['task.u_impact_region'],
        assignmentGroup: r['task.assignment_group'],
        createdAt: r['task.sys_created_on'],
        ciUids: []
      };
    }
    changeGroups[chgNum].ciUids.push('ci:' + r['ci_item.sys_id']);
  }

  // Build hyperedges from grouped changes
  var chgNums = Object.keys(changeGroups);
  for (var e = 0; e < chgNums.length; e++) {
    var chg = changeGroups[chgNums[e]];
    var edgeUid = 'change:' + chg.number;
    var members = [];

    for (var m = 0; m < chg.ciUids.length; m++) {
      if (nodeMap[chg.ciUids[m]]) members.push(chg.ciUids[m]);
    }

    var edge = {
      uid: edgeUid,
      elements: members,
      number: chg.number,
      changeType: chg.changeType,
      risk: chg.risk,
      impact: chg.impact,
      region: chg.region,
      assignmentGroup: chg.assignmentGroup,
      createdAt: chg.createdAt
    };
    edges.push(edge);

    // Populate incidence matrix
    for (var mi = 0; mi < members.length; mi++) {
      incidence[members[mi]].add(edgeUid);
    }
  }

  return {
    nodes: nodes,
    edges: edges,
    incidence: incidence,
    stats: this._computeStats(nodes, edges, incidence),
    isTransposed: false
  };
};

/**
 * Transpose the hypergraph: swap nodes and hyperedges.
 *
 * In the transposed view, each original hyperedge (change request) becomes
 * a node, and each original node (entity) becomes a hyperedge grouping
 * all changes that involve it.
 *
 * @param {Object} graph - Original hypergraph from build()
 * @returns {Object} Transposed hypergraph with same schema
 */
HypergraphCore.prototype.transpose = function (graph) {
  var newNodes = [];
  var newEdges = [];
  var newIncidence = {};

  var i, j;

  // Original edges become new nodes
  for (i = 0; i < graph.edges.length; i++) {
    var oldEdge = graph.edges[i];
    newNodes.push({
      uid: oldEdge.uid,
      type: 'change',
      name: oldEdge.number,
      changeType: oldEdge.changeType,
      risk: oldEdge.risk,
      impact: oldEdge.impact,
      region: oldEdge.region,
      assignmentGroup: oldEdge.assignmentGroup,
      createdAt: oldEdge.createdAt
    });
    newIncidence[oldEdge.uid] = new Set();
  }

  // Original nodes become new hyperedges
  for (i = 0; i < graph.nodes.length; i++) {
    var oldNode = graph.nodes[i];
    var memberEdgeUids = graph.incidence[oldNode.uid];
    if (!memberEdgeUids || memberEdgeUids.size === 0) continue;

    var elements = Array.from(memberEdgeUids);
    newEdges.push({
      uid: oldNode.uid,
      elements: elements,
      type: oldNode.type,
      name: oldNode.name,
      className: oldNode.className,
      ipAddress: oldNode.ipAddress
    });

    // Populate transposed incidence
    for (j = 0; j < elements.length; j++) {
      newIncidence[elements[j]].add(oldNode.uid);
    }
  }

  return {
    nodes: newNodes,
    edges: newEdges,
    incidence: newIncidence,
    stats: this._computeStats(newNodes, newEdges, newIncidence),
    isTransposed: true
  };
};

/**
 * Compute summary statistics for a hypergraph.
 */
HypergraphCore.prototype._computeStats = function (nodes, edges, incidence) {
  var totalNodes = nodes.length;
  var totalEdges = edges.length;

  // Density: ratio of actual incidence entries to possible (nodes * edges)
  var incidenceCount = 0;
  var nodeUids = Object.keys(incidence);
  var maxDegree = 0;
  var minDegree = Infinity;
  var degreeSum = 0;

  for (var i = 0; i < nodeUids.length; i++) {
    var deg = incidence[nodeUids[i]].size;
    incidenceCount += deg;
    degreeSum += deg;
    if (deg > maxDegree) maxDegree = deg;
    if (deg < minDegree) minDegree = deg;
  }

  var maxPossible = totalNodes * totalEdges;
  var density = maxPossible > 0 ? incidenceCount / maxPossible : 0;
  var avgDegree = totalNodes > 0 ? degreeSum / totalNodes : 0;

  // Edge size stats
  var maxEdgeSize = 0;
  var minEdgeSize = Infinity;
  var edgeSizeSum = 0;
  for (var e = 0; e < edges.length; e++) {
    var sz = edges[e].elements.length;
    edgeSizeSum += sz;
    if (sz > maxEdgeSize) maxEdgeSize = sz;
    if (sz < minEdgeSize) minEdgeSize = sz;
  }
  var avgEdgeSize = totalEdges > 0 ? edgeSizeSum / totalEdges : 0;

  return {
    totalNodes: totalNodes,
    totalEdges: totalEdges,
    density: Math.round(density * 10000) / 10000,
    avgDegree: Math.round(avgDegree * 100) / 100,
    maxDegree: maxDegree,
    minDegree: minDegree === Infinity ? 0 : minDegree,
    avgEdgeSize: Math.round(avgEdgeSize * 100) / 100,
    maxEdgeSize: maxEdgeSize,
    minEdgeSize: minEdgeSize === Infinity ? 0 : minEdgeSize
  };
};

/**
 * Compute the co-occurrence projection matrix (H × Hᵀ) for a given node type.
 *
 * Returns ranked pairs of nodes that share the most hyperedges, along with
 * the UIDs of the shared edges for drill-down.
 *
 * @param {Object} graph - Hypergraph from build() or transpose()
 * @param {string} [filterType] - Only include nodes of this type (e.g. 'ci'). Null = all.
 * @param {number} [topN] - Return only top N pairs. Default 20.
 * @returns {Array<{a: string, b: string, count: number, sharedEdges: string[]}>}
 */
HypergraphCore.prototype.cooccurrence = function (graph, filterType, topN) {
  topN = topN || 20;

  // Build edge -> member list lookup
  var edgeMembers = {};
  for (var e = 0; e < graph.edges.length; e++) {
    var edge = graph.edges[e];
    var members = edge.elements;
    if (filterType) {
      members = members.filter(function (uid) {
        // Match node type from uid prefix or from node lookup
        return uid.indexOf(filterType + ':') === 0;
      });
    }
    if (members.length > 1) {
      edgeMembers[edge.uid] = members;
    }
  }

  // Count pairwise co-occurrences
  var pairMap = {}; // "a|b" -> { count, sharedEdges }
  var edgeUids = Object.keys(edgeMembers);
  for (var i = 0; i < edgeUids.length; i++) {
    var eUid = edgeUids[i];
    var mems = edgeMembers[eUid];
    for (var a = 0; a < mems.length; a++) {
      for (var b = a + 1; b < mems.length; b++) {
        var key = mems[a] < mems[b] ? mems[a] + '|' + mems[b] : mems[b] + '|' + mems[a];
        if (!pairMap[key]) {
          pairMap[key] = { a: key.split('|')[0], b: key.split('|')[1], count: 0, sharedEdges: [] };
        }
        pairMap[key].count++;
        pairMap[key].sharedEdges.push(eUid);
      }
    }
  }

  // Sort by count descending and return top N
  var pairs = Object.values(pairMap);
  pairs.sort(function (x, y) { return y.count - x.count; });
  return pairs.slice(0, topN);
};

/**
 * Find nodes that belong to the same hyperedges as the given node.
 * Useful for neighborhood exploration.
 *
 * @param {Object} graph - Hypergraph
 * @param {string} nodeUid - Node to explore from
 * @returns {string[]} UIDs of co-member nodes (excluding the input node)
 */
HypergraphCore.prototype.neighbors = function (graph, nodeUid) {
  var edgeSet = graph.incidence[nodeUid];
  if (!edgeSet) return [];

  var neighborSet = new Set();
  var edgeUids = Array.from(edgeSet);

  for (var i = 0; i < edgeUids.length; i++) {
    var edge = null;
    for (var e = 0; e < graph.edges.length; e++) {
      if (graph.edges[e].uid === edgeUids[i]) { edge = graph.edges[e]; break; }
    }
    if (!edge) continue;
    for (var j = 0; j < edge.elements.length; j++) {
      if (edge.elements[j] !== nodeUid) {
        neighborSet.add(edge.elements[j]);
      }
    }
  }

  return Array.from(neighborSet);
};
