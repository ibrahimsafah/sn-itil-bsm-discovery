/**
 * ImpactPrediction — Impact prediction and link prediction analysis
 *
 * Extends AnalyticsEngine.prototype. Requires analytics/AnalyticsEngine.js.
 */

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
  if (rawData && rawData.taskCiRecords) {
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
