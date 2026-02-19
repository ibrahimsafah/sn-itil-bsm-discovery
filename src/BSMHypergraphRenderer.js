/**
 * BSM Hypergraph Renderer — D3 Force-Directed Visualization
 *
 * Renders a HypergraphCore output as a force-directed graph with convex hull
 * overlays for hyperedges. Supports both original and transposed views.
 * Enhanced with analytics-driven visualization: centrality sizing, cluster
 * coloring, anomaly pulses, and cascade overlays.
 *
 * Usage:
 *   var renderer = new BSMHypergraphRenderer('#graph-container');
 *   renderer.render(hypergraphData);
 *   renderer.render(transposedData); // re-renders on transpose
 */

/* global d3 */

function BSMHypergraphRenderer(containerSelector, options) {
  options = options || {};
  this.containerSelector = containerSelector;
  this.width = options.width || 960;
  this.height = options.height || 700;
  this.simulation = null;
  this.svg = null;
  this.zoom = null;
  this.currentGraph = null;
  this._hullPadding = 30;
  this._searchTerm = '';
  this._hiddenTypes = new Set();
  this._onNodeClick = options.onNodeClick || null;
  this._onStatsUpdate = options.onStatsUpdate || null;

  // Analytics overlay state
  this._vizMode = 'type'; // 'type' | 'centrality' | 'cluster' | 'risk'
  this._centralityScores = null;   // { nodeUid: score }
  this._centralityMetric = 'composite';
  this._clusterAssignments = null; // { nodeUid: clusterId }
  this._riskScores = null;         // { nodeUid: score 0-100 }
  this._anomalyNodes = new Set();  // UIDs of anomalous nodes
  this._cascadeOverlays = [];      // [{ source, target, count }]

  // Color schemes
  this._nodeColors = {
    ci: '#4fc3f7',
    group: '#ffb74d',
    service: '#81c784',
    change: '#ce93d8'
  };
  // Cluster palette — 12 distinct hues for community detection
  this._clusterPalette = [
    '#4fc3f7', '#ff8a65', '#81c784', '#ce93d8',
    '#ffd54f', '#4dd0e1', '#f48fb1', '#a5d6a7',
    '#90caf9', '#ffab91', '#80cbc4', '#e6ee9c'
  ];
  // Risk gradient stops
  this._riskGradient = function (score) {
    if (score < 25) return '#81c784';
    if (score < 50) return '#ffd54f';
    if (score < 75) return '#ffb74d';
    return '#ff8a80';
  };
  this._hullPalette = [
    'rgba(79, 195, 247, 0.08)',
    'rgba(255, 183, 77, 0.08)',
    'rgba(129, 199, 132, 0.08)',
    'rgba(206, 147, 216, 0.08)',
    'rgba(255, 138, 128, 0.08)',
    'rgba(128, 222, 234, 0.08)',
    'rgba(255, 213, 79, 0.08)',
    'rgba(174, 213, 129, 0.08)',
    'rgba(144, 164, 174, 0.08)',
    'rgba(239, 154, 154, 0.08)'
  ];
  this._hullStrokePalette = [
    'rgba(79, 195, 247, 0.35)',
    'rgba(255, 183, 77, 0.35)',
    'rgba(129, 199, 132, 0.35)',
    'rgba(206, 147, 216, 0.35)',
    'rgba(255, 138, 128, 0.35)',
    'rgba(128, 222, 234, 0.35)',
    'rgba(255, 213, 79, 0.35)',
    'rgba(174, 213, 129, 0.35)',
    'rgba(144, 164, 174, 0.35)',
    'rgba(239, 154, 154, 0.35)'
  ];
}

// ---------- Initialization ----------

