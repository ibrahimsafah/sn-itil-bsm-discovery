/**
 * BSMDiscoveryAnalytics — analytics panel tab rendering
 *
 * Extends BSMDiscovery.prototype. Requires app/BSMDiscovery.js.
 */

BSMDiscovery.prototype._bindAnalyticsControls = function () {
  var self = this;

  // Analytics panel toggle button
  var toggleBtn = document.getElementById('analytics-toggle');
  var analyticsPanel = document.getElementById('analytics-panel');
  if (toggleBtn && analyticsPanel) {
    toggleBtn.addEventListener('click', function () {
      var isOpen = analyticsPanel.classList.contains('open');
      if (isOpen) {
        analyticsPanel.classList.remove('open');
        toggleBtn.textContent = 'Analytics \u25B6';
      } else {
        analyticsPanel.classList.add('open');
        toggleBtn.textContent = 'Analytics \u25C0';
      }
    });
  }

  // Analytics collapse button
  var collapseBtn = document.getElementById('analytics-collapse');
  if (collapseBtn && analyticsPanel) {
    collapseBtn.addEventListener('click', function () {
      analyticsPanel.classList.remove('open');
      if (toggleBtn) toggleBtn.textContent = 'Analytics \u25B6';
    });
  }

  // Tab switching
  var tabBtns = document.querySelectorAll('.analytics-tab');
  var tabContents = document.querySelectorAll('.analytics-tab-content');
  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tabName = btn.getAttribute('data-tab');
      self._activeTab = tabName;

      // Update active tab button
      tabBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      // Show corresponding content
      tabContents.forEach(function (tc) { tc.classList.remove('active'); });
      var target = document.getElementById('tab-' + tabName);
      if (target) target.classList.add('active');

      // Update renderer viz mode based on tab
      self._renderer.clearAnalyticsOverlays();
      if (tabName === 'centrality') {
        self._renderer.setVizMode('centrality');
      } else if (tabName === 'clusters') {
        self._renderer.setVizMode('cluster');
      } else if (tabName === 'anomalies') {
        self._renderer.setVizMode('risk');
      } else {
        self._renderer.setVizMode('type');
      }
    });
  });

  // Metric toggle buttons
  var metricBtns = document.querySelectorAll('.metric-btn');
  metricBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var metric = btn.getAttribute('data-metric');
      metricBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      // Re-render centrality panel with selected metric
      self._renderCentralityPanel(metric);

      // Update renderer
      var centralityData = self._analyticsData.centrality;
      if (centralityData && centralityData[metric]) {
        self._renderer.setCentralityData(centralityData[metric], metric);
      }
    });
  });

  // Impact CI select
  var impactSelect = document.getElementById('impact-ci-select');
  if (impactSelect) {
    impactSelect.addEventListener('change', function () {
      var selectedUid = impactSelect.value;
      if (!selectedUid) {
        var resultsEl = document.getElementById('impact-results');
        if (resultsEl) resultsEl.innerHTML = '';
        self._renderer.clearAnalyticsOverlays();
        return;
      }
      var results = self._analytics.predictImpact(
        self._originalGraph,
        self._rawData,
        selectedUid
      );
      self._renderImpactResults(results, selectedUid);
    });
  }
};

// ==========================================================================
//  Panel Rendering Methods
// ==========================================================================

// ---------- Centrality Panel ----------

