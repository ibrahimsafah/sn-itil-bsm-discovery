/**
 * CentralityAnalysis — Centrality metrics and critical node identification
 *
 * Extends AnalyticsEngine.prototype. Requires analytics/AnalyticsEngine.js.
 */

// ===================================================================
//  1. Centrality Analysis
// ===================================================================

/**
 * Compute four centrality measures for every node in the graph.
 *
 * @param {Object} graph - Hypergraph from HypergraphCore.build()
 * @returns {Object} { degree, betweenness, eigenvector, composite }
 *   Each value is { nodeUid: score } normalized 0-1.
 */
AnalyticsEngine.prototype.centrality = function (graph) {
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return { degree: {}, betweenness: {}, eigenvector: {}, composite: {} };
  }

  var degreeScores = this._degreeCentrality(graph);
  var betweennessScores = this._betweennessCentrality(graph);
  var eigenvectorScores = this._eigenvectorCentrality(graph);

  // Composite
  var composite = {};
  var keys = Object.keys(degreeScores);
  for (var i = 0; i < keys.length; i++) {
    var uid = keys[i];
    composite[uid] =
      0.3 * (degreeScores[uid] || 0) +
      0.3 * (betweennessScores[uid] || 0) +
      0.4 * (eigenvectorScores[uid] || 0);
  }
  this._normalize(composite);

  return {
    degree: degreeScores,
    betweenness: betweennessScores,
    eigenvector: eigenvectorScores,
    composite: composite
  };
};

/**
 * Degree centrality: node degree / max degree.
 * @private
 */
AnalyticsEngine.prototype._degreeCentrality = function (graph) {
  var scores = {};
  var maxDeg = this._maxDegree(graph.incidence);
  if (maxDeg === 0) maxDeg = 1;

  for (var i = 0; i < graph.nodes.length; i++) {
    var uid = graph.nodes[i].uid;
    var deg = graph.incidence[uid] ? graph.incidence[uid].size : 0;
    scores[uid] = deg / maxDeg;
  }
  return scores;
};

/**
 * Betweenness centrality (sampled approximation for hypergraphs).
 *
 * For each sampled pair (s, t) of CI-type nodes, find the shortest
 * hyperedge-hop path via BFS on the bipartite node-edge graph and
 * credit intermediate CI nodes.
 * @private
 */
AnalyticsEngine.prototype._betweennessCentrality = function (graph) {
  var ciUids = this._ciNodes(graph);
  var scores = {};
  var i;
  for (i = 0; i < graph.nodes.length; i++) {
    scores[graph.nodes[i].uid] = 0;
  }

  if (ciUids.length < 2) {
    return this._normalize(scores);
  }

  // Build adjacency: node -> Set(node) through shared edges
  var adj = {};
  for (i = 0; i < graph.nodes.length; i++) {
    adj[graph.nodes[i].uid] = {};
  }
  // For each edge, connect all member pairs
  var edgeMap = this._edgeMap(graph);
  for (i = 0; i < graph.edges.length; i++) {
    var members = graph.edges[i].elements;
    for (var a = 0; a < members.length; a++) {
      for (var b = a + 1; b < members.length; b++) {
        if (!adj[members[a]]) adj[members[a]] = {};
        if (!adj[members[b]]) adj[members[b]] = {};
        adj[members[a]][members[b]] = true;
        adj[members[b]][members[a]] = true;
      }
    }
  }

  // Sample up to 200 random (s, t) pairs of CI nodes
  var sampleCount = Math.min(200, ciUids.length * (ciUids.length - 1) / 2);
  var sampled = {};
  var pairsProcessed = 0;
  var attempts = 0;
  var maxAttempts = sampleCount * 10;

  // Simple deterministic shuffle using index mixing
  while (pairsProcessed < sampleCount && attempts < maxAttempts) {
    var si = Math.floor((attempts * 7 + 13) % ciUids.length);
    var ti = Math.floor((attempts * 11 + 23) % ciUids.length);
    attempts++;
    if (si === ti) continue;
    var pKey = si < ti ? si + ':' + ti : ti + ':' + si;
    if (sampled[pKey]) continue;
    sampled[pKey] = true;
    pairsProcessed++;

    var source = ciUids[si];
    var target = ciUids[ti];

    // BFS from source to target
    var path = this._bfsPath(adj, source, target);
    if (path && path.length > 2) {
      // Credit intermediate nodes (exclude source and target)
      for (var p = 1; p < path.length - 1; p++) {
        scores[path[p]] = (scores[path[p]] || 0) + 1;
      }
    }
  }

  return this._normalize(scores);
};

/**
 * BFS shortest path between source and target in an adjacency dict.
 * Returns array of node uids forming the path, or null if unreachable.
 * @private
 */
