/**
 * CooccurrenceAnalysis — Weighted co-occurrence matrix computation
 *
 * Extends AnalyticsEngine.prototype. Requires analytics/AnalyticsEngine.js.
 */

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

  var changeList = this._changeList(rawData || { taskCiRecords: [] });

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
    var groupName = edge.assignmentGroup || (chgData ? chgData.assignmentGroup : '');

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
