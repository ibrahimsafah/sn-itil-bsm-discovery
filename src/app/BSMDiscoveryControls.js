/**
 * BSMDiscoveryControls — sidebar UI bindings
 *
 * Extends BSMDiscovery.prototype. Requires app/BSMDiscovery.js.
 */

BSMDiscovery.prototype._bindControls = function () {
  var self = this;

  // View mode buttons
  var btnMatrix = document.getElementById('btn-view-matrix');
  var btnExplorer = document.getElementById('btn-view-explorer');
  var btnForce = document.getElementById('btn-view-force');
  var btnUpSet = document.getElementById('btn-view-upset');
  if (btnMatrix) {
    btnMatrix.addEventListener('click', function () {
      self._setPrimaryView('matrix');
    });
  }
  if (btnExplorer) {
    btnExplorer.addEventListener('click', function () {
      self._setPrimaryView('explorer');
    });
  }
  if (btnForce) {
    btnForce.addEventListener('click', function () {
      self._setPrimaryView('force');
    });
  }
  if (btnUpSet) {
    btnUpSet.addEventListener('click', function () {
      self._setPrimaryView('upset');
    });
  }

  // Projection buttons (force + upset only)
  var btnOriginal = document.getElementById('btn-original');
  var btnTransposed = document.getElementById('btn-transposed');
  if (btnOriginal) {
    btnOriginal.addEventListener('click', function () {
      self.setView(false);
      self._updateViewButtons();
    });
  }
  if (btnTransposed) {
    btnTransposed.addEventListener('click', function () {
      self.setView(true);
      self._updateViewButtons();
    });
  }

  // Search
  var searchInput = document.getElementById('search-input');
  if (searchInput) {
    var debounceTimer;
    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        self._searchTerm = searchInput.value || '';
        if (self._primaryView === 'force' && self._renderer) {
          self._renderer.setSearch(self._searchTerm);
        } else {
          self._renderPrimaryView();
        }
      }, 200);
    });
  }

  // Make sidebar sections collapsible
  var sidebarHeaders = document.querySelectorAll('.sidebar-section h3');
  sidebarHeaders.forEach(function (header) {
    if (header.parentElement.id === 'node-detail') return;

    // Add collapse icon
    var span = document.createElement('span');
    span.className = 'collapse-icon';
    span.innerHTML = '&#9660;'; // down arrow

    // Wrap header content if needed, but we can just append
    header.style.cursor = 'pointer';
    header.style.userSelect = 'none';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.appendChild(span);

    header.addEventListener('click', function () {
      var section = header.parentElement;
      section.classList.toggle('collapsed');
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

  // Hull toggle
  var hullToggle = document.getElementById('hull-toggle');
  if (hullToggle) {
    hullToggle.addEventListener('change', function () {
      self._renderer.setHullsEnabled(hullToggle.checked);
    });
  }

  var visualStyleSelect = document.getElementById('visual-style-select');
  if (visualStyleSelect) {
    if (self._renderer && self._renderer._visualStylePreset) {
      visualStyleSelect.value = self._renderer._visualStylePreset;
    }
    visualStyleSelect.addEventListener('change', function () {
      if (self._renderer && self._renderer.setVisualPreset) {
        self._renderer.setVisualPreset(visualStyleSelect.value);
      }
    });
  }

  // Query parameter controls
  var queryApplyBtn = document.getElementById('query-apply');
  if (queryApplyBtn) {
    queryApplyBtn.addEventListener('click', function () {
      self.reInit();
    });
  }

  // Show initial encoded query
  this._updateQueryDisplay();

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
    if (self._primaryView === 'force') {
      if (self._renderer) self._renderer.resize();
    } else if (self._primaryView === 'upset') {
      if (self._upsetRenderer) self._upsetRenderer.resize();
    } else {
      self._renderPrimaryView();
    }
  });
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
    if (this._primaryView === 'matrix') {
      viewLabel.textContent = 'Incidence Matrix';
    } else if (this._primaryView === 'explorer') {
      viewLabel.textContent = 'Hyperedge Explorer';
    } else if (this._primaryView === 'upset') {
      viewLabel.textContent = isTransposed ? 'UpSet • Changes → Entities' : 'UpSet • Entities → Changes';
    } else {
      viewLabel.textContent = isTransposed ? 'Force Graph • Changes → Entities' : 'Force Graph • Entities → Changes';
    }
  }

  // Update node/edge semantic labels
  var nodeLabel = document.getElementById('stat-nodes-label');
  var edgeLabel = document.getElementById('stat-edges-label');
  var useTransposedLabels = isTransposed && (this._primaryView === 'force' || this._primaryView === 'upset');
  if (nodeLabel) {
    nodeLabel.textContent = useTransposedLabels ? 'Change Nodes' : 'Entity Nodes';
  }
  if (edgeLabel) {
    edgeLabel.textContent = useTransposedLabels ? 'Entity Hyperedges' : 'Change Hyperedges';
  }
};