BSMHypergraphRenderer.prototype._initSVG = function () {
  var container = d3.select(this.containerSelector);
  container.selectAll('*').remove();

  var rect = container.node().getBoundingClientRect();
  this.width = rect.width || this.width;
  this.height = rect.height || this.height;

  this.svg = container.append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', '0 0 ' + this.width + ' ' + this.height);

  var defs = this.svg.append('defs');
  // Glow filter for highlighted nodes
  var filter = defs.append('filter').attr('id', 'glow');
  filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
  var feMerge = filter.append('feMerge');
  feMerge.append('feMergeNode').attr('in', 'coloredBlur');
  feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

  // Anomaly pulse filter (stronger glow in red)
  var anomalyFilter = defs.append('filter').attr('id', 'anomaly-pulse');
  anomalyFilter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur');
  var anomalyMerge = anomalyFilter.append('feMerge');
  anomalyMerge.append('feMergeNode').attr('in', 'coloredBlur');
  anomalyMerge.append('feMergeNode').attr('in', 'SourceGraphic');

  // Arrow marker for cascade overlays
  defs.append('marker')
    .attr('id', 'cascade-arrow')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 20)
    .attr('refY', 5)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto-start-reverse')
    .append('path')
    .attr('d', 'M 0 0 L 10 5 L 0 10 z')
    .attr('fill', '#ff8a80');

  // Main group for zoom/pan
  this._g = this.svg.append('g').attr('class', 'graph-layer');
  this._hullLayer = this._g.append('g').attr('class', 'hull-layer');
  this._linkLayer = this._g.append('g').attr('class', 'link-layer');
  this._cascadeLayer = this._g.append('g').attr('class', 'cascade-layer');
  this._nodeLayer = this._g.append('g').attr('class', 'node-layer');
  this._pulseLayer = this._g.append('g').attr('class', 'pulse-layer');
  this._labelLayer = this._g.append('g').attr('class', 'label-layer');

  // Tooltip
  this._tooltip = container.append('div')
    .attr('class', 'hg-tooltip')
    .style('opacity', 0);

  // Zoom behavior
  var self = this;
  this.zoom = d3.zoom()
    .scaleExtent([0.1, 8])
    .on('zoom', function (event) {
      self._g.attr('transform', event.transform);
    });
  this.svg.call(this.zoom);
};

// ---------- Rendering ----------

