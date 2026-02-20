/**
 * RiskAnalysis — Risk heatmap generation and scoring
 *
 * Extends AnalyticsEngine.prototype. Requires analytics/AnalyticsEngine.js.
 */

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

  var changeList = this._changeList(rawData || { taskCiRecords: [] });

  // Per-CI metrics
  var ciStats = {}; // uid -> { changeCount, emergencyCount, coupledCIs (Set) }
  for (i = 0; i < ciUids.length; i++) {
    ciStats[ciUids[i]] = { changeCount: 0, emergencyCount: 0, coupledCIs: {} };
  }

  // Accumulate from change list
  for (i = 0; i < changeList.length; i++) {
    var chg = changeList[i];
    var isEmergency = (chg.changeType === 'Emergency');
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
