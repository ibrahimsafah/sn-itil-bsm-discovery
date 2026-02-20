/**
 * BSMDiscovery Views — hypergraph-first modes + force/upset fallback
 *
 * Extends BSMDiscovery.prototype. Requires app/BSMDiscovery.js.
 */

// ---------- View Mode Entry Points ----------

BSMDiscovery.prototype._setPrimaryView = function (mode) {
  if (!mode) return;
  if (this._primaryView === mode && this._originalGraph) return;

  this._primaryView = mode;
  this._isUpSetView = mode === 'upset';

  // Hypergraph-first views always use original projection.
  if (mode === 'matrix' || mode === 'explorer') {
    this._isTransposed = false;
  }

  this._renderPrimaryView();
  this._updateViewButtons();
  this._syncSidebarByView();
};

BSMDiscovery.prototype._renderPrimaryView = function () {
  if (!this._originalGraph) return;

  if (this._primaryView === 'force') {
    this._renderForceView();
  } else if (this._primaryView === 'upset') {
    this._renderUpSetView();
  } else if (this._primaryView === 'explorer') {
    this._renderHyperedgeExplorerView();
  } else {
    this._renderIncidenceMatrixView();
  }
};

// ---------- Force / UpSet ----------

BSMDiscovery.prototype._renderForceView = function () {
  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  if (!this._renderer) return;

  if (this._upsetRenderer) this._upsetRenderer.destroy();
  this._isUpSetView = false;
  this._hideHypergraphView();

  this._renderer.render(graph);
  if (this._searchTerm) this._renderer.setSearch(this._searchTerm);

  // Preserve selected hyperedge context when returning to force view.
  if (this._selectedHyperedgeUid) {
    if (graph.isTransposed) {
      this._renderer.highlightNodes([this._selectedHyperedgeUid]);
    } else {
      var selectedEdge = this._findEdgeByUid(graph, this._selectedHyperedgeUid);
      if (selectedEdge) this._renderer.highlightNodes(selectedEdge.elements);
    }
  }

  this._updateStats(graph.stats, graph.isTransposed);
  this._updateLegendCounts();
  this._updateCooccurrence();
  var viewLabel = document.getElementById('view-label');
  if (viewLabel) viewLabel.textContent = graph.isTransposed ? 'Force Graph • Changes → Entities' : 'Force Graph • Entities → Changes';
};

BSMDiscovery.prototype._renderUpSetView = function () {
  var graph = this._isTransposed ? this._transposedGraph : this._originalGraph;
  var self = this;

  this._hideHypergraphView();
  this._isUpSetView = true;

  // Stop and hide force canvas while upset is active.
  if (this._renderer && this._renderer.simulation) this._renderer.simulation.stop();
  if (this._renderer && this._renderer.svg) this._renderer.svg.style('display', 'none');

  if (!this._upsetRenderer) {
    this._upsetRenderer = new UpSetRenderer(this.containerSelector, {
      onIntersectionClick: function (intersection) {
        if (!intersection || !intersection.edges || intersection.edges.length === 0) return;
        self._selectedHyperedgeUid = intersection.edges[0].uid;
      }
    });
  }

  this._upsetRenderer.render(graph, {
    maxIntersections: 35,
    filterType: 'ci',
    topEntities: 15,
    minSetSize: 1
  });

  this._updateStats(graph.stats, graph.isTransposed);
  this._updateLegendCounts();
  this._updateCooccurrence();
  var viewLabel = document.getElementById('view-label');
  if (viewLabel) viewLabel.textContent = graph.isTransposed ? 'UpSet • Changes → Entities' : 'UpSet • Entities → Changes';
};

// ---------- Hypergraph-first Views ----------