BSMHypergraphRenderer.prototype.render = function (graph) {
  this.currentGraph = graph;
  this._initSVG();

  var self = this;
  var nodes = graph.nodes.slice();
  var edges = graph.edges.slice();

  // Build node lookup
  var nodeById = {};
  for (var i = 0; i < nodes.length; i++) {
    nodeById[nodes[i].uid] = nodes[i];
    nodes[i].x = this.width / 2 + (Math.random() - 0.5) * 200;
    nodes[i].y = this.height / 2 + (Math.random() - 0.5) * 200;
  }

  // Build links from hyperedge membership (for force simulation)
  var links = [];
  var linkSet = new Set();
  for (var e = 0; e < edges.length; e++) {
    var members = edges[e].elements;
    // Create pairwise links within each hyperedge (for force layout)
    for (var a = 0; a < members.length; a++) {
      for (var b = a + 1; b < members.length; b++) {
        var key = members[a] < members[b] ? members[a] + '|' + members[b] : members[b] + '|' + members[a];
        if (!linkSet.has(key) && nodeById[members[a]] && nodeById[members[b]]) {
          linkSet.add(key);
          links.push({ source: members[a], target: members[b], edgeUid: edges[e].uid });
        }
      }
    }
  }

  // Force simulation — expanded default: strong repulsion, long links
  this.simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(function (d) { return d.uid; }).distance(180).strength(0.15))
    .force('charge', d3.forceManyBody().strength(-350))
    .force('center', d3.forceCenter(this.width / 2, this.height / 2))
    .force('collision', d3.forceCollide().radius(24))
    .force('x', d3.forceX(this.width / 2).strength(0.015))
    .force('y', d3.forceY(this.height / 2).strength(0.015));

  // Draw links
  var linkSelection = this._linkLayer.selectAll('line')
    .data(links)
    .enter().append('line')
    .attr('class', 'hg-link')
    .attr('stroke', '#333')
    .attr('stroke-opacity', 0.15)
    .attr('stroke-width', 0.5);

  // Draw nodes — color and size driven by current vizMode
  var nodeSelection = this._nodeLayer.selectAll('circle')
    .data(nodes)
    .enter().append('circle')
    .attr('class', 'hg-node')
    .attr('r', function (d) { return self._computeRadius(d); })
    .attr('fill', function (d) { return self._computeColor(d); })
    .attr('stroke', function (d) { return d3.color(self._computeColor(d)).darker(0.5); })
    .attr('stroke-width', 1.5)
    .call(d3.drag()
      .on('start', function (event, d) { self._dragStart(event, d); })
      .on('drag', function (event, d) { self._dragMove(event, d); })
      .on('end', function (event, d) { self._dragEnd(event, d); }))
    .on('mouseover', function (event, d) { self._showTooltip(event, d); })
    .on('mouseout', function () { self._hideTooltip(); })
    .on('click', function (event, d) { self._handleNodeClick(event, d); });

  // Draw anomaly pulse rings
  if (this._anomalyNodes.size > 0) {
    var anomalyData = nodes.filter(function (n) { return self._anomalyNodes.has(n.uid); });
    this._pulseLayer.selectAll('circle')
      .data(anomalyData)
      .enter().append('circle')
      .attr('class', 'anomaly-ring')
      .attr('r', function (d) { return self._computeRadius(d) + 6; })
      .attr('fill', 'none')
      .attr('stroke', '#ff8a80')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,3')
      .attr('opacity', 0.7)
      .attr('filter', 'url(#anomaly-pulse)');
  }

  // Draw labels
  var labelSelection = this._labelLayer.selectAll('text')
    .data(nodes)
    .enter().append('text')
    .attr('class', 'hg-label')
    .attr('text-anchor', 'middle')
    .attr('dy', function (d) { return self._nodeRadius(d) + 12; })
    .attr('fill', '#aaa')
    .attr('font-size', '9px')
    .text(function (d) { return d.name; });

  // Store selections for analytics updates
  this._currentNodes = nodeSelection;
  this._currentLabels = labelSelection;
  this._currentLinks = linkSelection;
  this._currentNodeById = nodeById;

  // Tick handler
  var pulseSelection = this._pulseLayer.selectAll('circle');
  this.simulation.on('tick', function () {
    linkSelection
      .attr('x1', function (d) { return d.source.x; })
      .attr('y1', function (d) { return d.source.y; })
      .attr('x2', function (d) { return d.target.x; })
      .attr('y2', function (d) { return d.target.y; });

    nodeSelection
      .attr('cx', function (d) { return d.x; })
      .attr('cy', function (d) { return d.y; })
      .attr('display', function (d) { return self._isVisible(d) ? null : 'none'; });

    labelSelection
      .attr('x', function (d) { return d.x; })
      .attr('y', function (d) { return d.y; })
      .attr('display', function (d) { return self._isVisible(d) ? null : 'none'; });

    // Pulse rings follow their nodes
    pulseSelection
      .attr('cx', function (d) { return d.x; })
      .attr('cy', function (d) { return d.y; })
      .attr('display', function (d) { return self._isVisible(d) ? null : 'none'; });

    // Cascade arrows follow their source/target nodes
    self._cascadeLayer.selectAll('line')
      .attr('x1', function (d) { return d.sourceNode ? d.sourceNode.x : 0; })
      .attr('y1', function (d) { return d.sourceNode ? d.sourceNode.y : 0; })
      .attr('x2', function (d) { return d.targetNode ? d.targetNode.x : 0; })
      .attr('y2', function (d) { return d.targetNode ? d.targetNode.y : 0; });

    self._drawHulls(edges, nodeById);
  });

  // Notify stats
  if (this._onStatsUpdate) {
    this._onStatsUpdate(graph.stats, graph.isTransposed);
  }
};

// ---------- Convex Hull Rendering ----------