BSMDiscovery.prototype._renderCentralityPanel = function (metric) {
  var container = document.getElementById('centrality-rankings');
  if (!container) return;

  var data = this._analyticsData.centrality;
  if (!data || !data[metric]) {
    container.innerHTML = '<div class="analytics-empty">No centrality data available</div>';
    return;
  }

  var scores = data[metric];
  var nameMap = this._buildNameMap(this._originalGraph);
  var self = this;

  // Build sorted array
  var entries = [];
  var keys = Object.keys(scores);
  for (var i = 0; i < keys.length; i++) {
    entries.push({
      uid: keys[i],
      name: nameMap[keys[i]] || keys[i],
      score: scores[keys[i]],
      type: self._nodeType(keys[i])
    });
  }
  entries.sort(function (a, b) { return b.score - a.score; });
  entries = entries.slice(0, 15);

  if (entries.length === 0) {
    container.innerHTML = '<div class="analytics-empty">No nodes found</div>';
    return;
  }

  var html = '';
  for (var j = 0; j < entries.length; j++) {
    var e = entries[j];
    var pct = Math.round(e.score * 100);
    html += '<div class="ranking-item" data-uid="' + e.uid + '">';
    html += '<span class="ranking-rank">' + (j + 1) + '</span>';
    html += '<div class="ranking-info">';
    html += '<div class="ranking-name">' + e.name + '</div>';
    html += '<div class="ranking-detail">' + this._typeBadge(e.uid) + '</div>';
    html += '</div>';
    html += '<div class="ranking-score">' + (Math.round(e.score * 10000) / 10000) + '</div>';
    html += '<div class="ranking-bar"><div class="ranking-bar-fill" style="width:' + pct + '%"></div></div>';
    html += '</div>';
  }
  container.innerHTML = html;

  // Click handlers on ranking items
  var items = container.querySelectorAll('.ranking-item');
  items.forEach(function (item) {
    item.addEventListener('click', function () {
      var uid = item.getAttribute('data-uid');
      items.forEach(function (it) { it.classList.remove('active'); });
      item.classList.add('active');
      self._renderer.highlightNodes([uid]);
    });
  });
};

// ---------- Temporal Panel ----------

BSMDiscovery.prototype._renderTemporalPanel = function () {
  var self = this;
  var nameMap = this._buildNameMap(this._originalGraph);

  // Cascades
  var cascadeContainer = document.getElementById('cascade-list');
  if (cascadeContainer) {
    var cascades = this._analyticsData.cascades;
    if (!cascades || cascades.length === 0) {
      cascadeContainer.innerHTML = '<div class="analytics-empty">No temporal cascades detected</div>';
    } else {
      var cHtml = '';
      var maxCount = cascades[0].count;
      for (var i = 0; i < Math.min(cascades.length, 15); i++) {
        var c = cascades[i];
        var srcName = nameMap[c.source] || c.source;
        var tgtName = nameMap[c.target] || c.target;
        cHtml += '<div class="cascade-item" data-idx="' + i + '">';
        cHtml += '<span class="cascade-source">' + srcName + '</span>';
        cHtml += '<span class="cascade-arrow">\u2192</span>';
        cHtml += '<span class="cascade-target">' + tgtName + '</span>';
        cHtml += '<span class="cascade-count">' + c.count + ' (' + c.avgLagDays + 'd avg)</span>';
        cHtml += '</div>';
      }
      cascadeContainer.innerHTML = cHtml;

      // Click handlers for cascade items
      var cascadeItems = cascadeContainer.querySelectorAll('.cascade-item');
      cascadeItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var idx = parseInt(item.getAttribute('data-idx'), 10);
          var cascade = cascades[idx];
          cascadeItems.forEach(function (ci) { ci.classList.remove('active'); });
          item.classList.add('active');
          self._renderer.setCascadeOverlays([{
            source: cascade.source,
            target: cascade.target,
            count: cascade.count
          }]);
          self._renderer.highlightNodes([cascade.source, cascade.target]);
        });
      });
    }
  }

  // Velocity
  var velocityContainer = document.getElementById('velocity-list');
  if (velocityContainer) {
    var velocity = this._analyticsData.velocity;
    if (!velocity || Object.keys(velocity).length === 0) {
      velocityContainer.innerHTML = '<div class="analytics-empty">No velocity data available</div>';
    } else {
      var vEntries = [];
      var vKeys = Object.keys(velocity);
      for (var v = 0; v < vKeys.length; v++) {
        vEntries.push({
          uid: vKeys[v],
          name: nameMap[vKeys[v]] || vKeys[v],
          data: velocity[vKeys[v]]
        });
      }
      // Sort by avg descending
      vEntries.sort(function (a, b) { return b.data.avg - a.data.avg; });
      vEntries = vEntries.slice(0, 15);

      var vHtml = '';
      for (var vi = 0; vi < vEntries.length; vi++) {
        var ve = vEntries[vi];
        var trendClass = 'trend-stable';
        var trendIcon = '\u2194';
        if (ve.data.trend === 'increasing') {
          trendClass = 'trend-up';
          trendIcon = '\u2191';
        } else if (ve.data.trend === 'decreasing') {
          trendClass = 'trend-down';
          trendIcon = '\u2193';
        }
        vHtml += '<div class="ranking-item" data-uid="' + ve.uid + '">';
        vHtml += '<div class="ranking-info">';
        vHtml += '<div class="ranking-name">' + ve.name + '</div>';
        vHtml += '<div class="ranking-detail">avg ' + ve.data.avg + '/wk, max ' + ve.data.max + '/wk</div>';
        vHtml += '</div>';
        vHtml += '<span class="' + trendClass + '">' + trendIcon + ' ' + ve.data.trend + '</span>';
        vHtml += '</div>';
      }
      velocityContainer.innerHTML = vHtml;

      // Click handlers for velocity items
      var velItems = velocityContainer.querySelectorAll('.ranking-item');
      velItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var uid = item.getAttribute('data-uid');
          self._renderer.highlightNodes([uid]);
        });
      });
    }
  }
};

