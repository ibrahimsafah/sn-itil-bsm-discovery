/**
 * AnalyticsEngine — Advanced BSM Hypergraph Analytics
 *
 * Provides centrality analysis, temporal cascade detection, weighted
 * co-occurrence, anomaly detection, community detection, change impact
 * prediction, and incident correlation on top of HypergraphCore output.
 *
 * All algorithms are implemented in pure ES5 JavaScript with no external
 * dependencies.  Scores are normalized 0-1 where applicable.
 *
 * Usage:
 *   var engine = new AnalyticsEngine();
 *   var scores = engine.centrality(graph);
 *   var cascades = engine.temporalCascades(graph, rawData, 7);
 */

function AnalyticsEngine() {}

// ===================================================================
//  Internal helpers
// ===================================================================

/**
 * Build a lookup map from node uid to node object.
 * @private
 */
AnalyticsEngine.prototype._nodeMap = function (graph) {
  var map = {};
  for (var i = 0; i < graph.nodes.length; i++) {
    map[graph.nodes[i].uid] = graph.nodes[i];
  }
  return map;
};

/**
 * Build a lookup map from edge uid to edge object.
 * @private
 */
AnalyticsEngine.prototype._edgeMap = function (graph) {
  var map = {};
  for (var i = 0; i < graph.edges.length; i++) {
    map[graph.edges[i].uid] = graph.edges[i];
  }
  return map;
};

/**
 * Return an array of node uids whose type === 'ci'.
 * @private
 */
AnalyticsEngine.prototype._ciNodes = function (graph) {
  var result = [];
  for (var i = 0; i < graph.nodes.length; i++) {
    if (graph.nodes[i].type === 'ci') {
      result.push(graph.nodes[i].uid);
    }
  }
  return result;
};

/**
 * Return the maximum degree across all nodes in the incidence map.
 * @private
 */
AnalyticsEngine.prototype._maxDegree = function (incidence) {
  var max = 0;
  var keys = Object.keys(incidence);
  for (var i = 0; i < keys.length; i++) {
    var size = incidence[keys[i]].size;
    if (size > max) max = size;
  }
  return max;
};

/**
 * Compute the risk multiplier for a given risk string.
 * @private
 */
AnalyticsEngine.prototype._riskWeight = function (risk) {
  if (risk === 'Critical') return 4;
  if (risk === 'High') return 3;
  if (risk === 'Medium') return 2;
  return 1; // Low or unrecognised
};

/**
 * Parse an ISO date string to epoch milliseconds.
 * Falls back to 0 on failure.
 * @private
 */