BSMHypergraphRenderer.prototype._drawHulls = function (edges, nodeById) {
  var self = this;
  this._hullLayer.selectAll('path').remove();

  // Smooth closed curve generator (Catmull-Rom spline)
  var smoothHull = d3.line()
    .x(function (d) { return d[0]; })
    .y(function (d) { return d[1]; })
    .curve(d3.curveCatmullRomClosed.alpha(0.5));

  for (var i = 0; i < edges.length; i++) {
    var edge = edges[i];
    var points = [];

    for (var m = 0; m < edge.elements.length; m++) {
      var node = nodeById[edge.elements[m]];
      if (node && node.x != null && self._isVisible(node)) {
        // Generate radial padding points around each node for a rounder hull
        var pad = self._hullPadding;
        var steps = 8;
        for (var s = 0; s < steps; s++) {
          var angle = (2 * Math.PI * s) / steps;
          points.push([node.x + pad * Math.cos(angle), node.y + pad * Math.sin(angle)]);
        }
      }
    }

    if (points.length < 6) continue; // Need at least 2 nodes

    var hull = d3.polygonHull(points);
    if (!hull) continue;

    var colorIdx = i % this._hullPalette.length;

    this._hullLayer.append('path')
      .attr('d', smoothHull(hull))
      .attr('fill', this._hullPalette[colorIdx])
      .attr('stroke', this._hullStrokePalette[colorIdx])
      .attr('stroke-width', 1.5)
      .attr('class', 'hg-hull');
  }
};

// ---------- Node Sizing (Analytics-Aware) ----------

BSMHypergraphRenderer.prototype._nodeRadius = function (d) {
  if (d.type === 'service') return 10;
  if (d.type === 'group') return 9;
  if (d.type === 'change') return 8;
  return 6; // ci
};

/**
 * Compute node radius based on current vizMode.
 * In centrality/risk modes, CIs are scaled by their score.
 */
BSMHypergraphRenderer.prototype._computeRadius = function (d) {
  var base = this._nodeRadius(d);

  if (this._vizMode === 'centrality' && this._centralityScores && d.type === 'ci') {
    var score = this._centralityScores[d.uid] || 0;
    // Scale from base to 3x base based on centrality
    return base + score * base * 2;
  }

  if (this._vizMode === 'risk' && this._riskScores && d.type === 'ci') {
    var riskScore = this._riskScores[d.uid] || 0;
    return base + (riskScore / 100) * base * 1.5;
  }

  return base;
};

/**
 * Compute node color based on current vizMode.
 */
BSMHypergraphRenderer.prototype._computeColor = function (d) {
  if (this._vizMode === 'cluster' && this._clusterAssignments && d.type === 'ci') {
    var clusterId = this._clusterAssignments[d.uid];
    if (clusterId != null) {
      return this._clusterPalette[clusterId % this._clusterPalette.length];
    }
  }

  if (this._vizMode === 'risk' && this._riskScores && d.type === 'ci') {
    var score = this._riskScores[d.uid] || 0;
    return this._riskGradient(score);
  }

  return this._nodeColors[d.type] || '#999';
};

// ---------- Analytics Visualization API ----------

/**
 * Set the visualization mode and apply analytics overlays.
 * @param {string} mode - 'type' | 'centrality' | 'cluster' | 'risk'
 */
BSMHypergraphRenderer.prototype.setVizMode = function (mode) {
  this._vizMode = mode;
  this._applyVisualOverlay();
};

/**
 * Supply centrality scores for centrality viz mode.
 * @param {Object} scores - { nodeUid: normalizedScore }
 * @param {string} metric - 'composite' | 'degree' | 'betweenness' | 'eigenvector'
 */
BSMHypergraphRenderer.prototype.setCentralityData = function (scores, metric) {
  this._centralityScores = scores;
  this._centralityMetric = metric || 'composite';
  if (this._vizMode === 'centrality') this._applyVisualOverlay();
};

/**
 * Supply cluster assignments for cluster viz mode.
 * @param {Object} assignments - { nodeUid: clusterId }
 */
BSMHypergraphRenderer.prototype.setClusterData = function (assignments) {
  this._clusterAssignments = assignments;
  if (this._vizMode === 'cluster') this._applyVisualOverlay();
};

/**
 * Supply risk scores for risk viz mode.
 * @param {Object} scores - { nodeUid: score 0-100 }
 */
