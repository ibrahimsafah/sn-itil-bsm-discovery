/**
 * BSM Discovery Orchestrator
 *
 * Wires together ITILDataSimulator, HypergraphCore, BSMHypergraphRenderer,
 * and AnalyticsEngine.  Manages view state (original vs transposed), UI
 * controls, and analytics panel rendering.
 *
 * Usage:
 *   var app = new BSMDiscovery({ container: '#graph-container' });
 *   app.init();
 */

/* global ITILDataSimulator, HypergraphCore, BSMHypergraphRenderer, AnalyticsEngine, UpSetRenderer */

function BSMDiscovery(options) {
  options = options || {};
  this.containerSelector = options.container || '#graph-container';
  this.simulatorOptions = options.simulator || {};

  this._simulator = null;
  this._core = null;
  this._renderer = null;
  this._upsetRenderer = null;
  this._rawData = null;
  this._originalGraph = null;
  this._transposedGraph = null;
  this._isTransposed = false;
  this._isUpSetView = false;
  this._cooccurrenceFilter = '';

  // Analytics
  this._analytics = null;
  this._analyticsData = {};
  this._activeTab = 'centrality';
}

// ---------- Initialization ----------

BSMDiscovery.prototype.init = function () {
  var self = this;

  // Show loading
  this._setLoading(true, 'Generating ITIL data\u2026');

  // Use setTimeout to allow the loading UI to render
  setTimeout(function () {
    self._simulator = new ITILDataSimulator(self.simulatorOptions);
    self._core = new HypergraphCore();

    // Generate data
    self._setLoading(true, 'Building hypergraph\u2026');
    self._rawData = self._simulator.generate();
    self._originalGraph = self._core.build(self._rawData);
    self._transposedGraph = self._core.transpose(self._originalGraph);

    // Initialize renderer
    self._renderer = new BSMHypergraphRenderer(self.containerSelector, {
      onNodeClick: function (d) { self._showNodeDetail(d); },
      onStatsUpdate: function (stats, isTransposed) { self._updateStats(stats, isTransposed); }
    });

    // Render original view
    self._setLoading(true, 'Rendering visualization\u2026');
    setTimeout(function () {
      self._renderer.render(self._originalGraph);
      self._bindControls();
      self._updateLegendCounts();
      self._updateCooccurrence();

      // --- Run analytics ---
      self._setLoading(true, 'Running analytics\u2026');
      setTimeout(function () {
        self._analytics = new AnalyticsEngine();

        var graph = self._originalGraph;
        var raw = self._rawData;

        // Compute ALL analytics
        var centralityResults = self._analytics.centrality(graph);
        var cascades = self._analytics.temporalCascades(graph, raw, 7);
        var velocity = self._analytics.changeVelocity(raw);
        var cooccurrence = self._analytics.weightedCooccurrence(graph, raw, 30);
        var anomalies = self._analytics.detectAnomalies(graph, raw);
        var riskHeatmap = self._analytics.riskHeatmap(graph, raw);
        var communities = self._analytics.detectCommunities(graph);
        var linkPredictions = self._analytics.linkPrediction(graph, 20);

        // Build incident array from rawData
        var incidents = [];
        if (raw && raw.incidents) {
          var incKeys = Object.keys(raw.incidents);
          for (var ii = 0; ii < incKeys.length; ii++) {
            incidents.push(raw.incidents[incKeys[ii]]);
          }
        }
        var incidentCorrelation = self._analytics.incidentCorrelation(incidents, graph);

        // Store results
        self._analyticsData = {
          centrality: centralityResults,
          cascades: cascades,
          velocity: velocity,
          cooccurrence: cooccurrence,
          anomalies: anomalies,
          riskHeatmap: riskHeatmap,
          communities: communities,
          linkPredictions: linkPredictions,
          incidentCorrelation: incidentCorrelation
        };

        // Supply centrality data to renderer
        self._renderer.setCentralityData(centralityResults.composite, 'composite');

        // Supply cluster data: build uid -> clusterId map
        var clusterMap = {};
        var comIds = Object.keys(communities.communities);
        for (var ci = 0; ci < comIds.length; ci++) {
          var members = communities.communities[comIds[ci]];
          for (var mi = 0; mi < members.length; mi++) {
            clusterMap[members[mi]] = parseInt(comIds[ci], 10);
          }
        }
        self._renderer.setClusterData(clusterMap);

        // Supply risk data: build uid -> score map
        var riskMap = {};
        for (var ri = 0; ri < riskHeatmap.length; ri++) {
          riskMap[riskHeatmap[ri].ci] = riskHeatmap[ri].riskScore;
        }
        self._renderer.setRiskData(riskMap);

        // Set anomaly nodes for CIs with riskScore > 70
        var anomalyUids = [];
        for (var ai = 0; ai < riskHeatmap.length; ai++) {
          if (riskHeatmap[ai].riskScore > 70) {
            anomalyUids.push(riskHeatmap[ai].ci);
          }
        }
        self._renderer.setAnomalyNodes(anomalyUids);

        // Populate all analytics panels
        self._renderCentralityPanel('composite');
        self._renderTemporalPanel();
        self._renderAnomaliesPanel();
        self._renderClustersPanel();
        self._renderImpactPanel();
        self._renderIncidentsPanel();

        // Bind analytics controls
        self._bindAnalyticsControls();

        self._setLoading(false);
      }, 50);
    }, 50);
  }, 50);
};

