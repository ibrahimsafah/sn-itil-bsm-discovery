/**
 * AnalyticsEngine — Base constructor and shared internal helpers.
 *
 * This file MUST load before any analytics extension files.
 * Extensions add public methods to AnalyticsEngine.prototype.
 *
 * Usage:
 *   var engine = new AnalyticsEngine();
 *   var scores = engine.centrality(graph);
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
 * Build a flat change list with timestamps from rawData.taskCiRecords.
 * Groups flat task_ci rows by task.number into per-change entries.
 * Each entry: { number, createdAt (ms), risk, changeType, impact,
 *               region, assignmentGroup, ciUids: [...] }
 * @private
 */
AnalyticsEngine.prototype._changeList = function (rawData) {
  var records = rawData.taskCiRecords;
  if (!records || records.length === 0) return [];

  // Group task_ci records by change number
  var changeMap = {};
  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    var num = rec['task.number'];
    if (!changeMap[num]) {
      changeMap[num] = {
        number: num,
        createdAt: this._parseDate(rec['task.sys_created_on']),
        risk: rec['task.risk'] || 'Low',
        changeType: rec['task.type'] || 'Standard',
        impact: rec['task.impact'] || '3 - Low',
        region: rec['task.u_impact_region'] || '',
        assignmentGroup: rec['task.assignment_group'] || '',
        businessService: rec['task.business_service'] || '',
        ciUids: []
      };
    }
    changeMap[num].ciUids.push('ci:' + rec['ci_item.sys_id']);
  }

  var list = [];
  var nums = Object.keys(changeMap);
  for (var j = 0; j < nums.length; j++) {
    list.push(changeMap[nums[j]]);
  }
  // Sort by createdAt ascending
  list.sort(function (a, b) { return a.createdAt - b.createdAt; });
  return list;
};