BSMHypergraphRenderer.prototype.setRiskData = function (scores) {
  this._riskScores = scores;
  if (this._vizMode === 'risk') this._applyVisualOverlay();
};

/**
 * Highlight specific nodes as anomalous (pulse rings).
 * @param {string[]} nodeUids - UIDs of anomalous nodes
 */
BSMHypergraphRenderer.prototype.setAnomalyNodes = function (nodeUids) {
  this._anomalyNodes = new Set(nodeUids || []);
  this._drawAnomalyRings();
};

/**
 * Show directional cascade arrows between node pairs.
 * @param {Array} cascades - [{ source: uid, target: uid, count: N }]
 */
BSMHypergraphRenderer.prototype.setCascadeOverlays = function (cascades) {
  this._cascadeOverlays = cascades || [];
  this._drawCascadeArrows();
};

/**
 * Highlight specific node UIDs (for analytics panel interactions).
 * @param {string[]} nodeUids - UIDs to highlight
 */
BSMHypergraphRenderer.prototype.highlightNodes = function (nodeUids) {
  var highlightSet = new Set(nodeUids || []);
  if (highlightSet.size === 0) {
    this.clearHighlight();
    return;
  }

  this._nodeLayer.selectAll('circle')
    .attr('opacity', function (n) { return highlightSet.has(n.uid) ? 1 : 0.12; })
    .attr('filter', function (n) { return highlightSet.has(n.uid) ? 'url(#glow)' : null; });

  this._labelLayer.selectAll('text')
    .attr('opacity', function (n) { return highlightSet.has(n.uid) ? 1 : 0.05; });

  this._linkLayer.selectAll('line')
    .attr('stroke-opacity', function (l) {
      var sUid = l.source.uid || l.source;
      var tUid = l.target.uid || l.target;
      return highlightSet.has(sUid) && highlightSet.has(tUid) ? 0.5 : 0.02;
    });
};

/**
 * Re-apply visual overlays (color, size) after mode or data changes.
 */
BSMHypergraphRenderer.prototype._applyVisualOverlay = function () {
  var self = this;
  if (!this._currentNodes) return;

  this._currentNodes
    .transition().duration(400)
    .attr('r', function (d) { return self._computeRadius(d); })
    .attr('fill', function (d) { return self._computeColor(d); })
    .attr('stroke', function (d) { return d3.color(self._computeColor(d)).darker(0.5); });

  // Update labels y-offset for new radii
  this._currentLabels
    .transition().duration(400)
    .attr('dy', function (d) { return self._computeRadius(d) + 12; });

  // Update collision force for new radii
  if (this.simulation) {
    this.simulation.force('collision', d3.forceCollide().radius(function (d) {
      return self._computeRadius(d) + 4;
    }));
    this.simulation.alpha(0.15).restart();
  }
};

/**
 * Draw anomaly pulse rings around flagged nodes.
 */
BSMHypergraphRenderer.prototype._drawAnomalyRings = function () {
  if (!this._pulseLayer) return;
  var self = this;
  this._pulseLayer.selectAll('circle').remove();

  if (this._anomalyNodes.size === 0 || !this.currentGraph) return;

  var anomalyData = this.currentGraph.nodes.filter(function (n) {
    return self._anomalyNodes.has(n.uid);
  });

  this._pulseLayer.selectAll('circle')
    .data(anomalyData)
    .enter().append('circle')
    .attr('class', 'anomaly-ring')
    .attr('cx', function (d) { return d.x || 0; })
    .attr('cy', function (d) { return d.y || 0; })
    .attr('r', function (d) { return self._computeRadius(d) + 6; })
    .attr('fill', 'none')
    .attr('stroke', '#ff8a80')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '4,3')
    .attr('opacity', 0.7)
    .attr('filter', 'url(#anomaly-pulse)');
};

/**
 * Draw directional arrows for temporal cascades.
 */