// ---------- View Toggle ----------

BSMDiscovery.prototype.toggleTranspose = function () {
  this._isTransposed = !this._isTransposed;
  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  this._renderer.render(graph);
  this._updateViewButtons();
  this._updateLegendCounts();
  this._updateCooccurrence();
  this._hideNodeDetail();
};

BSMDiscovery.prototype.setView = function (transposed) {
  if (this._isTransposed === transposed) return;
  this._isTransposed = transposed;
  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  this._renderer.render(graph);
  this._updateViewButtons();
  this._updateLegendCounts();
  this._updateCooccurrence();
  this._hideNodeDetail();
};

// _updateViewButtons defined in UpSet View section below

// ---------- UI Binding ----------

BSMDiscovery.prototype._bindControls = function () {
  var self = this;

  // View toggle buttons
  var btnOriginal = document.getElementById('btn-original');
  var btnTransposed = document.getElementById('btn-transposed');
  var btnUpset = document.getElementById('btn-upset');
  if (btnOriginal) {
    btnOriginal.addEventListener('click', function () {
      self._exitUpSetView();
      self.setView(false);
      self._updateViewButtons();
    });
  }
  if (btnTransposed) {
    btnTransposed.addEventListener('click', function () {
      self._exitUpSetView();
      self.setView(true);
      self._updateViewButtons();
    });
  }
  if (btnUpset) {
    btnUpset.addEventListener('click', function () {
      self._toggleUpSetView();
    });
  }

  // Search
  var searchInput = document.getElementById('search-input');
  if (searchInput) {
    var debounceTimer;
    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        self._renderer.setSearch(searchInput.value);
      }, 200);
    });
  }

  // Legend toggles
  var legendItems = document.querySelectorAll('.legend-item');
  legendItems.forEach(function (item) {
    item.addEventListener('click', function () {
      var type = item.getAttribute('data-type');
      self._renderer.toggleType(type);
      item.classList.toggle('hidden', !self._renderer.isTypeVisible(type));
    });
  });

  // Force sliders
  var chargeSlider = document.getElementById('charge-slider');
  var chargeValue = document.getElementById('charge-value');
  if (chargeSlider) {
    chargeSlider.addEventListener('input', function () {
      var val = parseInt(chargeSlider.value, 10);
      self._renderer.setChargeStrength(val);
      if (chargeValue) chargeValue.textContent = val;
    });
  }

  var linkSlider = document.getElementById('link-slider');
  var linkValue = document.getElementById('link-value');
  if (linkSlider) {
    linkSlider.addEventListener('input', function () {
      var val = parseInt(linkSlider.value, 10);
      self._renderer.setLinkDistance(val);
      if (linkValue) linkValue.textContent = val;
    });
  }

  // Co-occurrence filter buttons
  var coocBtns = document.querySelectorAll('.cooccurrence-type-btn');
  coocBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      coocBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      self._cooccurrenceFilter = btn.getAttribute('data-filter') || '';
      self._updateCooccurrence();
    });
  });

  // Click on graph background to clear highlight
  var container = document.querySelector(this.containerSelector);
  if (container) {
    container.addEventListener('click', function (e) {
      if (e.target.tagName === 'svg' || e.target.classList.contains('graph-layer')) {
        self._renderer.clearHighlight();
        self._hideNodeDetail();
      }
    });
  }

  // Window resize
  window.addEventListener('resize', function () {
    if (self._renderer) self._renderer.resize();
  });
};