// ---------- Anomalies Panel ----------

BSMDiscovery.prototype._renderAnomaliesPanel = function () {
  var self = this;
  var nameMap = this._buildNameMap(this._originalGraph);

  // Risk Heatmap
  var riskContainer = document.getElementById('risk-heatmap');
  if (riskContainer) {
    var riskData = this._analyticsData.riskHeatmap;
    if (!riskData || riskData.length === 0) {
      riskContainer.innerHTML = '<div class="analytics-empty">No risk data available</div>';
    } else {
      var rHtml = '';
      var topRisk = riskData.slice(0, 15);
      for (var r = 0; r < topRisk.length; r++) {
        var ri = topRisk[r];
        var riskColor = ri.riskScore > 70 ? '#ff8a80' : (ri.riskScore > 40 ? '#ffb74d' : '#81c784');
        rHtml += '<div class="risk-item" data-uid="' + ri.ci + '">';
        rHtml += '<div class="ranking-info">';
        rHtml += '<div class="ranking-name">' + ri.name + '</div>';
        rHtml += '<div class="ranking-detail">';
        rHtml += 'Changes: ' + ri.factors.changeFrequency;
        rHtml += ' | Emergency: ' + (Math.round(ri.factors.emergencyRatio * 100)) + '%';
        rHtml += ' | Incidents: ' + ri.factors.incidentRate;
        rHtml += ' | Coupling: ' + ri.factors.couplingDensity;
        rHtml += '</div>';
        rHtml += '</div>';
        rHtml += '<div class="risk-score" style="color:' + riskColor + '">' + ri.riskScore + '</div>';
        rHtml += '<div class="risk-bar"><div class="risk-bar-fill" style="width:' + ri.riskScore + '%;background:' + riskColor + '"></div></div>';
        rHtml += '</div>';
      }
      riskContainer.innerHTML = rHtml;

      // Click handlers
      var riskItems = riskContainer.querySelectorAll('.risk-item');
      riskItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var uid = item.getAttribute('data-uid');
          riskItems.forEach(function (ri) { ri.classList.remove('active'); });
          item.classList.add('active');
          self._renderer.highlightNodes([uid]);
        });
      });
    }
  }

  // Unexpected Pairs
  var unexpectedContainer = document.getElementById('unexpected-pairs');
  if (unexpectedContainer) {
    var anomalies = this._analyticsData.anomalies;
    var unexpected = anomalies ? anomalies.unexpectedPairs : [];
    if (!unexpected || unexpected.length === 0) {
      unexpectedContainer.innerHTML = '<div class="analytics-empty">No unexpected pairs detected</div>';
    } else {
      var uHtml = '';
      for (var u = 0; u < Math.min(unexpected.length, 10); u++) {
        var up = unexpected[u];
        var severityClass = up.ratio > 5 ? 'danger' : 'warning';
        uHtml += '<div class="anomaly-alert ' + severityClass + '" data-a="' + up.a + '" data-b="' + up.b + '">';
        uHtml += '<div class="ranking-name">' + up.nameA + ' \u2194 ' + up.nameB + '</div>';
        uHtml += '<div class="ranking-detail">';
        uHtml += up.classA + ' \u00D7 ' + up.classB;
        uHtml += ' | actual: ' + up.actual + ', expected: ' + up.expected;
        uHtml += ' | ratio: ' + up.ratio + 'x';
        uHtml += '</div>';
        uHtml += '</div>';
      }
      unexpectedContainer.innerHTML = uHtml;

      // Click handlers
      var unexpItems = unexpectedContainer.querySelectorAll('.anomaly-alert');
      unexpItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var a = item.getAttribute('data-a');
          var b = item.getAttribute('data-b');
          self._renderer.highlightNodes([a, b]);
        });
      });
    }
  }

  // Orphan CIs
  var orphanContainer = document.getElementById('orphan-list');
  if (orphanContainer) {
    var orphans = (this._analyticsData.anomalies && this._analyticsData.anomalies.orphans) ? this._analyticsData.anomalies.orphans : [];
    if (orphans.length === 0) {
      orphanContainer.innerHTML = '<div class="analytics-empty">No orphan CIs detected</div>';
    } else {
      var oHtml = '';
      for (var o = 0; o < Math.min(orphans.length, 15); o++) {
        var orph = orphans[o];
        oHtml += '<div class="anomaly-alert warning" data-uid="' + orph.uid + '">';
        oHtml += '<div class="ranking-name">' + orph.name + '</div>';
        oHtml += '<div class="ranking-detail">Degree: ' + orph.degree + ' \u2014 ' + orph.reason + '</div>';
        oHtml += '</div>';
      }
      orphanContainer.innerHTML = oHtml;

      // Click handlers
      var orphanItems = orphanContainer.querySelectorAll('.anomaly-alert');
      orphanItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var uid = item.getAttribute('data-uid');
          self._renderer.highlightNodes([uid]);
        });
      });
    }
  }

  // Over-Coupled Pairs
  var overcoupledContainer = document.getElementById('overcoupled-list');
  if (overcoupledContainer) {
    var overCoupled = (this._analyticsData.anomalies && this._analyticsData.anomalies.overCoupled) ? this._analyticsData.anomalies.overCoupled : [];
    if (overCoupled.length === 0) {
      overcoupledContainer.innerHTML = '<div class="analytics-empty">No over-coupled pairs detected</div>';
    } else {
      var ocHtml = '';
      for (var oc = 0; oc < Math.min(overCoupled.length, 10); oc++) {
        var ocp = overCoupled[oc];
        ocHtml += '<div class="anomaly-alert danger" data-a="' + ocp.a + '" data-b="' + ocp.b + '">';
        ocHtml += '<div class="ranking-name">' + ocp.nameA + ' \u2194 ' + ocp.nameB + '</div>';
        ocHtml += '<div class="ranking-detail">';
        ocHtml += 'Jaccard: ' + ocp.jaccard + ' | Shared changes: ' + ocp.sharedChanges;
        ocHtml += '</div>';
        ocHtml += '</div>';
      }
      overcoupledContainer.innerHTML = ocHtml;

      // Click handlers
      var ocItems = overcoupledContainer.querySelectorAll('.anomaly-alert');
      ocItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var a = item.getAttribute('data-a');
          var b = item.getAttribute('data-b');
          self._renderer.highlightNodes([a, b]);
        });
      });
    }
  }
};