BSMHypergraphRenderer.prototype._drawCascadeArrows = function () {
  if (!this._cascadeLayer || !this._currentNodeById) return;
  this._cascadeLayer.selectAll('line').remove();

  if (this._cascadeOverlays.length === 0) return;

  var nodeById = this._currentNodeById;
  var maxCount = 1;
  for (var i = 0; i < this._cascadeOverlays.length; i++) {
    if (this._cascadeOverlays[i].count > maxCount) maxCount = this._cascadeOverlays[i].count;
  }

  var cascadeData = [];
  for (var j = 0; j < this._cascadeOverlays.length; j++) {
    var c = this._cascadeOverlays[j];
    var sNode = nodeById[c.source];
    var tNode = nodeById[c.target];
    if (sNode && tNode) {
      cascadeData.push({
        sourceNode: sNode,
        targetNode: tNode,
        count: c.count,
        width: 1 + (c.count / maxCount) * 3
      });
    }
  }

  this._cascadeLayer.selectAll('line')
    .data(cascadeData)
    .enter().append('line')
    .attr('class', 'cascade-line')
    .attr('x1', function (d) { return d.sourceNode.x || 0; })
    .attr('y1', function (d) { return d.sourceNode.y || 0; })
    .attr('x2', function (d) { return d.targetNode.x || 0; })
    .attr('y2', function (d) { return d.targetNode.y || 0; })
    .attr('stroke', '#ff8a80')
    .attr('stroke-width', function (d) { return d.width; })
    .attr('stroke-opacity', 0.6)
    .attr('marker-end', 'url(#cascade-arrow)');
};

// ---------- Visibility (Filters + Search) ----------

BSMHypergraphRenderer.prototype._isVisible = function (d) {
  if (this._hiddenTypes.has(d.type)) return false;
  if (this._searchTerm) {
    var term = this._searchTerm.toLowerCase();
    var name = (d.name || '').toLowerCase();
    var uid = (d.uid || '').toLowerCase();
    if (name.indexOf(term) === -1 && uid.indexOf(term) === -1) return false;
  }
  return true;
};

BSMHypergraphRenderer.prototype.setSearch = function (term) {
  this._searchTerm = term || '';
  if (this.simulation) this.simulation.alpha(0.1).restart();
};

BSMHypergraphRenderer.prototype.toggleType = function (type) {
  if (this._hiddenTypes.has(type)) {
    this._hiddenTypes.delete(type);
  } else {
    this._hiddenTypes.add(type);
  }
  if (this.simulation) this.simulation.alpha(0.1).restart();
};

BSMHypergraphRenderer.prototype.isTypeVisible = function (type) {
  return !this._hiddenTypes.has(type);
};

// ---------- Force Controls ----------

BSMHypergraphRenderer.prototype.setChargeStrength = function (val) {
  if (!this.simulation) return;
  this.simulation.force('charge').strength(val);
  this.simulation.alpha(0.3).restart();
};

BSMHypergraphRenderer.prototype.setLinkDistance = function (val) {
  if (!this.simulation) return;
  this.simulation.force('link').distance(val);
  this.simulation.alpha(0.3).restart();
};

// ---------- Drag Handlers ----------

BSMHypergraphRenderer.prototype._dragStart = function (event, d) {
  if (!event.active) this.simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
};

BSMHypergraphRenderer.prototype._dragMove = function (event, d) {
  d.fx = event.x;
  d.fy = event.y;
};

BSMHypergraphRenderer.prototype._dragEnd = function (event, d) {
  if (!event.active) this.simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
};

// ---------- Tooltip ----------