AnalyticsEngine.prototype._parseDate = function (str) {
  if (!str) return 0;
  var d = new Date(str);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

/**
 * Compute sorted canonical pair key for two uids.
 * @private
 */
AnalyticsEngine.prototype._pairKey = function (a, b) {
  return a < b ? a + '|' + b : b + '|' + a;
};

/**
 * Normalize a plain-object score map in place so that max value = 1.
 * Returns the map for convenience.
 * @private
 */
AnalyticsEngine.prototype._normalize = function (scores) {
  var keys = Object.keys(scores);
  var max = 0;
  var i;
  for (i = 0; i < keys.length; i++) {
    if (scores[keys[i]] > max) max = scores[keys[i]];
  }
  if (max > 0) {
    for (i = 0; i < keys.length; i++) {
      scores[keys[i]] = scores[keys[i]] / max;
    }
  }
  return scores;
};

/**
 * Build a weighted projected adjacency matrix (H x H^T) for CI-type nodes.
 * Returns { nodes: [uid, ...], matrix: { uid: { uid: weight } } }.
 * Weight = number of shared hyperedges.
 * @private
 */
AnalyticsEngine.prototype._projectedAdjacency = function (graph) {
  var ciUids = this._ciNodes(graph);
  var ciSet = {};
  var i, j;
  for (i = 0; i < ciUids.length; i++) {
    ciSet[ciUids[i]] = true;
  }

  // For each edge, collect CI members
  var matrix = {};
  for (i = 0; i < ciUids.length; i++) {
    matrix[ciUids[i]] = {};
  }

  for (i = 0; i < graph.edges.length; i++) {
    var members = graph.edges[i].elements;
    // Filter to CI nodes only
    var ciMembers = [];
    for (j = 0; j < members.length; j++) {
      if (ciSet[members[j]]) ciMembers.push(members[j]);
    }
    // All pairs
    for (var a = 0; a < ciMembers.length; a++) {
      for (var b = a + 1; b < ciMembers.length; b++) {
        var u = ciMembers[a];
        var v = ciMembers[b];
        matrix[u][v] = (matrix[u][v] || 0) + 1;
        matrix[v][u] = (matrix[v][u] || 0) + 1;
      }
    }
  }

  return { nodes: ciUids, matrix: matrix };
};

/**
 * Build a flat change list with timestamps from rawData.
 * Each entry: { number, createdAt (ms), closedAt (ms), risk, model,
 *               category, ciUids: [...], serviceUid, groupUid }
 * @private
 */
AnalyticsEngine.prototype._changeList = function (rawData) {
  var changes = rawData.changes;
  var nums = Object.keys(changes);
  var list = [];
  for (var i = 0; i < nums.length; i++) {
    var chg = changes[nums[i]];
    var ciUids = [];
    for (var k = 0; k < chg.cis.length; k++) {
      ciUids.push('ci:' + chg.cis[k].id);
    }
    list.push({
      number: chg.number,
      createdAt: this._parseDate(chg.createdAt),
      closedAt: this._parseDate(chg.closedAt),
      risk: chg.risk || 'Low',
      model: chg.model || 'Standard',
      category: chg.category || '',
      ciUids: ciUids,
      serviceUid: 'service:' + chg.businessService.id,
      groupUid: 'group:' + chg.assignmentGroup.id,
      groupName: chg.assignmentGroup.name,
      serviceName: chg.businessService.name
    });
  }
  // Sort by createdAt ascending
  list.sort(function (a, b) { return a.createdAt - b.createdAt; });
  return list;
};

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

// ===================================================================
//  2. Temporal Cascade Analysis
// ===================================================================

/**
 * Analyse time-lagged change patterns between CI pairs.
 *
 * For each pair of CIs, count how often a change to CI-A is followed
 * by a change to CI-B within windowDays.
 *
 * @param {Object} graph - Hypergraph from HypergraphCore.build()
 * @param {Object} rawData - Output of ITILDataSimulator.generate() (changes must include createdAt)
 * @param {number} [windowDays=7] - Time window in days
 * @returns {Array<{source, target, count, avgLagDays, direction}>}
 */
AnalyticsEngine.prototype.temporalCascades = function (graph, rawData, windowDays) {
  windowDays = windowDays || 7;
  var windowMs = windowDays * 24 * 60 * 60 * 1000;

  if (!rawData || !rawData.changes) return [];

  var changeList = this._changeList(rawData);

  // Build CI -> sorted list of change timestamps
  var ciChanges = {}; // ciUid -> [{ time, number }]
  var i, j;
  for (i = 0; i < changeList.length; i++) {
    var chg = changeList[i];
    for (j = 0; j < chg.ciUids.length; j++) {
      var ciUid = chg.ciUids[j];
      if (!ciChanges[ciUid]) ciChanges[ciUid] = [];
      ciChanges[ciUid].push({ time: chg.createdAt, number: chg.number });
    }
  }

  // Sort each CI's changes by time
  var ciUids = Object.keys(ciChanges);
  for (i = 0; i < ciUids.length; i++) {
    ciChanges[ciUids[i]].sort(function (a, b) { return a.time - b.time; });
  }

  // Count directed cascades: A changed then B changed within window
  var cascadeMap = {}; // "A|B" -> { count, totalLag }
  for (i = 0; i < ciUids.length; i++) {
    var uidA = ciUids[i];
    var changesA = ciChanges[uidA];
    for (j = 0; j < ciUids.length; j++) {
      if (i === j) continue;
      var uidB = ciUids[j];
      var changesB = ciChanges[uidB];
      var dirKey = uidA + '|' + uidB;

      for (var ca = 0; ca < changesA.length; ca++) {
        var tA = changesA[ca].time;
        if (tA === 0) continue;
        for (var cb = 0; cb < changesB.length; cb++) {
          var tB = changesB[cb].time;
          if (tB === 0) continue;
          var lag = tB - tA;
          if (lag > 0 && lag <= windowMs) {
            if (!cascadeMap[dirKey]) {
              cascadeMap[dirKey] = { count: 0, totalLag: 0 };
            }
            cascadeMap[dirKey].count++;
            cascadeMap[dirKey].totalLag += lag;
          }
        }
      }
    }
  }

  // Merge directed pairs into bidirectional result
  var pairResults = {};
  var dirKeys = Object.keys(cascadeMap);
  for (i = 0; i < dirKeys.length; i++) {
    var parts = dirKeys[i].split('|');
    var a = parts[0];
    var b = parts[1];
    var canonKey = this._pairKey(a, b);
    if (!pairResults[canonKey]) {
      pairResults[canonKey] = { a: a, b: b, aToB: 0, bToA: 0, totalLag: 0, totalCount: 0 };
    }
    var entry = cascadeMap[dirKeys[i]];
    if (a < b) {
      pairResults[canonKey].aToB += entry.count;
    } else {
      pairResults[canonKey].bToA += entry.count;
    }
    pairResults[canonKey].totalLag += entry.totalLag;
    pairResults[canonKey].totalCount += entry.count;
  }

  // Build output
  var results = [];
  var pairKeys = Object.keys(pairResults);
  for (i = 0; i < pairKeys.length; i++) {
    var pr = pairResults[pairKeys[i]];
    var totalCount = pr.aToB + pr.bToA;
    if (totalCount === 0) continue;
    var avgLagMs = (pr.totalLag / totalCount);
    var avgLagDays = avgLagMs / (24 * 60 * 60 * 1000);

    var direction;
    if (pr.aToB > 0 && pr.bToA > 0) {
      direction = 'bidirectional';
    } else if (pr.aToB > 0) {
      direction = 'A\u2192B';
    } else {
      direction = 'B\u2192A';
    }

    results.push({
      source: pr.a,
      target: pr.b,
      count: totalCount,
      avgLagDays: Math.round(avgLagDays * 100) / 100,
      direction: direction
    });
  }

  results.sort(function (x, y) { return y.count - x.count; });
  return results.slice(0, 30);
};

/**
 * Compute per-CI change velocity (changes per week) over the 90-day window.
 *
 * @param {Object} rawData - Output of ITILDataSimulator.generate()
 * @returns {Object} { nodeUid: { weeks: [count,...], avg, max, trend } }
 */
AnalyticsEngine.prototype.changeVelocity = function (rawData) {
  if (!rawData || !rawData.changes) return {};

  var changeList = this._changeList(rawData);
  if (changeList.length === 0) return {};

  // Determine time range
  var minTime = Infinity;
  var maxTime = 0;
  var i, j;
  for (i = 0; i < changeList.length; i++) {
    var t = changeList[i].createdAt;
    if (t > 0 && t < minTime) minTime = t;
    if (t > maxTime) maxTime = t;
  }
  if (minTime === Infinity || maxTime === 0) return {};

  var weekMs = 7 * 24 * 60 * 60 * 1000;
  var totalWeeks = Math.ceil((maxTime - minTime) / weekMs);
  if (totalWeeks < 1) totalWeeks = 1;

  // Accumulate per-CI weekly counts
  var ciWeeks = {}; // ciUid -> [weekCounts]
  for (i = 0; i < changeList.length; i++) {
    var chg = changeList[i];
    if (chg.createdAt === 0) continue;
    var weekIdx = Math.min(Math.floor((chg.createdAt - minTime) / weekMs), totalWeeks - 1);
    for (j = 0; j < chg.ciUids.length; j++) {
      var ciUid = chg.ciUids[j];
      if (!ciWeeks[ciUid]) {
        ciWeeks[ciUid] = new Array(totalWeeks);
        for (var w = 0; w < totalWeeks; w++) {
          ciWeeks[ciUid][w] = 0;
        }
      }
      ciWeeks[ciUid][weekIdx]++;
    }
  }

  // Build results — only CIs with 2+ changes total
  var result = {};
  var ciUids = Object.keys(ciWeeks);
  for (i = 0; i < ciUids.length; i++) {
    var weeks = ciWeeks[ciUids[i]];
    var total = 0;
    var max = 0;
    for (j = 0; j < weeks.length; j++) {
      total += weeks[j];
      if (weeks[j] > max) max = weeks[j];
    }
    if (total < 2) continue;

    var avg = total / weeks.length;

    // Trend: compare first half avg to second half avg
    var halfLen = Math.floor(weeks.length / 2);
    var firstHalf = 0;
    var secondHalf = 0;
    if (halfLen > 0) {
      for (j = 0; j < halfLen; j++) {
        firstHalf += weeks[j];
      }
      for (j = halfLen; j < weeks.length; j++) {
        secondHalf += weeks[j];
      }
      firstHalf = firstHalf / halfLen;
      secondHalf = secondHalf / (weeks.length - halfLen);
    }

    var trend = 'stable';
    if (halfLen > 0) {
      var diff = secondHalf - firstHalf;
      var baseline = Math.max(firstHalf, 0.1);
      if (diff / baseline > 0.25) {
        trend = 'increasing';
      } else if (diff / baseline < -0.25) {
        trend = 'decreasing';
      }
    }

    result[ciUids[i]] = {
      weeks: weeks,
      avg: Math.round(avg * 100) / 100,
      max: max,
      trend: trend
    };
  }

  return result;
};

// ===================================================================
//  3. Weighted Co-occurrence
// ===================================================================

/**
 * Compute weighted co-occurrence metrics for CI pairs.
 *
 * @param {Object} graph - Hypergraph from HypergraphCore.build()
 * @param {Object} rawData - Output of ITILDataSimulator.generate()
 * @param {number} [topN=30] - Number of top pairs to return
 * @returns {Array<{a, b, rawCount, riskWeighted, recencyWeighted, diversityWeighted, jaccard, composite}>}
 */
AnalyticsEngine.prototype.weightedCooccurrence = function (graph, rawData, topN) {
  topN = topN || 30;

  if (!graph || !graph.edges || graph.edges.length === 0) return [];

  var changeList = this._changeList(rawData || { changes: {} });

  // Determine "now" as max timestamp for recency calc
  var now = 0;
  var i, j;
  for (i = 0; i < changeList.length; i++) {
    if (changeList[i].createdAt > now) now = changeList[i].createdAt;
  }
  if (now === 0) now = Date.now();

  var halfLifeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  var ln2 = Math.log(2);

  // Build change lookup by edge uid
  var changeByNumber = {};
  for (i = 0; i < changeList.length; i++) {
    changeByNumber[changeList[i].number] = changeList[i];
  }

  // CI node set
  var ciSet = {};
  var ciUids = this._ciNodes(graph);
  for (i = 0; i < ciUids.length; i++) {
    ciSet[ciUids[i]] = true;
  }

  // Track per-CI edges and per-pair metrics
  var ciEdges = {}; // ciUid -> Set(edgeUid)
  var pairMap = {}; // pairKey -> { rawCount, riskWeighted, recencyWeighted, groups (Set) }

  for (i = 0; i < graph.edges.length; i++) {
    var edge = graph.edges[i];
    var ciMembers = [];
    for (j = 0; j < edge.elements.length; j++) {
      if (ciSet[edge.elements[j]]) {
        ciMembers.push(edge.elements[j]);
        if (!ciEdges[edge.elements[j]]) ciEdges[edge.elements[j]] = {};
        ciEdges[edge.elements[j]][edge.uid] = true;
      }
    }

    // Look up change metadata
    var chgNumber = edge.number || '';
    var chgData = changeByNumber[chgNumber];
    var riskW = this._riskWeight(edge.risk || 'Low');
    var age = (chgData && chgData.createdAt > 0) ? (now - chgData.createdAt) : 0;
    var recencyW = Math.exp(-ln2 * age / halfLifeMs);
    var groupName = edge.assignmentGroup || (chgData ? chgData.groupName : '');

    // All CI pairs in this edge
    for (var a = 0; a < ciMembers.length; a++) {
      for (var b = a + 1; b < ciMembers.length; b++) {
        var pk = this._pairKey(ciMembers[a], ciMembers[b]);
        if (!pairMap[pk]) {
          pairMap[pk] = {
            a: ciMembers[a] < ciMembers[b] ? ciMembers[a] : ciMembers[b],
            b: ciMembers[a] < ciMembers[b] ? ciMembers[b] : ciMembers[a],
            rawCount: 0,
            riskWeighted: 0,
            recencyWeighted: 0,
            groups: {}
          };
        }
        pairMap[pk].rawCount++;
        pairMap[pk].riskWeighted += riskW;
        pairMap[pk].recencyWeighted += recencyW;
        if (groupName) pairMap[pk].groups[groupName] = true;
      }
    }
  }

  // Build output with Jaccard and diversity
  var results = [];
  var pairKeys = Object.keys(pairMap);
  for (i = 0; i < pairKeys.length; i++) {
    var pm = pairMap[pairKeys[i]];
    var edgesA = ciEdges[pm.a] || {};
    var edgesB = ciEdges[pm.b] || {};
    var keysA = Object.keys(edgesA);
    var keysB = Object.keys(edgesB);

    // Jaccard: |intersection| / |union|
    var intersection = 0;
    for (j = 0; j < keysA.length; j++) {
      if (edgesB[keysA[j]]) intersection++;
    }
    // Union = |A| + |B| - |intersection|
    var union = keysA.length + keysB.length - intersection;
    var jaccard = union > 0 ? intersection / union : 0;

    var diversityWeighted = Object.keys(pm.groups).length;

    results.push({
      a: pm.a,
      b: pm.b,
      rawCount: pm.rawCount,
      riskWeighted: Math.round(pm.riskWeighted * 100) / 100,
      recencyWeighted: Math.round(pm.recencyWeighted * 100) / 100,
      diversityWeighted: diversityWeighted,
      jaccard: Math.round(jaccard * 10000) / 10000,
      composite: 0 // placeholder, normalised below
    });
  }

  if (results.length === 0) return [];

  // Normalise each metric to 0-1 and compute composite
  var maxRaw = 0, maxRisk = 0, maxRecency = 0, maxDiv = 0, maxJac = 0;
  for (i = 0; i < results.length; i++) {
    if (results[i].rawCount > maxRaw) maxRaw = results[i].rawCount;
    if (results[i].riskWeighted > maxRisk) maxRisk = results[i].riskWeighted;
    if (results[i].recencyWeighted > maxRecency) maxRecency = results[i].recencyWeighted;
    if (results[i].diversityWeighted > maxDiv) maxDiv = results[i].diversityWeighted;
    if (results[i].jaccard > maxJac) maxJac = results[i].jaccard;
  }

  for (i = 0; i < results.length; i++) {
    var r = results[i];
    var nRaw = maxRaw > 0 ? r.rawCount / maxRaw : 0;
    var nRisk = maxRisk > 0 ? r.riskWeighted / maxRisk : 0;
    var nRecency = maxRecency > 0 ? r.recencyWeighted / maxRecency : 0;
    var nDiv = maxDiv > 0 ? r.diversityWeighted / maxDiv : 0;
    var nJac = maxJac > 0 ? r.jaccard / maxJac : 0;
    r.composite = Math.round((0.25 * nRaw + 0.25 * nRisk + 0.2 * nRecency + 0.15 * nDiv + 0.15 * nJac) * 10000) / 10000;
  }

  results.sort(function (x, y) { return y.composite - x.composite; });
  return results.slice(0, topN);
};

// ===================================================================
//  4. Anomaly Detection
// ===================================================================

/**
 * Detect structural and statistical anomalies in the change graph.
 *
 * @param {Object} graph - Hypergraph from HypergraphCore.build()
 * @param {Object} rawData - Output of ITILDataSimulator.generate()
 * @returns {Object} { unexpectedPairs, orphans, overCoupled, underCoupled }
 */
AnalyticsEngine.prototype.detectAnomalies = function (graph, rawData) {
  if (!graph || !graph.nodes) {
    return { unexpectedPairs: [], orphans: [], overCoupled: [], underCoupled: [] };
  }

  var nodeMap = this._nodeMap(graph);
  var ciUids = this._ciNodes(graph);
  var ciSet = {};
  var i, j;
  for (i = 0; i < ciUids.length; i++) {
    ciSet[ciUids[i]] = true;
  }

  // --- Orphans ---
  var orphans = [];
  for (i = 0; i < ciUids.length; i++) {
    var uid = ciUids[i];
    var deg = graph.incidence[uid] ? graph.incidence[uid].size : 0;
    if (deg <= 1) {
      var node = nodeMap[uid];
      orphans.push({
        uid: uid,
        name: node ? node.name : uid,
        degree: deg,
        reason: deg === 0 ? 'no changes reference this CI' : 'only 1 change references this CI'
      });
    }
  }

  // --- Count class frequencies and pair co-occurrences ---
  var classCount = {}; // className -> number of edges that include that class
  var totalEdges = graph.edges.length;
  var pairCooccur = {}; // pairKey -> count
  var ciEdgeCount = {}; // ciUid -> Set(edgeUid)

  for (i = 0; i < graph.edges.length; i++) {
    var edge = graph.edges[i];
    var ciMembers = [];
    var classesInEdge = {};
    for (j = 0; j < edge.elements.length; j++) {
      var el = edge.elements[j];
      if (ciSet[el]) {
        ciMembers.push(el);
        var n = nodeMap[el];
        var cls = n ? n.className : 'unknown';
        classesInEdge[cls] = true;
        if (!ciEdgeCount[el]) ciEdgeCount[el] = {};
        ciEdgeCount[el][edge.uid] = true;
      }
    }
    var classNames = Object.keys(classesInEdge);
    for (j = 0; j < classNames.length; j++) {
      classCount[classNames[j]] = (classCount[classNames[j]] || 0) + 1;
    }
    for (var a = 0; a < ciMembers.length; a++) {
      for (var b = a + 1; b < ciMembers.length; b++) {
        var pk = this._pairKey(ciMembers[a], ciMembers[b]);
        pairCooccur[pk] = (pairCooccur[pk] || 0) + 1;
      }
    }
  }

  // --- Unexpected pairs ---
  var unexpectedPairs = [];
  var pairKeys = Object.keys(pairCooccur);
  for (i = 0; i < pairKeys.length; i++) {
    var parts = pairKeys[i].split('|');
    var nodeA = nodeMap[parts[0]];
    var nodeB = nodeMap[parts[1]];
    if (!nodeA || !nodeB) continue;

    var classA = nodeA.className || 'unknown';
    var classB = nodeB.className || 'unknown';
    var freqA = (classCount[classA] || 0) / Math.max(totalEdges, 1);
    var freqB = (classCount[classB] || 0) / Math.max(totalEdges, 1);
    var expected = freqA * freqB * totalEdges;
    var actual = pairCooccur[pairKeys[i]];

    if (expected > 0 && actual > 2 * expected) {
      unexpectedPairs.push({
        a: parts[0],
        b: parts[1],
        nameA: nodeA.name,
        nameB: nodeB.name,
        classA: classA,
        classB: classB,
        actual: actual,
        expected: Math.round(expected * 100) / 100,
        ratio: Math.round((actual / expected) * 100) / 100
      });
    }
  }
  unexpectedPairs.sort(function (x, y) { return y.ratio - x.ratio; });

  // --- Over-coupled (Jaccard > 0.5) ---
  var overCoupled = [];
  for (i = 0; i < pairKeys.length; i++) {
    var partsOC = pairKeys[i].split('|');
    var edgesA = ciEdgeCount[partsOC[0]] || {};
    var edgesB = ciEdgeCount[partsOC[1]] || {};
    var keysA = Object.keys(edgesA);
    var keysB = Object.keys(edgesB);
    var inter = 0;
    for (j = 0; j < keysA.length; j++) {
      if (edgesB[keysA[j]]) inter++;
    }
    var union = keysA.length + keysB.length - inter;
    var jaccard = union > 0 ? inter / union : 0;
    if (jaccard > 0.5) {
      var nA = nodeMap[partsOC[0]];
      var nB = nodeMap[partsOC[1]];
      overCoupled.push({
        a: partsOC[0],
        b: partsOC[1],
        nameA: nA ? nA.name : partsOC[0],
        nameB: nB ? nB.name : partsOC[1],
        jaccard: Math.round(jaccard * 10000) / 10000,
        sharedChanges: inter
      });
    }
  }
  overCoupled.sort(function (x, y) { return y.jaccard - x.jaccard; });

  // --- Under-coupled: share a business service but never co-occur ---
  var serviceMembers = {}; // serviceUid -> [ciUid]
  for (i = 0; i < graph.edges.length; i++) {
    var edgeUC = graph.edges[i];
    var svcUid = null;
    var ciInEdge = [];
    for (j = 0; j < edgeUC.elements.length; j++) {
      var eUid = edgeUC.elements[j];
      if (eUid.indexOf('service:') === 0) svcUid = eUid;
      if (ciSet[eUid]) ciInEdge.push(eUid);
    }
    if (svcUid) {
      if (!serviceMembers[svcUid]) serviceMembers[svcUid] = {};
      for (j = 0; j < ciInEdge.length; j++) {
        serviceMembers[svcUid][ciInEdge[j]] = true;
      }
    }
  }

  var underCoupled = [];
  var svcKeys = Object.keys(serviceMembers);
  for (i = 0; i < svcKeys.length; i++) {
    var members = Object.keys(serviceMembers[svcKeys[i]]);
    for (var m1 = 0; m1 < members.length; m1++) {
      for (var m2 = m1 + 1; m2 < members.length; m2++) {
        var ucKey = this._pairKey(members[m1], members[m2]);
        if (!pairCooccur[ucKey]) {
          var nUC1 = nodeMap[members[m1]];
          var nUC2 = nodeMap[members[m2]];
          underCoupled.push({
            a: members[m1],
            b: members[m2],
            nameA: nUC1 ? nUC1.name : members[m1],
            nameB: nUC2 ? nUC2.name : members[m2],
            sharedService: svcKeys[i],
            reason: 'share business service but never appear in the same change'
          });
        }
      }
    }
  }

  return {
    unexpectedPairs: unexpectedPairs,
    orphans: orphans,
    overCoupled: overCoupled,
    underCoupled: underCoupled
  };
};

/**
 * Generate a per-CI risk heatmap with multi-factor scoring.
 *
 * @param {Object} graph - Hypergraph from HypergraphCore.build()
 * @param {Object} rawData - Output of ITILDataSimulator.generate()
 * @returns {Array<{ci, name, riskScore, factors}>}
 */
AnalyticsEngine.prototype.riskHeatmap = function (graph, rawData) {
  if (!graph || !graph.nodes) return [];

  var nodeMap = this._nodeMap(graph);
  var ciUids = this._ciNodes(graph);
  var ciSet = {};
  var i, j;
  for (i = 0; i < ciUids.length; i++) {
    ciSet[ciUids[i]] = true;
  }

  var changeList = this._changeList(rawData || { changes: {} });

  // Per-CI metrics
  var ciStats = {}; // uid -> { changeCount, emergencyCount, coupledCIs (Set) }
  for (i = 0; i < ciUids.length; i++) {
    ciStats[ciUids[i]] = { changeCount: 0, emergencyCount: 0, coupledCIs: {} };
  }

  // Accumulate from change list
  for (i = 0; i < changeList.length; i++) {
    var chg = changeList[i];
    var isEmergency = (chg.model === 'Emergency');
    for (j = 0; j < chg.ciUids.length; j++) {
      var ciUid = chg.ciUids[j];
      if (!ciStats[ciUid]) continue;
      ciStats[ciUid].changeCount++;
      if (isEmergency) ciStats[ciUid].emergencyCount++;
    }
    // Track coupling
    for (var a = 0; a < chg.ciUids.length; a++) {
      for (var b = a + 1; b < chg.ciUids.length; b++) {
        if (ciStats[chg.ciUids[a]]) ciStats[chg.ciUids[a]].coupledCIs[chg.ciUids[b]] = true;
        if (ciStats[chg.ciUids[b]]) ciStats[chg.ciUids[b]].coupledCIs[chg.ciUids[a]] = true;
      }
    }
  }

  // Count incidents per CI if available in rawData
  var incidentCounts = {};
  if (rawData && rawData.incidents) {
    var incKeys = Object.keys(rawData.incidents);
    for (i = 0; i < incKeys.length; i++) {
      var inc = rawData.incidents[incKeys[i]];
      if (inc.affectedCI && inc.affectedCI.id) {
        var incCiUid = 'ci:' + inc.affectedCI.id;
        incidentCounts[incCiUid] = (incidentCounts[incCiUid] || 0) + 1;
      }
    }
  }

  // Compute raw factors
  var rawFactors = [];
  for (i = 0; i < ciUids.length; i++) {
    var uid = ciUids[i];
    var stats = ciStats[uid];
    var changeFreq = stats.changeCount;
    var emergencyRatio = stats.changeCount > 0 ? stats.emergencyCount / stats.changeCount : 0;
    var incidentRate = incidentCounts[uid] || 0;
    var couplingDensity = Object.keys(stats.coupledCIs).length;

    rawFactors.push({
      uid: uid,
      changeFrequency: changeFreq,
      emergencyRatio: emergencyRatio,
      incidentRate: incidentRate,
      couplingDensity: couplingDensity
    });
  }

  // Find maxima for normalization
  var maxCF = 0, maxER = 0, maxIR = 0, maxCD = 0;
  for (i = 0; i < rawFactors.length; i++) {
    if (rawFactors[i].changeFrequency > maxCF) maxCF = rawFactors[i].changeFrequency;
    if (rawFactors[i].emergencyRatio > maxER) maxER = rawFactors[i].emergencyRatio;
    if (rawFactors[i].incidentRate > maxIR) maxIR = rawFactors[i].incidentRate;
    if (rawFactors[i].couplingDensity > maxCD) maxCD = rawFactors[i].couplingDensity;
  }

  // Build final results
  var results = [];
  for (i = 0; i < rawFactors.length; i++) {
    var rf = rawFactors[i];
    var node = nodeMap[rf.uid];
    var nCF = maxCF > 0 ? rf.changeFrequency / maxCF : 0;
    var nER = maxER > 0 ? rf.emergencyRatio / maxER : 0;
    var nIR = maxIR > 0 ? rf.incidentRate / maxIR : 0;
    var nCD = maxCD > 0 ? rf.couplingDensity / maxCD : 0;

    var riskScore = Math.round((0.3 * nCF + 0.25 * nER + 0.25 * nIR + 0.2 * nCD) * 100);

    results.push({
      ci: rf.uid,
      name: node ? node.name : rf.uid,
      riskScore: riskScore,
      factors: {
        changeFrequency: rf.changeFrequency,
        emergencyRatio: Math.round(rf.emergencyRatio * 10000) / 10000,
        incidentRate: rf.incidentRate,
        couplingDensity: rf.couplingDensity
      }
    });
  }

  results.sort(function (x, y) { return y.riskScore - x.riskScore; });
  return results;
};

// ===================================================================
//  5. Community Detection (Louvain-inspired)
// ===================================================================

/**
 * Detect communities of CIs using a simplified Louvain algorithm on the
 * projected adjacency matrix (weighted by co-occurrence count).
 *
 * @param {Object} graph - Hypergraph from HypergraphCore.build()
 * @returns {Object} { communities, modularity, summary }
 */
AnalyticsEngine.prototype.detectCommunities = function (graph) {
  if (!graph || !graph.nodes) {
    return { communities: {}, modularity: 0, summary: [] };
  }

  var proj = this._projectedAdjacency(graph);
  var nodes = proj.nodes;   // CI uids only
  var matrix = proj.matrix;
  var n = nodes.length;

  if (n === 0) {
    return { communities: {}, modularity: 0, summary: [] };
  }

  // Total edge weight (sum of all weights / 2 since symmetric)
  var m2 = 0; // 2m
  var i, j;
  for (i = 0; i < n; i++) {
    var row = matrix[nodes[i]];
    var rKeys = Object.keys(row);
    for (j = 0; j < rKeys.length; j++) {
      m2 += row[rKeys[j]];
    }
  }
  // m2 already counts each edge twice (symmetric), so m = m2/2
  var m = m2 / 2;

  if (m === 0) {
    // No edges; each node is its own community
    var trivial = {};
    for (i = 0; i < n; i++) {
      trivial[i] = [nodes[i]];
    }
    return { communities: trivial, modularity: 0, summary: this._communitySummary(trivial, graph) };
  }

  // Weighted degree (strength) of each node
  var strength = {};
  for (i = 0; i < n; i++) {
    var s = 0;
    var sRow = matrix[nodes[i]];
    var sKeys = Object.keys(sRow);
    for (j = 0; j < sKeys.length; j++) {
      s += sRow[sKeys[j]];
    }
    strength[nodes[i]] = s;
  }

  // Initialise each node in its own community
  var community = {}; // nodeUid -> communityId
  for (i = 0; i < n; i++) {
    community[nodes[i]] = i;
  }

  // Iterative optimisation
  var improved = true;
  var maxIterations = 50;
  var iteration = 0;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    for (i = 0; i < n; i++) {
      var nodeUid = nodes[i];
      var currentCom = community[nodeUid];
      var ki = strength[nodeUid];

      // Compute sum of weights to each neighbouring community
      var neighborComs = {}; // comId -> sumWeight
      var nRow = matrix[nodeUid];
      var nKeys = Object.keys(nRow);
      for (j = 0; j < nKeys.length; j++) {
        var neighborUid = nKeys[j];
        var nc = community[neighborUid];
        if (nc === undefined) continue;
        neighborComs[nc] = (neighborComs[nc] || 0) + nRow[neighborUid];
      }

      // Sum of weights inside current community (connections from this node to current com)
      var sigmaIn = neighborComs[currentCom] || 0;

      // Sum of total weights for current community
      var sigmaTot = 0;
      for (j = 0; j < n; j++) {
        if (community[nodes[j]] === currentCom && nodes[j] !== nodeUid) {
          sigmaTot += strength[nodes[j]];
        }
      }

      // Modularity gain of removing node from its community
      var removeGain = sigmaIn / m - (sigmaTot * ki) / (2 * m * m);

      // Find best community to move to
      var bestCom = currentCom;
      var bestGain = 0;
      var comIds = Object.keys(neighborComs);

      for (j = 0; j < comIds.length; j++) {
        var targetCom = parseInt(comIds[j], 10);
        if (targetCom === currentCom) continue;

        var kIn = neighborComs[comIds[j]]; // weight to target community
        var sigmaTarget = 0;
        for (var k = 0; k < n; k++) {
          if (community[nodes[k]] === targetCom) {
            sigmaTarget += strength[nodes[k]];
          }
        }

        var gain = kIn / m - (sigmaTarget * ki) / (2 * m * m);
        var deltaQ = gain - removeGain;

        if (deltaQ > bestGain) {
          bestGain = deltaQ;
          bestCom = targetCom;
        }
      }

      if (bestCom !== currentCom && bestGain > 0) {
        community[nodeUid] = bestCom;
        improved = true;
      }
    }
  }

  // Build communities map
  var communities = {};
  for (i = 0; i < n; i++) {
    var cid = community[nodes[i]];
    if (!communities[cid]) communities[cid] = [];
    communities[cid].push(nodes[i]);
  }

  // Compute final modularity Q
  var Q = 0;
  for (i = 0; i < n; i++) {
    for (j = 0; j < n; j++) {
      if (community[nodes[i]] !== community[nodes[j]]) continue;
      var Aij = (matrix[nodes[i]] && matrix[nodes[i]][nodes[j]]) ? matrix[nodes[i]][nodes[j]] : 0;
      Q += Aij - (strength[nodes[i]] * strength[nodes[j]]) / (2 * m);
    }
  }
  Q = Q / (2 * m);

  return {
    communities: communities,
    modularity: Math.round(Q * 10000) / 10000,
    summary: this._communitySummary(communities, graph)
  };
};

