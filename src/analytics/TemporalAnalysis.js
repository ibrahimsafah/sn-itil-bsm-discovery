/**
 * TemporalAnalysis — Temporal cascade and change velocity analysis
 *
 * Extends AnalyticsEngine.prototype. Requires analytics/AnalyticsEngine.js.
 */

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

  if (!rawData || !rawData.taskCiRecords) return [];

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
  if (!rawData || !rawData.taskCiRecords) return {};

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