BSMHypergraphRenderer.prototype._showTooltip = function (event, d) {
  var lines = ['<strong>' + d.name + '</strong>'];
  lines.push('<span class="hg-tooltip-type">' + d.type + '</span>');

  if (d.type === 'ci') {
    if (d.className) lines.push('Class: ' + d.className);
    if (d.ipAddress) lines.push('IP: ' + d.ipAddress);
    if (d.role) lines.push('Role: ' + d.role);
  } else if (d.type === 'change') {
    if (d.risk) lines.push('Risk: ' + d.risk);
    if (d.changeType) lines.push('Type: ' + d.changeType);
    if (d.impact) lines.push('Impact: ' + d.impact);
    if (d.region) lines.push('Region: ' + d.region);
  }

  // Degree (number of hyperedges containing this node)
  if (this.currentGraph && this.currentGraph.incidence[d.uid]) {
    lines.push('Degree: ' + this.currentGraph.incidence[d.uid].size);
  }

  // Analytics data in tooltip
  if (this._centralityScores && this._centralityScores[d.uid] != null) {
    lines.push('Centrality: ' + (this._centralityScores[d.uid] * 100).toFixed(1) + '%');
  }
  if (this._riskScores && this._riskScores[d.uid] != null) {
    lines.push('Risk: ' + Math.round(this._riskScores[d.uid]) + '/100');
  }
  if (this._clusterAssignments && this._clusterAssignments[d.uid] != null) {
    lines.push('Cluster: #' + this._clusterAssignments[d.uid]);
  }
  if (this._anomalyNodes.has(d.uid)) {
    lines.push('<span style="color:#ff8a80">&#9888; Anomaly detected</span>');
  }

  this._tooltip
    .html(lines.join('<br>'))
    .style('left', (event.pageX + 12) + 'px')
    .style('top', (event.pageY - 12) + 'px')
    .transition().duration(150).style('opacity', 1);
};

BSMHypergraphRenderer.prototype._hideTooltip = function () {
  this._tooltip.transition().duration(200).style('opacity', 0);
};

// ---------- Click ----------

BSMHypergraphRenderer.prototype._handleNodeClick = function (event, d) {
  // Highlight connected nodes
  this._highlightConnected(d);
  if (this._onNodeClick) this._onNodeClick(d);
};

BSMHypergraphRenderer.prototype._highlightConnected = function (d) {
  var connectedSet = new Set();
  connectedSet.add(d.uid);

  if (this.currentGraph && this.currentGraph.incidence[d.uid]) {
    var edgeUids = Array.from(this.currentGraph.incidence[d.uid]);
    for (var i = 0; i < this.currentGraph.edges.length; i++) {
      var edge = this.currentGraph.edges[i];
      if (edgeUids.indexOf(edge.uid) !== -1) {
        for (var j = 0; j < edge.elements.length; j++) {
          connectedSet.add(edge.elements[j]);
        }
      }
    }
  }

  this._nodeLayer.selectAll('circle')
    .attr('opacity', function (n) { return connectedSet.has(n.uid) ? 1 : 0.15; })
    .attr('filter', function (n) { return n.uid === d.uid ? 'url(#glow)' : null; });

  this._labelLayer.selectAll('text')
    .attr('opacity', function (n) { return connectedSet.has(n.uid) ? 1 : 0.1; });

  this._linkLayer.selectAll('line')
    .attr('stroke-opacity', function (l) {
      return connectedSet.has(l.source.uid || l.source) && connectedSet.has(l.target.uid || l.target) ? 0.4 : 0.03;
    });
};

BSMHypergraphRenderer.prototype.clearHighlight = function () {
  this._nodeLayer.selectAll('circle').attr('opacity', 1).attr('filter', null);
  this._labelLayer.selectAll('text').attr('opacity', 1);
  this._linkLayer.selectAll('line').attr('stroke-opacity', 0.15);
};

/**
 * Clear all analytics overlays (cascades, anomalies, highlights).
 */
BSMHypergraphRenderer.prototype.clearAnalyticsOverlays = function () {
  this.clearHighlight();
  this._cascadeOverlays = [];
  this._anomalyNodes = new Set();
  if (this._cascadeLayer) this._cascadeLayer.selectAll('line').remove();
  if (this._pulseLayer) this._pulseLayer.selectAll('circle').remove();
};

// ---------- Resize ----------

BSMHypergraphRenderer.prototype.resize = function () {
  if (this.currentGraph) this.render(this.currentGraph);
};

// ---------- Destroy ----------

BSMHypergraphRenderer.prototype.destroy = function () {
  if (this.simulation) this.simulation.stop();
  d3.select(this.containerSelector).selectAll('*').remove();
};