/**
 * Build summary metadata for each detected community.
 * @private
 */
AnalyticsEngine.prototype._communitySummary = function (communities, graph) {
  var nodeMap = this._nodeMap(graph);
  var result = [];
  var comIds = Object.keys(communities);

  for (var i = 0; i < comIds.length; i++) {
    var members = communities[comIds[i]];
    var typeCounts = {};
    var serviceCounts = {};

    for (var j = 0; j < members.length; j++) {
      var node = nodeMap[members[j]];
      if (!node) continue;
      var cls = node.className || node.type || 'unknown';
      typeCounts[cls] = (typeCounts[cls] || 0) + 1;

      // Find services this CI is connected to
      var edgeSet = graph.incidence[members[j]];
      if (edgeSet) {
        var edgeArr = Array.from(edgeSet);
        for (var e = 0; e < graph.edges.length; e++) {
          if (!edgeSet.has(graph.edges[e].uid)) continue;
          var svcName = graph.edges[e].businessService;
          if (svcName) serviceCounts[svcName] = (serviceCounts[svcName] || 0) + 1;
        }
      }
    }

    // Dominant type
    var dominantType = 'unknown';
    var maxTypeCount = 0;
    var typeKeys = Object.keys(typeCounts);
    for (var t = 0; t < typeKeys.length; t++) {
      if (typeCounts[typeKeys[t]] > maxTypeCount) {
        maxTypeCount = typeCounts[typeKeys[t]];
        dominantType = typeKeys[t];
      }
    }

    // Dominant service
    var dominantService = 'unknown';
    var maxSvcCount = 0;
    var svcKeys = Object.keys(serviceCounts);
    for (var s = 0; s < svcKeys.length; s++) {
      if (serviceCounts[svcKeys[s]] > maxSvcCount) {
        maxSvcCount = serviceCounts[svcKeys[s]];
        dominantService = svcKeys[s];
      }
    }

    result.push({
      id: comIds[i],
      size: members.length,
      dominantType: dominantType,
      dominantService: dominantService
    });
  }

  result.sort(function (a, b) { return b.size - a.size; });
  return result;
};