// ---------- Clusters Panel ----------

BSMDiscovery.prototype._renderClustersPanel = function () {
  var self = this;
  var nameMap = this._buildNameMap(this._originalGraph);
  var communities = this._analyticsData.communities;

  // Summary
  var summaryContainer = document.getElementById('cluster-summary');
  if (summaryContainer) {
    if (!communities || !communities.summary || communities.summary.length === 0) {
      summaryContainer.innerHTML = '<div class="analytics-empty">No communities detected</div>';
    } else {
      var sHtml = '';
      sHtml += '<div class="cluster-stat">Communities detected: <strong>' + communities.summary.length + '</strong></div>';
      sHtml += '<div class="cluster-stat">Modularity: <strong>' + communities.modularity + '</strong></div>';
      summaryContainer.innerHTML = sHtml;
    }
  }

  // Cluster Details
  var detailsContainer = document.getElementById('cluster-details');
  if (detailsContainer) {
    if (!communities || !communities.communities || Object.keys(communities.communities).length === 0) {
      detailsContainer.innerHTML = '<div class="analytics-empty">No cluster details available</div>';
    } else {
      var comIds = Object.keys(communities.communities);
      // Build summary lookup
      var summaryLookup = {};
      if (communities.summary) {
        for (var si = 0; si < communities.summary.length; si++) {
          summaryLookup[communities.summary[si].id] = communities.summary[si];
        }
      }

      var clusterPalette = [
        '#4fc3f7', '#ff8a65', '#81c784', '#ce93d8',
        '#ffd54f', '#4dd0e1', '#f48fb1', '#a5d6a7',
        '#90caf9', '#ffab91', '#80cbc4', '#e6ee9c'
      ];

      var dHtml = '';
      for (var ci = 0; ci < comIds.length; ci++) {
        var comId = comIds[ci];
        var members = communities.communities[comId];
        var summary = summaryLookup[comId] || {};
        var color = clusterPalette[ci % clusterPalette.length];

        dHtml += '<div class="cluster-card" data-cluster="' + comId + '" style="border-left: 3px solid ' + color + '">';
        dHtml += '<div class="cluster-header">';
        dHtml += '<strong>Cluster ' + comId + '</strong>';
        dHtml += '<span class="cluster-stat">' + members.length + ' members</span>';
        dHtml += '</div>';
        if (summary.dominantType) {
          dHtml += '<div class="ranking-detail">Type: ' + summary.dominantType + '</div>';
        }
        if (summary.dominantService) {
          dHtml += '<div class="ranking-detail">Service: ' + summary.dominantService + '</div>';
        }
        dHtml += '<div class="cluster-members" style="display:none;">';
        for (var mi = 0; mi < members.length; mi++) {
          var memberName = nameMap[members[mi]] || members[mi];
          dHtml += '<div class="cluster-member">' + self._typeBadge(members[mi]) + ' ' + memberName + '</div>';
        }
        dHtml += '</div>';
        dHtml += '</div>';
      }
      detailsContainer.innerHTML = dHtml;

      // Click handlers for cluster cards
      var clusterCards = detailsContainer.querySelectorAll('.cluster-card');
      clusterCards.forEach(function (card) {
        card.addEventListener('click', function () {
          var clusterId = card.getAttribute('data-cluster');

          // Toggle member list expansion
          var memberList = card.querySelector('.cluster-members');
          if (memberList) {
            var isHidden = memberList.style.display === 'none';
            memberList.style.display = isHidden ? 'block' : 'none';
          }

          // Highlight cluster members in graph
          var clusterMembers = communities.communities[clusterId] || [];
          self._renderer.setVizMode('cluster');
          self._renderer.highlightNodes(clusterMembers);
        });
      });
    }
  }
};