// ---------- Analytics Controls Binding ----------

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

// ---------- Stats Panel ----------

BSMDiscovery.prototype._updateStats = function (stats, isTransposed) {
  this._setText('stat-nodes', stats.totalNodes);
  this._setText('stat-edges', stats.totalEdges);
  this._setText('stat-density', stats.density);
  this._setText('stat-avg-degree', stats.avgDegree);
  this._setText('stat-max-degree', stats.maxDegree);
  this._setText('stat-avg-edge-size', stats.avgEdgeSize);

  // Update view indicator
  var viewLabel = document.getElementById('view-label');
  if (viewLabel) {
    viewLabel.textContent = isTransposed ? 'Transposed (H*)' : 'Original (H)';
  }

  // Update node/edge semantic labels
  var nodeLabel = document.getElementById('stat-nodes-label');
  var edgeLabel = document.getElementById('stat-edges-label');
  if (nodeLabel) {
    nodeLabel.textContent = isTransposed ? 'Change Nodes' : 'Entity Nodes';
  }
  if (edgeLabel) {
    edgeLabel.textContent = isTransposed ? 'Entity Hyperedges' : 'Change Hyperedges';
  }
};

// ---------- Legend Counts ----------

BSMDiscovery.prototype._updateLegendCounts = function () {
  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  var counts = {};
  for (var i = 0; i < graph.nodes.length; i++) {
    var t = graph.nodes[i].type;
    counts[t] = (counts[t] || 0) + 1;
  }
  // Also count edge types for transposed view
  for (var j = 0; j < graph.edges.length; j++) {
    var et = graph.edges[j].type;
    if (et) counts[et] = (counts[et] || 0) + 1;
  }

  var countEls = document.querySelectorAll('.legend-count');
  countEls.forEach(function (el) {
    var type = el.getAttribute('data-type');
    el.textContent = counts[type] || 0;
  });
};

// ---------- Node Detail Panel ----------

BSMDiscovery.prototype._showNodeDetail = function (d) {
  var panel = document.getElementById('node-detail');
  if (!panel) return;

  var nameEl = document.getElementById('detail-name');
  var badgeEl = document.getElementById('detail-badge');
  var bodyEl = document.getElementById('detail-body');

  if (nameEl) nameEl.textContent = d.name;
  if (badgeEl) {
    badgeEl.textContent = d.type;
    badgeEl.className = 'node-detail-badge ' + d.type;
  }

  var rows = [];
  var props = { uid: 'UID', className: 'Class', ipAddress: 'IP Address', os: 'OS', model: 'Model', role: 'Role', risk: 'Risk', region: 'Region', assignmentGroup: 'Group', businessService: 'Service' };
  var keys = Object.keys(props);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (d[key]) {
      rows.push('<div class="node-detail-row"><span class="detail-key">' + props[key] + '</span><span class="detail-val">' + d[key] + '</span></div>');
    }
  }

  // Degree
  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  if (graph.incidence[d.uid]) {
    rows.push('<div class="node-detail-row"><span class="detail-key">Degree</span><span class="detail-val">' + graph.incidence[d.uid].size + '</span></div>');
  }

  // Analytics info if available
  if (this._analyticsData.centrality && this._analyticsData.centrality.composite[d.uid] !== undefined) {
    var score = this._analyticsData.centrality.composite[d.uid];
    rows.push('<div class="node-detail-row"><span class="detail-key">Centrality</span><span class="detail-val">' + (Math.round(score * 10000) / 10000) + '</span></div>');
  }

  if (bodyEl) bodyEl.innerHTML = rows.join('');
  panel.classList.add('visible');
};