// ===================================================================
//  6. Change Impact Prediction
// ===================================================================

/**
 * Predict which CIs are likely to be impacted when a given CI changes.
 *
 * Score is a weighted combination of co-occurrence frequency, temporal
 * cascade history, shared business service membership, and network
 * proximity.
 *
 * @param {Object} graph - Hypergraph from HypergraphCore.build()
 * @param {Object} rawData - Output of ITILDataSimulator.generate()
 * @param {string} targetCiUid - UID of the CI about to change
 * @returns {Array<{ci, name, probability, reason}>}
 */
AnalyticsEngine.prototype.predictImpact = function (graph, rawData, targetCiUid) {
  if (!graph || !graph.nodes || !targetCiUid) return [];

  var nodeMap = this._nodeMap(graph);
  if (!nodeMap[targetCiUid]) return [];

  var ciUids = this._ciNodes(graph);
  var ciSet = {};
  var i, j;
  for (i = 0; i < ciUids.length; i++) {
    ciSet[ciUids[i]] = true;
  }

  // 1. Co-occurrence frequency
  var cooccurCount = {}; // otherCi -> count
  var edgeSet = graph.incidence[targetCiUid];
  if (edgeSet) {
    var edgeArr = Array.from(edgeSet);
    for (i = 0; i < graph.edges.length; i++) {
      var edge = graph.edges[i];
      if (!edgeSet.has(edge.uid)) continue;
      for (j = 0; j < edge.elements.length; j++) {
        var el = edge.elements[j];
        if (el !== targetCiUid && ciSet[el]) {
          cooccurCount[el] = (cooccurCount[el] || 0) + 1;
        }
      }
    }
  }

  // 2. Temporal cascades (target -> other)
  var cascades = {};
  if (rawData && rawData.changes) {
    var changeList = this._changeList(rawData);
    var targetChanges = [];
    var otherChanges = {}; // ciUid -> [{time}]

    for (i = 0; i < changeList.length; i++) {
      var chg = changeList[i];
      var hasTarget = false;
      for (j = 0; j < chg.ciUids.length; j++) {
        if (chg.ciUids[j] === targetCiUid) hasTarget = true;
      }
      if (hasTarget) targetChanges.push(chg.createdAt);
      for (j = 0; j < chg.ciUids.length; j++) {
        var cu = chg.ciUids[j];
        if (cu !== targetCiUid && ciSet[cu]) {
          if (!otherChanges[cu]) otherChanges[cu] = [];
          otherChanges[cu].push(chg.createdAt);
        }
      }
    }

    var windowMs = 7 * 24 * 60 * 60 * 1000;
    var otherKeys = Object.keys(otherChanges);
    for (i = 0; i < otherKeys.length; i++) {
      var oUid = otherKeys[i];
      var oTimes = otherChanges[oUid];
      var cascadeCount = 0;
      for (var tc = 0; tc < targetChanges.length; tc++) {
        for (var oc = 0; oc < oTimes.length; oc++) {
          var lag = oTimes[oc] - targetChanges[tc];
          if (lag > 0 && lag <= windowMs) {
            cascadeCount++;
          }
        }
      }
      if (cascadeCount > 0) cascades[oUid] = cascadeCount;
    }
  }

  // 3. Shared business service membership
  var targetServices = {};
  var ciServices = {}; // otherCi -> Set(serviceUid)
  for (i = 0; i < graph.edges.length; i++) {
    var edgeSvc = graph.edges[i];
    var hasT = false;
    var svcUid = null;
    var edgeCIs = [];
    for (j = 0; j < edgeSvc.elements.length; j++) {
      if (edgeSvc.elements[j] === targetCiUid) hasT = true;
      if (edgeSvc.elements[j].indexOf('service:') === 0) svcUid = edgeSvc.elements[j];
      if (ciSet[edgeSvc.elements[j]] && edgeSvc.elements[j] !== targetCiUid) {
        edgeCIs.push(edgeSvc.elements[j]);
      }
    }
    if (hasT && svcUid) targetServices[svcUid] = true;
    if (svcUid) {
      for (j = 0; j < edgeCIs.length; j++) {
        if (!ciServices[edgeCIs[j]]) ciServices[edgeCIs[j]] = {};
        ciServices[edgeCIs[j]][svcUid] = true;
      }
    }
  }
  var sharedService = {};
  var csKeys = Object.keys(ciServices);
  for (i = 0; i < csKeys.length; i++) {
    var svcSet = ciServices[csKeys[i]];
    var shared = 0;
    var sKeys = Object.keys(svcSet);
    for (j = 0; j < sKeys.length; j++) {
      if (targetServices[sKeys[j]]) shared++;
    }
    if (shared > 0) sharedService[csKeys[i]] = shared;
  }

  // 4. Network proximity (shared neighbor ratio)
  var targetNeighbors = {};
  var neighborCount = 0;
  if (edgeSet) {
    for (i = 0; i < graph.edges.length; i++) {
      if (!edgeSet.has(graph.edges[i].uid)) continue;
      for (j = 0; j < graph.edges[i].elements.length; j++) {
        var ne = graph.edges[i].elements[j];
        if (ne !== targetCiUid) {
          targetNeighbors[ne] = true;
          neighborCount++;
        }
      }
    }
  }

  var proximity = {};
  for (i = 0; i < ciUids.length; i++) {
    var otherUid = ciUids[i];
    if (otherUid === targetCiUid) continue;
    var otherEdgeSet = graph.incidence[otherUid];
    if (!otherEdgeSet) continue;
    var otherNeighbors = {};
    for (j = 0; j < graph.edges.length; j++) {
      if (!otherEdgeSet.has(graph.edges[j].uid)) continue;
      for (var k = 0; k < graph.edges[j].elements.length; k++) {
        var ne2 = graph.edges[j].elements[k];
        if (ne2 !== otherUid) otherNeighbors[ne2] = true;
      }
    }
    // Count shared neighbors
    var sharedN = 0;
    var totalN = 0;
    var onKeys = Object.keys(otherNeighbors);
    for (j = 0; j < onKeys.length; j++) {
      totalN++;
      if (targetNeighbors[onKeys[j]]) sharedN++;
    }
    var tnKeys = Object.keys(targetNeighbors);
    for (j = 0; j < tnKeys.length; j++) {
      if (!otherNeighbors[tnKeys[j]]) totalN++;
    }
    if (totalN > 0) {
      proximity[otherUid] = sharedN / totalN;
    }
  }

  // Normalize each signal
  var maxCooccur = 0, maxCascade = 0, maxSvcShare = 0;
  for (i = 0; i < ciUids.length; i++) {
    var u = ciUids[i];
    if ((cooccurCount[u] || 0) > maxCooccur) maxCooccur = cooccurCount[u];
    if ((cascades[u] || 0) > maxCascade) maxCascade = cascades[u];
    if ((sharedService[u] || 0) > maxSvcShare) maxSvcShare = sharedService[u];
  }

  // Combine scores
  var results = [];
  for (i = 0; i < ciUids.length; i++) {
    var cUid = ciUids[i];
    if (cUid === targetCiUid) continue;

    var sCooccur = maxCooccur > 0 ? (cooccurCount[cUid] || 0) / maxCooccur : 0;
    var sCascade = maxCascade > 0 ? (cascades[cUid] || 0) / maxCascade : 0;
    var sSvc = maxSvcShare > 0 ? (sharedService[cUid] || 0) / maxSvcShare : 0;
    var sProx = proximity[cUid] || 0;

    var probability = 0.35 * sCooccur + 0.25 * sCascade + 0.2 * sSvc + 0.2 * sProx;
    if (probability === 0) continue;

    // Determine primary reason
    var maxSignal = Math.max(sCooccur, sCascade, sSvc, sProx);
    var reason = 'network proximity';
    if (maxSignal === sCooccur && sCooccur > 0) {
      reason = 'frequently co-occurs in change requests';
    } else if (maxSignal === sCascade && sCascade > 0) {
      reason = 'temporal cascade pattern detected';
    } else if (maxSignal === sSvc && sSvc > 0) {
      reason = 'shared business service membership';
    }

    var cNode = nodeMap[cUid];
    results.push({
      ci: cUid,
      name: cNode ? cNode.name : cUid,
      probability: Math.round(probability * 10000) / 10000,
      reason: reason
    });
  }

  results.sort(function (x, y) { return y.probability - x.probability; });
  return results;
};