// ---------- Impact Panel ----------

BSMDiscovery.prototype._renderImpactPanel = function () {
  var self = this;
  var graph = this._originalGraph;
  var nameMap = this._buildNameMap(graph);

  // Populate CI select dropdown
  var selectEl = document.getElementById('impact-ci-select');
  if (selectEl) {
    // Clear existing options (except the default)
    var optHtml = '<option value="">Select a CI...</option>';
    var ciNodes = [];
    for (var i = 0; i < graph.nodes.length; i++) {
      if (graph.nodes[i].type === 'ci') {
        ciNodes.push(graph.nodes[i]);
      }
    }
    // Sort by name
    ciNodes.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    for (var j = 0; j < ciNodes.length; j++) {
      optHtml += '<option value="' + ciNodes[j].uid + '">' + ciNodes[j].name + '</option>';
    }
    selectEl.innerHTML = optHtml;
  }

  // Predicted Links
  var linksContainer = document.getElementById('predicted-links');
  if (linksContainer) {
    var predictions = this._analyticsData.linkPredictions;
    if (!predictions || predictions.length === 0) {
      linksContainer.innerHTML = '<div class="analytics-empty">No link predictions available</div>';
    } else {
      var maxScore = predictions[0].score;
      var lHtml = '';
      for (var li = 0; li < Math.min(predictions.length, 15); li++) {
        var lp = predictions[li];
        var barPct = maxScore > 0 ? Math.round((lp.score / maxScore) * 100) : 0;
        lHtml += '<div class="ranking-item" data-a="' + lp.a + '" data-b="' + lp.b + '">';
        lHtml += '<div class="ranking-info">';
        lHtml += '<div class="ranking-name">' + (lp.nameA || lp.aName || lp.a) + ' \u2194 ' + (lp.nameB || lp.bName || lp.b) + '</div>';
        lHtml += '<div class="ranking-detail">Adamic-Adar score: ' + lp.score + '</div>';
        lHtml += '</div>';
        lHtml += '<div class="ranking-bar"><div class="ranking-bar-fill" style="width:' + barPct + '%"></div></div>';
        lHtml += '</div>';
      }
      linksContainer.innerHTML = lHtml;

      // Click handlers
      var linkItems = linksContainer.querySelectorAll('.ranking-item');
      linkItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var a = item.getAttribute('data-a');
          var b = item.getAttribute('data-b');
          self._renderer.highlightNodes([a, b]);
        });
      });
    }
  }
};

