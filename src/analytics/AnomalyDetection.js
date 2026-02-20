/**
 * AnomalyDetection — Statistical anomaly detection in task and CI data
 *
 * Extends AnalyticsEngine.prototype. Requires analytics/AnalyticsEngine.js.
 */

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