/**
 * Predict CI pairs most likely to appear together in future changes
 * using the Adamic-Adar index on the projected CI graph.
 *
 * Considers only pairs that do NOT currently co-occur.
 *
 * @param {Object} graph - Hypergraph from HypergraphCore.build()
 * @param {number} [topN=20] - Number of top predictions to return
 * @returns {Array<{a, b, nameA, nameB, score}>}
 */
AnalyticsEngine.prototype.linkPrediction = function (graph, topN) {
  topN = topN || 20;

  if (!graph || !graph.nodes) return [];

  var proj = this._projectedAdjacency(graph);
  var nodes = proj.nodes;
  var matrix = proj.matrix;
  var n = nodes.length;
  var nodeMap = this._nodeMap(graph);

  if (n < 2) return [];

  // Build neighbor sets and degree map
  var neighbors = {}; // uid -> { neighborUid: true }
  var degree = {};
  var i, j;
  for (i = 0; i < n; i++) {
    var uid = nodes[i];
    neighbors[uid] = {};
    var row = matrix[uid];
    var rKeys = Object.keys(row);
    for (j = 0; j < rKeys.length; j++) {
      if (row[rKeys[j]] > 0) {
        neighbors[uid][rKeys[j]] = true;
      }
    }
    degree[uid] = Object.keys(neighbors[uid]).length;
  }

  // Existing pairs
  var existingPairs = {};
  for (i = 0; i < n; i++) {
    var nKeys = Object.keys(neighbors[nodes[i]]);
    for (j = 0; j < nKeys.length; j++) {
      existingPairs[this._pairKey(nodes[i], nKeys[j])] = true;
    }
  }

  // Compute Adamic-Adar for non-existing pairs
  var results = [];
  for (i = 0; i < n; i++) {
    for (j = i + 1; j < n; j++) {
      var u = nodes[i];
      var v = nodes[j];
      var pk = this._pairKey(u, v);
      if (existingPairs[pk]) continue; // skip already-connected pairs

      // Common neighbors
      var score = 0;
      var uNeighbors = Object.keys(neighbors[u]);
      for (var k = 0; k < uNeighbors.length; k++) {
        var w = uNeighbors[k];
        if (neighbors[v][w]) {
          var degW = degree[w];
          if (degW > 1) {
            score += 1 / Math.log(degW);
          }
        }
      }

      if (score > 0) {
        var nU = nodeMap[u];
        var nV = nodeMap[v];
        results.push({
          a: u,
          b: v,
          nameA: nU ? nU.name : u,
          nameB: nV ? nV.name : v,
          score: Math.round(score * 10000) / 10000
        });
      }
    }
  }

  results.sort(function (x, y) { return y.score - x.score; });
  return results.slice(0, topN);
};