// Impact Results (called when CI is selected)

BSMDiscovery.prototype._renderImpactResults = function (results, targetUid) {
  var self = this;
  var container = document.getElementById('impact-results');
  if (!container) return;

  if (!results || results.length === 0) {
    container.innerHTML = '<div class="analytics-empty">No impacted CIs predicted for this selection</div>';
    self._renderer.highlightNodes([targetUid]);
    return;
  }

  var html = '';
  var topResults = results.slice(0, 15);
  for (var i = 0; i < topResults.length; i++) {
    var r = topResults[i];
    var probPct = Math.round(r.probability * 100);
    html += '<div class="impact-item" data-uid="' + r.ci + '">';
    html += '<div class="ranking-info">';
    html += '<div class="ranking-name">' + r.name + '</div>';
    html += '<div class="impact-reason">' + r.reason + '</div>';
    html += '</div>';
    html += '<div class="impact-probability">' + probPct + '%</div>';
    html += '<div class="impact-bar"><div class="impact-bar-fill" style="width:' + probPct + '%"></div></div>';
    html += '</div>';
  }
  container.innerHTML = html;

  // Highlight the target + top impacted CIs
  var highlightUids = [targetUid];
  for (var j = 0; j < topResults.length; j++) {
    highlightUids.push(topResults[j].ci);
  }
  self._renderer.highlightNodes(highlightUids);

  // Click handlers for impact items
  var impactItems = container.querySelectorAll('.impact-item');
  impactItems.forEach(function (item) {
    item.addEventListener('click', function () {
      var uid = item.getAttribute('data-uid');
      impactItems.forEach(function (ii) { ii.classList.remove('active'); });
      item.classList.add('active');
      self._renderer.highlightNodes([targetUid, uid]);
    });
  });
};

// ---------- Incidents Panel ----------

