/**
 * CommunityDetection — Graph community detection and summarization
 *
 * Extends AnalyticsEngine.prototype. Requires analytics/AnalyticsEngine.js.
 */

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