BSMDiscovery.prototype._hideNodeDetail = function () {
  var panel = document.getElementById('node-detail');
  if (panel) panel.classList.remove('visible');
};

// ---------- Co-occurrence Panel ----------

BSMDiscovery.prototype._updateCooccurrence = function () {
  var body = document.getElementById('cooccurrence-body');
  if (!body) return;

  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  var filter = this._cooccurrenceFilter || null;
  var pairs = this._core.cooccurrence(graph, filter, 15);

  if (pairs.length === 0) {
    body.innerHTML = '<div class="cooccurrence-empty">No co-occurring pairs found</div>';
    return;
  }

  var maxCount = pairs[0].count;

  // Build node name lookup from current graph
  var nameMap = {};
  for (var n = 0; n < graph.nodes.length; n++) {
    nameMap[graph.nodes[n].uid] = graph.nodes[n].name;
  }
  // Also check edges (in transposed view, original nodes become edges)
  for (var e = 0; e < graph.edges.length; e++) {
    if (graph.edges[e].name) nameMap[graph.edges[e].uid] = graph.edges[e].name;
  }

  var html = '<table class="cooccurrence-table">';
  html += '<tr><th>Pair</th><th></th><th>Shared</th></tr>';

  var self = this;
  for (var i = 0; i < pairs.length; i++) {
    var p = pairs[i];
    var nameA = nameMap[p.a] || p.a.split(':').pop().substring(0, 12);
    var nameB = nameMap[p.b] || p.b.split(':').pop().substring(0, 12);
    var barWidth = Math.round((p.count / maxCount) * 100);

    html += '<tr class="cooccurrence-row" data-idx="' + i + '">';
    html += '<td><div class="cooccurrence-pair">';
    html += '<span class="pair-name" title="' + nameA + '">' + nameA + '</span>';
    html += '<span class="pair-name" title="' + nameB + '">' + nameB + '</span>';
    html += '</div></td>';
    html += '<td class="cooccurrence-bar-cell"><div class="cooccurrence-bar" style="width:' + barWidth + '%"></div></td>';
    html += '<td class="cooccurrence-count">' + p.count + '</td>';
    html += '</tr>';
  }
  html += '</table>';
  body.innerHTML = html;

  // Bind click handlers on rows
  var rows = body.querySelectorAll('.cooccurrence-row');
  rows.forEach(function (row) {
    row.addEventListener('click', function () {
      var idx = parseInt(row.getAttribute('data-idx'), 10);
      var pair = pairs[idx];
      // Toggle active state
      var wasActive = row.classList.contains('active');
      rows.forEach(function (r) { r.classList.remove('active'); });
      if (wasActive) {
        self._renderer.clearHighlight();
      } else {
        row.classList.add('active');
        self._highlightPair(pair);
      }
    });
  });
};

BSMDiscovery.prototype._highlightPair = function (pair) {
  // Highlight both nodes and their shared change hyperedges in the graph
  var connectedSet = new Set();
  connectedSet.add(pair.a);
  connectedSet.add(pair.b);
  for (var i = 0; i < pair.sharedEdges.length; i++) {
    connectedSet.add(pair.sharedEdges[i]);
  }

  // Use the renderer's internal layers for highlighting
  var renderer = this._renderer;
  renderer._nodeLayer.selectAll('circle')
    .attr('opacity', function (n) { return connectedSet.has(n.uid) ? 1 : 0.1; })
    .attr('filter', function (n) { return n.uid === pair.a || n.uid === pair.b ? 'url(#glow)' : null; });

  renderer._labelLayer.selectAll('text')
    .attr('opacity', function (n) { return connectedSet.has(n.uid) ? 1 : 0.05; });

  renderer._linkLayer.selectAll('line')
    .attr('stroke-opacity', function (l) {
      var sUid = l.source.uid || l.source;
      var tUid = l.target.uid || l.target;
      return connectedSet.has(sUid) && connectedSet.has(tUid) ? 0.5 : 0.02;
    });
};