BSMDiscovery.prototype._renderIncidentsPanel = function () {
  var self = this;
  var nameMap = this._buildNameMap(this._originalGraph);
  var incData = this._analyticsData.incidentCorrelation;

  // Fault Propagation
  var faultContainer = document.getElementById('fault-propagation');
  if (faultContainer) {
    var faults = incData ? incData.faultPropagation : [];
    if (!faults || faults.length === 0) {
      faultContainer.innerHTML = '<div class="analytics-empty">No fault propagation patterns detected</div>';
    } else {
      var fHtml = '';
      for (var fi = 0; fi < Math.min(faults.length, 15); fi++) {
        var fp = faults[fi];
        var srcName = nameMap[fp.source] || fp.source;
        var tgtName = nameMap[fp.target] || fp.target;
        fHtml += '<div class="incident-item" data-src="' + fp.source + '" data-tgt="' + fp.target + '">';
        fHtml += '<span class="cascade-source">' + srcName + '</span>';
        fHtml += '<span class="cascade-arrow">\u2192</span>';
        fHtml += '<span class="cascade-target">' + tgtName + '</span>';
        fHtml += '<span class="cascade-count">' + fp.count + ' events (' + fp.avgLagHours + 'h avg)</span>';
        fHtml += '</div>';
      }
      faultContainer.innerHTML = fHtml;

      // Click handlers
      var faultItems = faultContainer.querySelectorAll('.incident-item');
      faultItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var src = item.getAttribute('data-src');
          var tgt = item.getAttribute('data-tgt');
          self._renderer.highlightNodes([src, tgt]);
        });
      });
    }
  }

  // Incident Hotspots
  var hotspotsContainer = document.getElementById('incident-hotspots');
  if (hotspotsContainer) {
    var hotspots = incData ? incData.hotspots : [];
    if (!hotspots || hotspots.length === 0) {
      hotspotsContainer.innerHTML = '<div class="analytics-empty">No incident hotspots detected</div>';
    } else {
      var hHtml = '';
      var maxInc = hotspots[0].incidentCount;
      for (var hi = 0; hi < Math.min(hotspots.length, 15); hi++) {
        var hs = hotspots[hi];
        var barPct = maxInc > 0 ? Math.round((hs.incidentCount / maxInc) * 100) : 0;
        hHtml += '<div class="hotspot-item" data-uid="' + hs.ci + '">';
        hHtml += '<div class="ranking-info">';
        hHtml += '<div class="ranking-name">' + hs.name + '</div>';
        hHtml += '<div class="ranking-detail">';
        hHtml += 'Incidents: ' + hs.incidentCount;
        hHtml += ' | Avg Priority: ' + hs.avgPriority;
        if (hs.mtbf > 0) {
          hHtml += ' | MTBF: ' + hs.mtbf + 'h';
        }
        hHtml += '</div>';
        hHtml += '</div>';
        hHtml += '<div class="ranking-bar"><div class="ranking-bar-fill" style="width:' + barPct + '%"></div></div>';
        hHtml += '</div>';
      }
      hotspotsContainer.innerHTML = hHtml;

      // Click handlers
      var hsItems = hotspotsContainer.querySelectorAll('.hotspot-item');
      hsItems.forEach(function (item) {
        item.addEventListener('click', function () {
          var uid = item.getAttribute('data-uid');
          self._renderer.highlightNodes([uid]);
        });
      });
    }
  }

  // Service Fingerprints
  var fpContainer = document.getElementById('service-fingerprints');
  if (fpContainer) {
    var fingerprints = incData ? incData.serviceFingerprints : {};
    var fpKeys = Object.keys(fingerprints);
    if (fpKeys.length === 0) {
      fpContainer.innerHTML = '<div class="analytics-empty">No service fingerprints available</div>';
    } else {
      var fpHtml = '';
      for (var fpi = 0; fpi < fpKeys.length; fpi++) {
        var svcUid = fpKeys[fpi];
        var svcName = nameMap[svcUid] || svcUid;
        var sfp = fingerprints[svcUid];

        fpHtml += '<div class="fingerprint-card">';
        fpHtml += '<div class="cluster-header">';
        fpHtml += '<strong>' + svcName + '</strong>';
        fpHtml += '</div>';
        fpHtml += '<div class="ranking-detail">';
        fpHtml += 'Pattern: ' + sfp.pattern;
        fpHtml += ' | Affected CIs: ' + sfp.affectedCIs.length;
        fpHtml += ' | Avg Resolution: ' + sfp.avgResolutionHours + 'h';
        fpHtml += '</div>';

        // List affected CIs
        if (sfp.affectedCIs.length > 0) {
          fpHtml += '<div class="cluster-members">';
          for (var aci = 0; aci < sfp.affectedCIs.length; aci++) {
            var ciName = nameMap[sfp.affectedCIs[aci]] || sfp.affectedCIs[aci];
            fpHtml += '<div class="cluster-member">' + ciName + '</div>';
          }
          fpHtml += '</div>';
        }
        fpHtml += '</div>';
      }
      fpContainer.innerHTML = fpHtml;
    }
  }
};