// ===================================================================
//  7. Incident Correlation
// ===================================================================

/**
 * Analyse incident patterns relative to the change/CI graph.
 *
 * @param {Array} incidents - Array of incident objects:
 *   { number, priority (1-4), affectedCI: {id, name},
 *     businessService: {id, name}, createdAt, resolvedAt,
 *     relatedIncidents: [], assignmentGroup: {id, name} }
 * @param {Object} graph - Hypergraph from HypergraphCore.build()
 * @returns {Object} { faultPropagation, hotspots, serviceFingerprints }
 */
AnalyticsEngine.prototype.incidentCorrelation = function (incidents, graph) {
  if (!incidents || incidents.length === 0) {
    return { faultPropagation: [], hotspots: [], serviceFingerprints: {} };
  }

  var nodeMap = graph ? this._nodeMap(graph) : {};
  var i, j;

  // --- Fault Propagation ---
  // For each CI, build a timeline of incidents sorted by createdAt
  var ciIncidents = {}; // ciUid -> [{ time, number }]
  for (i = 0; i < incidents.length; i++) {
    var inc = incidents[i];
    if (!inc.affectedCI || !inc.affectedCI.id) continue;
    var ciUid = 'ci:' + inc.affectedCI.id;
    if (!ciIncidents[ciUid]) ciIncidents[ciUid] = [];
    ciIncidents[ciUid].push({
      time: this._parseDate(inc.createdAt),
      number: inc.number
    });
  }
  var ciKeys = Object.keys(ciIncidents);
  for (i = 0; i < ciKeys.length; i++) {
    ciIncidents[ciKeys[i]].sort(function (a, b) { return a.time - b.time; });
  }

  // Detect propagation: incident on CI-A followed by incident on CI-B within 24h
  var propMap = {}; // "A|B" -> { count, totalLag }
  var propWindowMs = 24 * 60 * 60 * 1000;
  for (i = 0; i < ciKeys.length; i++) {
    for (j = 0; j < ciKeys.length; j++) {
      if (i === j) continue;
      var srcInc = ciIncidents[ciKeys[i]];
      var tgtInc = ciIncidents[ciKeys[j]];
      for (var si = 0; si < srcInc.length; si++) {
        if (srcInc[si].time === 0) continue;
        for (var ti = 0; ti < tgtInc.length; ti++) {
          if (tgtInc[ti].time === 0) continue;
          var lag = tgtInc[ti].time - srcInc[si].time;
          if (lag > 0 && lag <= propWindowMs) {
            var propKey = ciKeys[i] + '|' + ciKeys[j];
            if (!propMap[propKey]) propMap[propKey] = { count: 0, totalLag: 0 };
            propMap[propKey].count++;
            propMap[propKey].totalLag += lag;
          }
        }
      }
    }
  }

  var faultPropagation = [];
  var propKeys = Object.keys(propMap);
  for (i = 0; i < propKeys.length; i++) {
    var parts = propKeys[i].split('|');
    var entry = propMap[propKeys[i]];
    faultPropagation.push({
      source: parts[0],
      target: parts[1],
      count: entry.count,
      avgLagHours: Math.round((entry.totalLag / entry.count) / (60 * 60 * 1000) * 100) / 100
    });
  }
  faultPropagation.sort(function (a, b) { return b.count - a.count; });

  // --- Hotspots ---
  var ciHotspot = {}; // ciUid -> { count, prioritySum, times: [] }
  for (i = 0; i < incidents.length; i++) {
    var hInc = incidents[i];
    if (!hInc.affectedCI || !hInc.affectedCI.id) continue;
    var hUid = 'ci:' + hInc.affectedCI.id;
    if (!ciHotspot[hUid]) {
      ciHotspot[hUid] = { count: 0, prioritySum: 0, times: [] };
    }
    ciHotspot[hUid].count++;
    ciHotspot[hUid].prioritySum += (hInc.priority || 4);
    ciHotspot[hUid].times.push(this._parseDate(hInc.createdAt));
  }

  var hotspots = [];
  var hKeys = Object.keys(ciHotspot);
  for (i = 0; i < hKeys.length; i++) {
    var hs = ciHotspot[hKeys[i]];
    var avgPriority = hs.count > 0 ? hs.prioritySum / hs.count : 4;

    // MTBF (Mean Time Between Failures)
    var times = hs.times.filter(function (t) { return t > 0; });
    times.sort(function (a, b) { return a - b; });
    var mtbfHours = 0;
    if (times.length > 1) {
      var totalGap = 0;
      for (j = 1; j < times.length; j++) {
        totalGap += times[j] - times[j - 1];
      }
      mtbfHours = (totalGap / (times.length - 1)) / (60 * 60 * 1000);
    }

    var hNode = nodeMap[hKeys[i]];
    hotspots.push({
      ci: hKeys[i],
      name: hNode ? hNode.name : hKeys[i],
      incidentCount: hs.count,
      avgPriority: Math.round(avgPriority * 100) / 100,
      mtbf: Math.round(mtbfHours * 100) / 100
    });
  }
  hotspots.sort(function (a, b) { return b.incidentCount - a.incidentCount; });

  // --- Service Fingerprints ---
  var serviceFingerprints = {};
  for (i = 0; i < incidents.length; i++) {
    var sfInc = incidents[i];
    if (!sfInc.businessService || !sfInc.businessService.id) continue;
    var svcUid = 'service:' + sfInc.businessService.id;
    if (!serviceFingerprints[svcUid]) {
      serviceFingerprints[svcUid] = {
        affectedCIs: {},
        resolutionTimes: [],
        incidentCount: 0
      };
    }
    var fp = serviceFingerprints[svcUid];
    fp.incidentCount++;
    if (sfInc.affectedCI && sfInc.affectedCI.id) {
      fp.affectedCIs['ci:' + sfInc.affectedCI.id] = true;
    }
    // Resolution time
    var created = this._parseDate(sfInc.createdAt);
    var resolved = this._parseDate(sfInc.resolvedAt);
    if (created > 0 && resolved > 0 && resolved > created) {
      fp.resolutionTimes.push(resolved - created);
    }
  }

  // Finalize fingerprints
  var finalFingerprints = {};
  var fpKeys = Object.keys(serviceFingerprints);
  for (i = 0; i < fpKeys.length; i++) {
    var sfp = serviceFingerprints[fpKeys[i]];
    var affectedArr = Object.keys(sfp.affectedCIs);
    var totalResMs = 0;
    for (j = 0; j < sfp.resolutionTimes.length; j++) {
      totalResMs += sfp.resolutionTimes[j];
    }
    var avgResHours = sfp.resolutionTimes.length > 0
      ? (totalResMs / sfp.resolutionTimes.length) / (60 * 60 * 1000)
      : 0;

    // Pattern: concentrated if <= 3 CIs affected, distributed otherwise
    var pattern = affectedArr.length <= 3 ? 'concentrated' : 'distributed';

    finalFingerprints[fpKeys[i]] = {
      affectedCIs: affectedArr,
      pattern: pattern,
      avgResolutionHours: Math.round(avgResHours * 100) / 100
    };
  }

  return {
    faultPropagation: faultPropagation,
    hotspots: hotspots,
    serviceFingerprints: finalFingerprints
  };
};