// ---------- Legend Counts (Removed) ----------

BSMDiscovery.prototype._updateLegendCounts = function () {
  // Legend was removed, method preserved to prevent errors in existing calls.
};

// ---------- Node Detail Panel ----------

BSMDiscovery.prototype._showNodeDetail = function (d) {
  var panel = document.getElementById('node-detail');
  if (!panel) return;
  var headerEl = panel.querySelector('.node-detail-header h3');

  var nameEl = document.getElementById('detail-name');
  var badgeEl = document.getElementById('detail-badge');
  var bodyEl = document.getElementById('detail-body');

  if (nameEl) nameEl.textContent = d.name;
  if (badgeEl) {
    badgeEl.textContent = d.type;
    badgeEl.className = 'node-detail-badge ' + d.type;
  }
  if (headerEl) headerEl.textContent = 'Node Detail';

  var rows = [];
  var props = { uid: 'UID', className: 'Class', ipAddress: 'IP Address', model: 'Model', role: 'Role', os: 'OS', risk: 'Risk', impact: 'Impact', changeType: 'Type', region: 'Region', assignmentGroup: 'Group', businessService: 'Service', sysUpdatedOn: 'Updated', createdAt: 'Created' };
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

BSMDiscovery.prototype._onHyperedgeClick = function (edge) {
  if (!edge || !this._renderer) return;

  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  var selectedEdge = this._findEdgeByUid(graph, edge.uid) || edge;
  if (!selectedEdge) return;

  if (this._selectedHyperedgeUid === selectedEdge.uid) {
    this._selectedHyperedgeUid = null;
    this._renderer.clearHighlight();
    this._hideNodeDetail();
    return;
  }

  this._selectedHyperedgeUid = selectedEdge.uid;
  this._renderer.highlightHyperedge(selectedEdge);
  this._showHyperedgeDetail(selectedEdge);
};

BSMDiscovery.prototype._showHyperedgeDetail = function (edge) {
  var panel = document.getElementById('node-detail');
  if (!panel) return;
  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  if (!graph) return;

  var headerEl = panel.querySelector('.node-detail-header h3');
  var nameEl = document.getElementById('detail-name');
  var badgeEl = document.getElementById('detail-badge');
  var bodyEl = document.getElementById('detail-body');

  var nodeById = {};
  for (var i = 0; i < graph.nodes.length; i++) {
    nodeById[graph.nodes[i].uid] = graph.nodes[i];
  }

  if (headerEl) headerEl.textContent = 'Hyperedge Detail';
  if (nameEl) nameEl.textContent = edge.number || edge.uid;
  if (badgeEl) {
    badgeEl.textContent = 'hyperedge';
    badgeEl.className = 'node-detail-badge change';
  }

  if (bodyEl && typeof this._renderHyperedgeDetail === 'function') {
    bodyEl.innerHTML = this._renderHyperedgeDetail(edge, nodeById);
  } else if (bodyEl) {
    bodyEl.innerHTML = '<div class="hyperedge-detail"><h4>' + (edge.number || edge.uid) + '</h4></div>';
  }

  panel.classList.add('visible');
};

BSMDiscovery.prototype._hideNodeDetail = function () {
  var panel = document.getElementById('node-detail');
  if (panel) panel.classList.remove('visible');
  var headerEl = panel ? panel.querySelector('.node-detail-header h3') : null;
  if (headerEl) headerEl.textContent = 'Node Detail';
  this._selectedHyperedgeUid = null;
};

// ---------- Co-occurrence Panel ----------

BSMDiscovery.prototype._updateCooccurrence = function () {
  var body = document.getElementById('cooccurrence-body');
  if (!body) return;

  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  var filter = this._cooccurrenceFilter || null;
  var pairs = this._core.cooccurrence(graph, filter, 15);

  if (pairs.length === 0) {
    body.innerHTML = '<div class="cooccurrence-empty">No co-occurring groups found</div>';
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
  html += '<tr><th>Group</th><th></th><th>Shared</th></tr>';

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