BSMDiscovery.prototype._renderIncidenceMatrixView = function () {
  var slice = this._buildMatrixSlice();
  var viewEl = this._ensureHypergraphViewContainer();
  var self = this;
  var i;

  if (!slice || slice.entities.length === 0 || slice.edges.length === 0) {
    viewEl.innerHTML = '<div class="hyper-view-shell"><div class="hyper-view-header"><span class="hyper-chip"><strong>No incidence data for current filter.</strong></span></div></div>';
    viewEl.classList.remove('hidden');
    if (this._renderer && this._renderer.svg) this._renderer.svg.style('display', 'none');
    if (this._upsetRenderer) this._upsetRenderer.destroy();
    this._isUpSetView = false;
    this._updateStats(this._originalGraph.stats, false);
    var emptyLabel = document.getElementById('view-label');
    if (emptyLabel) emptyLabel.textContent = 'Incidence Matrix';
    return;
  }

  var selectedUid = this._selectedHyperedgeUid;
  if (!selectedUid || !slice.edgeLookup[selectedUid]) {
    selectedUid = slice.edges[0].uid;
    this._selectedHyperedgeUid = selectedUid;
  }

  var selectedEdge = slice.edgeLookup[selectedUid];
  var html = '';
  html += '<div class="hyper-view-shell">';
  html += '<div class="hyper-view-header">';
  html += '<span class="hyper-chip"><strong>' + slice.entities.length + '</strong> entities shown</span>';
  html += '<span class="hyper-chip"><strong>' + slice.edges.length + '</strong> hyperedges shown</span>';
  html += '<span class="hyper-chip">Sorted by overlap with visible entities</span>';
  html += '</div>';
  html += '<div class="matrix-wrap">';
  html += '<table class="incidence-table">';
  html += '<thead><tr>';
  html += '<th class="entity-col">Entity (degree)</th>';
  for (i = 0; i < slice.edges.length; i++) {
    var edge = slice.edges[i];
    var selClass = edge.uid === selectedUid ? ' incidence-col-selected' : '';
    html += '<th class="' + selClass + '"><button class="incidence-col-btn" data-edge-uid="' + edge.uid + '">' + edge.number + '</button></th>';
  }
  html += '</tr></thead><tbody>';

  for (i = 0; i < slice.entities.length; i++) {
    var entity = slice.entities[i];
    var degree = this._originalGraph.incidence[entity.uid] ? this._originalGraph.incidence[entity.uid].size : 0;
    html += '<tr>';
    html += '<td class="entity-col">' + this._escapeHtml(entity.name) + ' <span style="color:var(--text-muted)">(' + degree + ')</span></td>';
    for (var j = 0; j < slice.edges.length; j++) {
      var colEdge = slice.edges[j];
      var isMember = !!slice.edgeMembers[colEdge.uid][entity.uid];
      var cellClass = colEdge.uid === selectedUid ? ' incidence-col-selected' : '';
      if (isMember) {
        html += '<td class="' + cellClass + '"><button class="incidence-cell member" data-edge-uid="' + colEdge.uid + '" title="Member"></button></td>';
      } else {
        html += '<td class="' + cellClass + '"><span class="incidence-cell"></span></td>';
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  html += this._renderHyperedgeDetail(selectedEdge, slice.nodeById);
  html += '</div>';

  viewEl.innerHTML = html;
  viewEl.classList.remove('hidden');

  if (this._upsetRenderer) this._upsetRenderer.destroy();
  this._isUpSetView = false;
  if (this._renderer && this._renderer.simulation) this._renderer.simulation.stop();
  if (this._renderer && this._renderer.svg) this._renderer.svg.style('display', 'none');

  var colBtns = viewEl.querySelectorAll('.incidence-col-btn');
  colBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      self._selectedHyperedgeUid = btn.getAttribute('data-edge-uid');
      self._renderIncidenceMatrixView();
    });
  });
  var cellBtns = viewEl.querySelectorAll('.incidence-cell.member');
  cellBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      self._selectedHyperedgeUid = btn.getAttribute('data-edge-uid');
      self._renderIncidenceMatrixView();
    });
  });

  this._updateStats(this._originalGraph.stats, false);
  this._updateLegendCounts();
  var viewLabel = document.getElementById('view-label');
  if (viewLabel) viewLabel.textContent = 'Incidence Matrix';
};

