/**
 * IncidentCorrelation — Incident correlation and pattern analysis
 *
 * Extends AnalyticsEngine.prototype. Requires analytics/AnalyticsEngine.js.
 */

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