AnalyticsEngine.prototype._bfsPath = function (adj, source, target) {
  if (source === target) return [source];
  var queue = [source];
  var visited = {};
  var parent = {};
  visited[source] = true;

  while (queue.length > 0) {
    var current = queue.shift();
    var neighbors = adj[current];
    if (!neighbors) continue;
    var nKeys = Object.keys(neighbors);
    for (var i = 0; i < nKeys.length; i++) {
      var nb = nKeys[i];
      if (visited[nb]) continue;
      visited[nb] = true;
      parent[nb] = current;
      if (nb === target) {
        // Reconstruct path
        var path = [target];
        var node = target;
        while (parent[node] !== undefined) {
          node = parent[node];
          path.unshift(node);
        }
        return path;
      }
      queue.push(nb);
    }
  }
  return null;
};

/**
 * Eigenvector centrality via power iteration on the projected
 * adjacency matrix A = H x H^T.
 * @private
 */
AnalyticsEngine.prototype._eigenvectorCentrality = function (graph) {
  var proj = this._projectedAdjacency(graph);
  var nodes = proj.nodes;
  var matrix = proj.matrix;
  var n = nodes.length;

  if (n === 0) {
    var empty = {};
    for (var z = 0; z < graph.nodes.length; z++) {
      empty[graph.nodes[z].uid] = 0;
    }
    return empty;
  }

  // Index map for faster lookup
  var idx = {};
  var i, j;
  for (i = 0; i < n; i++) {
    idx[nodes[i]] = i;
  }

  // Start with uniform vector
  var vec = new Array(n);
  var initVal = 1.0 / n;
  for (i = 0; i < n; i++) {
    vec[i] = initVal;
  }

  // Power iteration (20 iterations)
  for (var iter = 0; iter < 20; iter++) {
    var newVec = new Array(n);
    for (i = 0; i < n; i++) {
      newVec[i] = 0;
    }

    for (i = 0; i < n; i++) {
      var row = matrix[nodes[i]];
      var rowKeys = Object.keys(row);
      for (j = 0; j < rowKeys.length; j++) {
        var colIdx = idx[rowKeys[j]];
        if (colIdx !== undefined) {
          newVec[i] += row[rowKeys[j]] * vec[colIdx];
        }
      }
    }

    // Normalize by L2 norm
    var norm = 0;
    for (i = 0; i < n; i++) {
      norm += newVec[i] * newVec[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (i = 0; i < n; i++) {
        newVec[i] = newVec[i] / norm;
      }
    }
    vec = newVec;
  }

  // Build scores for all graph nodes (non-CI nodes get 0)
  var scores = {};
  for (i = 0; i < graph.nodes.length; i++) {
    scores[graph.nodes[i].uid] = 0;
  }
  for (i = 0; i < n; i++) {
    scores[nodes[i]] = Math.abs(vec[i]);
  }

  return this._normalize(scores);
};

/**
 * Return top N nodes by composite centrality with explanations.
 *
 * @param {Object} graph - Hypergraph from HypergraphCore.build()
 * @param {number} [topN=10] - Number of top nodes to return
 * @returns {Array<{uid, name, type, composite, degree, betweenness, eigenvector, reason}>}
 */
AnalyticsEngine.prototype.criticalNodes = function (graph, topN) {
  topN = topN || 10;

  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return [];
  }

  var cent = this.centrality(graph);
  var nodeMap = this._nodeMap(graph);
  var keys = Object.keys(cent.composite);

  var entries = [];
  for (var i = 0; i < keys.length; i++) {
    var uid = keys[i];
    var node = nodeMap[uid];
    var d = cent.degree[uid] || 0;
    var b = cent.betweenness[uid] || 0;
    var e = cent.eigenvector[uid] || 0;
    var c = cent.composite[uid] || 0;

    // Determine dominant reason
    var reason = 'general importance';
    var maxMetric = Math.max(d, b, e);
    if (maxMetric > 0) {
      if (b === maxMetric) {
        reason = 'bridge — lies on many shortest paths between CIs';
      } else if (d === maxMetric) {
        reason = 'hub — participates in many change requests';
      } else {
        reason = 'connected to important nodes — high influence via neighbors';
      }
    }

    entries.push({
      uid: uid,
      name: node ? node.name : uid,
      type: node ? node.type : 'unknown',
      composite: Math.round(c * 10000) / 10000,
      degree: Math.round(d * 10000) / 10000,
      betweenness: Math.round(b * 10000) / 10000,
      eigenvector: Math.round(e * 10000) / 10000,
      reason: reason
    });
  }

  entries.sort(function (a, b) { return b.composite - a.composite; });
  return entries.slice(0, topN);
};