// ---------- Helper: Name Map ----------

BSMDiscovery.prototype._buildNameMap = function (graph) {
  var map = {};
  var i;
  for (i = 0; i < graph.nodes.length; i++) {
    map[graph.nodes[i].uid] = graph.nodes[i].name;
  }
  for (i = 0; i < graph.edges.length; i++) {
    if (graph.edges[i].name) {
      map[graph.edges[i].uid] = graph.edges[i].name;
    }
  }
  return map;
};

// ---------- Helper: Type Badge ----------

BSMDiscovery.prototype._typeBadge = function (uid) {
  var type = 'ci';
  if (uid.indexOf('group:') === 0) {
    type = 'group';
  } else if (uid.indexOf('service:') === 0) {
    type = 'service';
  }
  return '<span class="type-badge ' + type + '">' + type + '</span>';
};

// ---------- Helper: Node type from UID ----------

BSMDiscovery.prototype._nodeType = function (uid) {
  if (uid.indexOf('group:') === 0) return 'group';
  if (uid.indexOf('service:') === 0) return 'service';
  return 'ci';
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

// ---------- UpSet View ----------

BSMDiscovery.prototype._toggleUpSetView = function () {
  if (this._isUpSetView) {
    this._exitUpSetView();
  } else {
    this._enterUpSetView();
  }
};

BSMDiscovery.prototype._enterUpSetView = function () {
  this._isUpSetView = true;
  var self = this;

  // Stop force simulation and hide its SVG
  if (this._renderer) {
    if (this._renderer.simulation) {
      this._renderer.simulation.stop();
    }
    if (this._renderer.svg) {
      this._renderer.svg.style('display', 'none');
    }
  }

  // Initialize UpSet renderer if needed
  if (!this._upsetRenderer) {
    this._upsetRenderer = new UpSetRenderer(this.containerSelector, {
      onIntersectionClick: function (intersection) {
        // Highlight in analytics panel when available
        if (self._renderer) {
          self._renderer.highlightNodes(intersection.members);
        }
      }
    });
  }

  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  this._upsetRenderer.render(graph, {
    maxIntersections: 35,
    filterType: 'ci',
    topEntities: 15,
    minSetSize: 1
  });

  this._updateViewButtons();
  var viewLabel = document.getElementById('view-label');
  if (viewLabel) viewLabel.textContent = 'UpSet Intersections';
};

BSMDiscovery.prototype._exitUpSetView = function () {
  if (!this._isUpSetView) return;
  this._isUpSetView = false;

  // Destroy UpSet SVG
  if (this._upsetRenderer) {
    this._upsetRenderer.destroy();
  }

  // Show force graph SVG again
  if (this._renderer && this._renderer.svg) {
    this._renderer.svg.style('display', null);
  }

  // Re-render force graph
  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  this._renderer.render(graph);

  // Re-apply analytics overlays if present
  if (this._analyticsData.centrality) {
    var metric = this._activeTab === 'centrality' ? 'composite' : 'composite';
    this._renderer.setCentralityData(this._analyticsData.centrality[metric], metric);
  }

  this._updateViewButtons();
  this._updateLegendCounts();
};

BSMDiscovery.prototype._updateViewButtons = function () {
  var btnOrig = document.getElementById('btn-original');
  var btnTrans = document.getElementById('btn-transposed');
  var btnUpset = document.getElementById('btn-upset');

  if (btnOrig) btnOrig.classList.toggle('active', !this._isTransposed && !this._isUpSetView);
  if (btnTrans) btnTrans.classList.toggle('active', this._isTransposed && !this._isUpSetView);
  if (btnUpset) btnUpset.classList.toggle('active', this._isUpSetView);
};

// ---------- Loading ----------

BSMDiscovery.prototype._setLoading = function (show, message) {
  var overlay = document.getElementById('loading-overlay');
  var text = document.getElementById('loading-text');
  if (overlay) {
    overlay.classList.toggle('hidden', !show);
  }
  if (text && message) {
    text.textContent = message;
  }
};

// ---------- Helpers ----------

BSMDiscovery.prototype._setText = function (id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
};
