/**
 * BSMDiscovery — constructor, init lifecycle, state, utilities
 *
 * Extends BSMDiscovery.prototype. Requires app/BSMDiscovery.js.
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
  this._primaryView = 'matrix'; // matrix | explorer | force | upset
  this._searchTerm = '';
  this._selectedHyperedgeUid = null;
  this._cooccurrenceFilter = '';

  // Analytics
  this._analytics = null;
  this._analyticsData = {};
  this._activeTab = 'centrality';
}

// ---------- Initialization ----------

/**
 * Field list for the single ServiceNow Table API query on task_ci.
 * Dot-walked fields pull data from the change_request (task.*) and CI (ci_item.*).
 */
BSMDiscovery.QUERY_FIELDS = {
  task_ci: [
    'task.number', 'task.type', 'task.risk', 'task.impact',
    'task.u_impact_region', 'task.assignment_group', 'task.business_service',
    'task.sys_created_on',
    'ci_item.sys_id',
    'ci_item.name', 'ci_item.sys_class_name', 'ci_item.u_role',
    'ci_item.ip_address', 'ci_item.model_id', 'ci_item.os',
    'ci_item.sys_updated_on'
  ],
  filter: 'task.sys_class_name=change_request'
};

/**
 * Update the encoded query display to show the equivalent ServiceNow queries.
 */
BSMDiscovery.prototype._updateQueryDisplay = function () {
  var limitEl = document.getElementById('query-limit');
  var startEl = document.getElementById('query-start');
  var endEl = document.getElementById('query-end');
  var displayEl = document.getElementById('query-encoded');
  if (!limitEl || !startEl || !endEl || !displayEl) return;

  var limit = limitEl.value || 100;

  var queryParts = [];
  if (BSMDiscovery.QUERY_FIELDS.filter) queryParts.push(BSMDiscovery.QUERY_FIELDS.filter);
  if (startEl.value) queryParts.push('task.sys_created_on>=' + startEl.value);
  if (endEl.value) queryParts.push('task.sys_created_on<=' + endEl.value);
  var query = queryParts.join('^');

  var fields = BSMDiscovery.QUERY_FIELDS.task_ci;
  var lines = [];
  lines.push('\u2500\u2500 task_ci \u2500\u2500');
  lines.push('sysparm_limit=' + limit);
  lines.push('sysparm_fields=' + fields.join(','));
  if (query) lines.push('sysparm_query=' + query);

  displayEl.textContent = lines.join('\n');
  displayEl.classList.add('visible');
};

/**
 * Re-initialize the app with new query parameters.
 * Reads values from the query parameter controls.
 */
BSMDiscovery.prototype.reInit = function () {
  var limitEl = document.getElementById('query-limit');
  var startEl = document.getElementById('query-start');
  var endEl = document.getElementById('query-end');

  var limit = limitEl ? parseInt(limitEl.value, 10) || 100 : 100;
  var startDate = startEl ? startEl.value : null;
  var endDate = endEl ? endEl.value : null;

  // Merge into simulator options — aligns with SNTableAPI parameters
  this.simulatorOptions.limit = limit;
  this.simulatorOptions.changeCount = Math.max(limit, this.simulatorOptions.changeCount || 200);
  if (startDate) this.simulatorOptions.startDate = startDate;
  if (endDate) this.simulatorOptions.endDate = endDate;

  this._updateQueryDisplay();
  this._isTransposed = false;
  this._isUpSetView = false;
  this._selectedHyperedgeUid = null;
  this.init();
};

BSMDiscovery.prototype.init = function () {
  var self = this;

  // Show loading
  this._setLoading(true, 'Fetching data from ServiceNow Table API...');

  var api = new SNTableAPI();
  
  var queryParts = [];
  if (BSMDiscovery.QUERY_FIELDS.filter) queryParts.push(BSMDiscovery.QUERY_FIELDS.filter);
  if (self.simulatorOptions.startDate) queryParts.push('task.sys_created_on>=' + self.simulatorOptions.startDate);
  if (self.simulatorOptions.endDate) queryParts.push('task.sys_created_on<=' + self.simulatorOptions.endDate);
  
  var activeQuery = queryParts.join('^');

  api.getRecords('task_ci', {
    query: activeQuery,
    fields: BSMDiscovery.QUERY_FIELDS.task_ci,
    limit: self.simulatorOptions.limit || 100,
    displayValue: 'all' // Crucial for our adapter
  }).then(function(result) {
    self._setLoading(true, 'Building hypergraph...');
    
    // 1. Adapt the incoming SN records to match Simulator format
    self._rawData = self._adaptSNData(result.records);
    
    // 2. Build the graph core
    self._core = new HypergraphCore();
    self._originalGraph = self._core.build(self._rawData);
    self._transposedGraph = self._core.transpose(self._originalGraph);

    // 3. Initialize Renderer
    self._renderer = new BSMHypergraphRenderer(self.containerSelector, {
      onNodeClick: function (d) { self._showNodeDetail(d); },
      onHullClick: function (edge) { self._onHyperedgeClick(edge); },
      onStatsUpdate: function (stats, isTransposed) { self._updateStats(stats, isTransposed); }
    });

    // 4. Start rendering loop (same as original code)
    setTimeout(function () {
      self._renderer.render(self._originalGraph);
      if (!self._controlsBound) {
        self._bindControls();
        self._controlsBound = true;
      }
      self._renderPrimaryView();
      self._updateViewButtons();
      self._syncSidebarByView();
      self._updateLegendCounts();
      self._updateCooccurrence();

      // --- Run analytics ---
      self._setLoading(true, 'Running analytics...');
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

        // Bind analytics controls (only once)
        if (!self._analyticsControlsBound) {
          self._bindAnalyticsControls();
          self._analyticsControlsBound = true;
        }

        self._setLoading(false);
      }, 50);
    }, 50);

  }).catch(function(error) {
    console.error("API Error", error);
    self._setLoading(false, "Failed to load ServiceNow data");
  });
};

// ---------- View Toggle ----------

/**
 * Adapter specifically for wrapping ServiceNow Table API JSON results
 * so they match the flat string dot-walked format expected by HypergraphCore.
 * Assumes sysparm_display_value=all was used in the API request.
 */
BSMDiscovery.prototype._adaptSNData = function(records) {
  var adaptedRecords = [];
  
  for (var i = 0; i < records.length; i++) {
    var raw = records[i];
    var adapted = {};
    var keys = Object.keys(raw);
    
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var field = raw[key];
      
      // If the field comes back as an object (due to displayValue: 'all')
      if (field && typeof field === 'object' && field.hasOwnProperty('value')) {
        // Use raw value for system IDs to avoid using display names as unique IDs
        if (key === 'ci_item.sys_id' || key === 'task.sys_id') {
          adapted[key] = field.value || field.display_value || '';
        } else {
          // Prefer display_value for UI readability (e.g. assignment_group=Network instead of a sys_id)
          adapted[key] = field.display_value || field.value || '';
        }
      } else {
        // Fallback if the field is already a flat string
        adapted[key] = field || '';
      }
    }
    adaptedRecords.push(adapted);
  }
  
  return { taskCiRecords: adaptedRecords, incidents: {} };
};

BSMDiscovery.prototype.toggleTranspose = function () {
  this.setView(!this._isTransposed);
};

BSMDiscovery.prototype.setView = function (transposed) {
  if (this._isTransposed === transposed) return;
  this._isTransposed = transposed;
  this._renderPrimaryView();
  this._updateViewButtons();
  this._updateLegendCounts();
  this._updateCooccurrence();
  this._hideNodeDetail();
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