BSMDiscovery.prototype._renderHyperedgeExplorerView = function () {
  var viewEl = this._ensureHypergraphViewContainer();
  var graph = this._originalGraph;
  var nodeById = {};
  var search = (this._searchTerm || '').toLowerCase().trim();
  var i;

  for (i = 0; i < graph.nodes.length; i++) nodeById[graph.nodes[i].uid] = graph.nodes[i];

  var edges = graph.edges.slice();
  if (search) {
    edges = edges.filter(function (e) {
      var text = (e.number + ' ' + (e.assignmentGroup || '') + ' ' + (e.businessService || '') + ' ' + (e.risk || '') + ' ' + (e.impact || '')).toLowerCase();
      if (text.indexOf(search) !== -1) return true;
      for (var k = 0; k < e.elements.length; k++) {
        var n = nodeById[e.elements[k]];
        if (n && (n.name || '').toLowerCase().indexOf(search) !== -1) return true;
      }
      return false;
    });
  }

  edges.sort(function (a, b) {
    if (b.elements.length !== a.elements.length) return b.elements.length - a.elements.length;
    if ((a.createdAt || '') < (b.createdAt || '')) return 1;
    if ((a.createdAt || '') > (b.createdAt || '')) return -1;
    return a.number < b.number ? -1 : 1;
  });
  edges = edges.slice(0, 80);

  if (edges.length === 0) {
    viewEl.innerHTML = '<div class="hyper-view-shell"><div class="hyper-view-header"><span class="hyper-chip"><strong>No hyperedges match this filter.</strong></span></div></div>';
    viewEl.classList.remove('hidden');
    if (this._renderer && this._renderer.svg) this._renderer.svg.style('display', 'none');
    if (this._upsetRenderer) this._upsetRenderer.destroy();
    this._isUpSetView = false;
    this._updateStats(this._originalGraph.stats, false);
    var noDataLabel = document.getElementById('view-label');
    if (noDataLabel) noDataLabel.textContent = 'Hyperedge Explorer';
    return;
  }

  if (!this._selectedHyperedgeUid || !this._findEdgeByUid(graph, this._selectedHyperedgeUid)) {
    this._selectedHyperedgeUid = edges[0].uid;
  }

  var selectedEdge = this._findEdgeByUid(graph, this._selectedHyperedgeUid) || edges[0];
  var overlapMap = {};
  for (i = 0; i < edges.length; i++) overlapMap[edges[i].uid] = 0;
  for (i = 0; i < edges.length; i++) {
    var setA = new Set(edges[i].elements);
    for (var j = i + 1; j < edges.length; j++) {
      var overlap = false;
      for (var m = 0; m < edges[j].elements.length; m++) {
        if (setA.has(edges[j].elements[m])) {
          overlap = true;
          break;
        }
      }
      if (overlap) {
        overlapMap[edges[i].uid]++;
        overlapMap[edges[j].uid]++;
      }
    }
  }

  var html = '';
  html += '<div class="hyper-view-shell">';
  html += '<div class="hyper-view-header">';
  html += '<span class="hyper-chip"><strong>' + edges.length + '</strong> hyperedges listed</span>';
  html += '<span class="hyper-chip">Click a hyperedge for details</span>';
  html += '</div>';
  html += '<div class="explorer-list">';
  for (i = 0; i < edges.length; i++) {
    var e = edges[i];
    var activeClass = e.uid === this._selectedHyperedgeUid ? ' active' : '';
    var membersPreview = [];
    for (j = 0; j < Math.min(5, e.elements.length); j++) {
      var nNode = nodeById[e.elements[j]];
      membersPreview.push(nNode ? nNode.name : e.elements[j]);
    }
    html += '<div class="explorer-card' + activeClass + '" data-edge-uid="' + e.uid + '">';
    html += '<div class="explorer-card-head">';
    html += '<div class="explorer-card-title">' + this._escapeHtml(e.number) + '</div>';
    html += '<div class="explorer-card-sub">' + this._escapeHtml(e.createdAt || 'n/a') + '</div>';
    html += '</div>';
    html += '<div class="explorer-metrics">';
    html += '<span class="explorer-metric">size ' + e.elements.length + '</span>';
    html += '<span class="explorer-metric">risk ' + this._escapeHtml(e.risk || 'n/a') + '</span>';
    html += '<span class="explorer-metric">impact ' + this._escapeHtml(e.impact || 'n/a') + '</span>';
    html += '<span class="explorer-metric">overlaps ' + overlapMap[e.uid] + '</span>';
    html += '</div>';
    if (membersPreview.length > 0) {
      html += '<div class="explorer-card-sub" style="margin-top:6px;">' + this._escapeHtml(membersPreview.join(', ')) + (e.elements.length > 5 ? ' ...' : '') + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  html += this._renderHyperedgeDetail(selectedEdge, nodeById);
  html += '</div>';

  viewEl.innerHTML = html;
  viewEl.classList.remove('hidden');

  if (this._upsetRenderer) this._upsetRenderer.destroy();
  this._isUpSetView = false;
  if (this._renderer && this._renderer.simulation) this._renderer.simulation.stop();
  if (this._renderer && this._renderer.svg) this._renderer.svg.style('display', 'none');

  var self = this;
  var cards = viewEl.querySelectorAll('.explorer-card');
  cards.forEach(function (card) {
    card.addEventListener('click', function () {
      self._selectedHyperedgeUid = card.getAttribute('data-edge-uid');
      self._renderHyperedgeExplorerView();
    });
  });

  this._updateStats(this._originalGraph.stats, false);
  this._updateLegendCounts();
  var viewLabel = document.getElementById('view-label');
  if (viewLabel) viewLabel.textContent = 'Hyperedge Explorer';
};

BSMDiscovery.prototype._buildMatrixSlice = function () {
  var graph = this._originalGraph;
  if (!graph) return null;

  var search = (this._searchTerm || '').toLowerCase().trim();
  var nodeById = {};
  var entities = [];
  var i;

  for (i = 0; i < graph.nodes.length; i++) {
    nodeById[graph.nodes[i].uid] = graph.nodes[i];
  }

  entities = graph.nodes.filter(function (n) {
    if (n.type !== 'ci') return false;
    if (!search) return true;
    return (n.name || '').toLowerCase().indexOf(search) !== -1;
  });

  entities.sort(function (a, b) {
    var da = graph.incidence[a.uid] ? graph.incidence[a.uid].size : 0;
    var db = graph.incidence[b.uid] ? graph.incidence[b.uid].size : 0;
    if (db !== da) return db - da;
    return a.name < b.name ? -1 : 1;
  });
  entities = entities.slice(0, 32);

  var visibleSet = {};
  for (i = 0; i < entities.length; i++) visibleSet[entities[i].uid] = true;

  var edges = [];
  var edgeLookup = {};
  var edgeMembers = {};

  for (i = 0; i < graph.edges.length; i++) {
    var edge = graph.edges[i];
    var overlap = 0;
    var memberMap = {};
    for (var j = 0; j < edge.elements.length; j++) {
      if (visibleSet[edge.elements[j]]) {
        overlap++;
        memberMap[edge.elements[j]] = true;
      }
    }
    if (overlap === 0) continue;
    edge._visibleOverlap = overlap;
    edges.push(edge);
    edgeLookup[edge.uid] = edge;
    edgeMembers[edge.uid] = memberMap;
  }

  edges.sort(function (a, b) {
    if (b._visibleOverlap !== a._visibleOverlap) return b._visibleOverlap - a._visibleOverlap;
    if (b.elements.length !== a.elements.length) return b.elements.length - a.elements.length;
    if ((a.createdAt || '') < (b.createdAt || '')) return 1;
    if ((a.createdAt || '') > (b.createdAt || '')) return -1;
    return a.number < b.number ? -1 : 1;
  });
  edges = edges.slice(0, 44);

  return {
    entities: entities,
    edges: edges,
    edgeLookup: edgeLookup,
    edgeMembers: edgeMembers,
    nodeById: nodeById
  };
};

BSMDiscovery.prototype._renderHyperedgeDetail = function (edge, nodeById) {
  if (!edge) {
    return '<div class="hyperedge-detail"><h4>No hyperedge selected</h4></div>';
  }

  var members = [];
  for (var i = 0; i < edge.elements.length; i++) {
    var n = nodeById[edge.elements[i]];
    members.push(n ? n.name : edge.elements[i]);
  }

  var html = '';
  html += '<div class="hyperedge-detail">';
  html += '<h4>' + this._escapeHtml(edge.number || edge.uid) + '</h4>';
  html += '<div class="hyperedge-meta">';
  html += '<div class="hyperedge-meta-item"><strong>Members</strong>' + edge.elements.length + '</div>';
  html += '<div class="hyperedge-meta-item"><strong>Risk</strong>' + this._escapeHtml(edge.risk || 'n/a') + '</div>';
  html += '<div class="hyperedge-meta-item"><strong>Impact</strong>' + this._escapeHtml(edge.impact || 'n/a') + '</div>';
  html += '<div class="hyperedge-meta-item"><strong>Group</strong>' + this._escapeHtml(edge.assignmentGroup || 'n/a') + '</div>';
  html += '<div class="hyperedge-meta-item"><strong>Service</strong>' + this._escapeHtml(edge.businessService || 'n/a') + '</div>';
  html += '<div class="hyperedge-meta-item"><strong>Created</strong>' + this._escapeHtml(edge.createdAt || 'n/a') + '</div>';
  html += '</div>';
  html += '<div class="member-chip-list">';
  for (i = 0; i < Math.min(24, members.length); i++) {
    html += '<span class="member-chip">' + this._escapeHtml(members[i]) + '</span>';
  }
  if (members.length > 24) {
    html += '<span class="member-chip">+' + (members.length - 24) + ' more</span>';
  }
  html += '</div>';
  html += '</div>';
  return html;
};

// ---------- Helpers ----------

BSMDiscovery.prototype._ensureHypergraphViewContainer = function () {
  var el = document.getElementById('hypergraph-view');
  if (el) return el;

  var container = document.querySelector(this.containerSelector);
  if (!container) return null;

  el = document.createElement('div');
  el.id = 'hypergraph-view';
  el.className = 'hypergraph-view hidden';
  container.appendChild(el);
  return el;
};

BSMDiscovery.prototype._hideHypergraphView = function () {
  var el = document.getElementById('hypergraph-view');
  if (el) {
    el.classList.add('hidden');
    el.innerHTML = '';
  }
  if (this._renderer && this._renderer.svg) {
    this._renderer.svg.style('display', null);
  }
};

BSMDiscovery.prototype._findEdgeByUid = function (graph, uid) {
  if (!graph || !uid) return null;
  for (var i = 0; i < graph.edges.length; i++) {
    if (graph.edges[i].uid === uid) return graph.edges[i];
  }
  return null;
};

BSMDiscovery.prototype._escapeHtml = function (value) {
  var str = String(value == null ? '' : value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// ---------- Button + Sidebar State ----------

BSMDiscovery.prototype._updateViewButtons = function () {
  var btnMatrix = document.getElementById('btn-view-matrix');
  var btnExplorer = document.getElementById('btn-view-explorer');
  var btnForce = document.getElementById('btn-view-force');
  var btnUpSet = document.getElementById('btn-view-upset');
  var btnOrig = document.getElementById('btn-original');
  var btnTrans = document.getElementById('btn-transposed');

  if (btnMatrix) btnMatrix.classList.toggle('active', this._primaryView === 'matrix');
  if (btnExplorer) btnExplorer.classList.toggle('active', this._primaryView === 'explorer');
  if (btnForce) btnForce.classList.toggle('active', this._primaryView === 'force');
  if (btnUpSet) btnUpSet.classList.toggle('active', this._primaryView === 'upset');

  var projectionEnabled = this._primaryView === 'force' || this._primaryView === 'upset';
  if (btnOrig) {
    btnOrig.disabled = !projectionEnabled;
    btnOrig.classList.toggle('active', projectionEnabled && !this._isTransposed);
  }
  if (btnTrans) {
    btnTrans.disabled = !projectionEnabled;
    btnTrans.classList.toggle('active', projectionEnabled && this._isTransposed);
  }
};

BSMDiscovery.prototype._syncSidebarByView = function () {
  var forceSections = ['hull-section', 'cooccurrence-section', 'force-controls-section'];
  var showForceSections = this._primaryView === 'force' || this._primaryView === 'upset';
  for (var i = 0; i < forceSections.length; i++) {
    var section = document.getElementById(forceSections[i]);
    if (!section) continue;
    section.style.display = showForceSections ? '' : 'none';
  }
  var detailPanel = document.getElementById('node-detail');
  if (detailPanel && !showForceSections) detailPanel.classList.remove('visible');
};

// ---------- Backward-compatible wrappers ----------

BSMDiscovery.prototype._toggleUpSetView = function () {
  if (this._primaryView === 'upset') {
    this._setPrimaryView('force');
  } else {
    this._setPrimaryView('upset');
  }
};

BSMDiscovery.prototype._enterUpSetView = function () {
  this._setPrimaryView('upset');
};

BSMDiscovery.prototype._exitUpSetView = function () {
  if (this._primaryView === 'upset') this._setPrimaryView('force');
};
