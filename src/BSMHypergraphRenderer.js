/**
 * BSM Hypergraph Renderer — D3 Force-Directed Graph
 *
 * Pure D3 v7 renderer. SVG rendering + CPU force simulation with
 * Barnes-Hut approximation (O(n log n) per tick).
 *
 * Usage:
 *   var renderer = new BSMHypergraphRenderer('#graph-container');
 *   renderer.render(hypergraphData);
 */

/* global d3 */

function BSMHypergraphRenderer(containerSelector, options) {
  options = options || {};
  this.containerSelector = containerSelector;
  this.width = 960;
  this.height = 700;
  this.simulation = null;
  this.svg = null;
  this.currentGraph = null;
  this._onNodeClick = options.onNodeClick || null;
  this._onHullClick = options.onHullClick || null;
  this._onStatsUpdate = options.onStatsUpdate || null;

  this._colors = {
    ci: '#4fc3f7',
    group: '#ffb74d',
    service: '#81c784',
    change: '#ce93d8'
  };
  this._linkLayer = null;
  this._hullLayer = null;
  this._nodeLayer = null;
  this._labelLayer = null;
  this._linkSel = null;
  this._hullSel = null;
  this._selectedHullUid = null;
  this._tooltip = null;
  this._nodeById = null;
  this._maxLinkWeight = 1;
  this._visualStylePreset = 'soft-region';
  this._visualStyle = this._resolveVisualStyle(this._visualStylePreset);

  this._visualStylePresets = {
    'soft-region': {
      label: 'Soft Region + Thin Links',
      hull: {
        fillOpacity: 0.08,
        strokeOpacity: 0.35,
        strokeWidth: 1,
        padding: 20,
        strokeDashArray: null
      },
      link: {
        stroke: '#94a3b8',
        strokeOpacity: 0.45,
        strokeWidth: 0.5,
        linecap: 'round'
      },
      highlight: {
        linkActiveScale: 1.25,
        linkInactiveScale: 0.12,
        hullFillScale: 1.65,
        hullStrokeScale: 1.15
      }
    },
    outline: {
      label: 'Outline-Only Hulls + Bold Edges',
      hull: {
        fillOpacity: 0,
        strokeOpacity: 0.75,
        strokeWidth: 1.6,
        padding: 18,
        strokeDashArray: '4 4'
      },
      link: {
        stroke: '#94a3b8',
        strokeOpacity: 0.55,
        strokeWidth: 1.0,
        strokeDashArray: '2 3',
        linecap: 'round'
      },
      highlight: {
        linkActiveScale: 1.3,
        linkInactiveScale: 0.18,
        hullFillScale: 0,
        hullStrokeScale: 1.1
      }
    },
    contour: {
      label: 'Contour Bands',
      hull: {
        fillOpacity: 0.12,
        strokeOpacity: 0.42,
        strokeWidth: 2.2,
        padding: 26,
        strokeDashArray: '2 5'
      },
      link: {
        stroke: '#94a3b8',
        strokeOpacity: 0.34,
        strokeWidth: 0.6,
        strokeDashArray: '1 5',
        linecap: 'round'
      },
      highlight: {
        linkActiveScale: 1.2,
        linkInactiveScale: 0.15,
        hullFillScale: 1.25,
        hullStrokeScale: 1.2
      }
    },
    weighted: {
      label: 'Ribbon-Like Weighted Edges',
      hull: {
        fillOpacity: 0.05,
        strokeOpacity: 0.22,
        strokeWidth: 1.2,
        padding: 22,
        strokeDashArray: null
      },
      link: {
        stroke: '#94a3b8',
        strokeOpacity: 0.66,
        strokeWidth: 'weighted',
        linecap: 'round'
      },
      highlight: {
        linkActiveScale: 1.2,
        linkInactiveScale: 0.14,
        hullFillScale: 1.5,
        hullStrokeScale: 1.2
      }
    },
    emphasis: {
      label: 'Muted Hulls + Emphasis Edges',
      hull: {
        fillOpacity: 0.03,
        strokeOpacity: 0.1,
        strokeWidth: 1,
        padding: 16,
        strokeDashArray: null
      },
      link: {
        stroke: '#64748b',
        strokeOpacity: 0.28,
        strokeWidth: 0.6,
        linecap: 'butt'
      },
      highlight: {
        linkActiveScale: 2.2,
        linkInactiveScale: 0.08,
        hullFillScale: 1.8,
        hullStrokeScale: 1.8
      }
    },
    glow: {
      label: 'Glow Edges',
      hull: {
        fillOpacity: 0,
        strokeOpacity: 0.2,
        strokeWidth: 1.1,
        padding: 19,
        strokeDashArray: null
      },
      link: {
        stroke: '#38bdf8',
        strokeOpacity: 0.52,
        strokeWidth: 1.2,
        linecap: 'round'
      },
      highlight: {
        linkActiveScale: 1.3,
        linkInactiveScale: 0.14,
        hullFillScale: 0,
        hullStrokeScale: 1.3
      }
    }
  };
}

BSMHypergraphRenderer.prototype._resolveVisualStyle = function (presetName) {
  if (!this._visualStylePresets || !this._visualStylePresets[presetName]) {
    return this._visualStylePresets['soft-region'];
  }
  return this._visualStylePresets[presetName];
};

BSMHypergraphRenderer.prototype._getVisualStyle = function () {
  return this._visualStyle || this._resolveVisualStyle(this._visualStylePreset);
};

BSMHypergraphRenderer.prototype._linkStrokeWidth = function (linkData) {
  var style = this._getVisualStyle();
  if (typeof style.link.strokeWidth === 'function') {
    return style.link.strokeWidth(linkData, this._maxLinkWeight || 1);
  }
  return style.link.strokeWidth || 0.6;
};

BSMHypergraphRenderer.prototype._applyVisualStyle = function () {
  if (!this._linkSel || !this._hullSel) return;

  var style = this._getVisualStyle();
  var weightScale = this._maxLinkWeight || 1;

  this._linkSel
    .attr('stroke', style.link.stroke)
    .attr('stroke-opacity', style.link.strokeOpacity)
    .attr('stroke-width', function (l) {
      if (style.link.strokeWidth === 'weighted') {
        return 0.55 + Math.sqrt(Math.min((l.weight || 1), weightScale) / weightScale) * 1.9;
      }
      if (typeof style.link.strokeWidth === 'function') {
        return style.link.strokeWidth(l, weightScale);
      }
      return style.link.strokeWidth;
    })
    .attr('stroke-dasharray', style.link.strokeDashArray || null)
    .attr('stroke-linecap', style.link.linecap || 'round')
    .attr('stroke-linejoin', style.link.linejoin || 'round');

  this._hullSel
    .attr('fill-opacity', style.hull.fillOpacity)
    .attr('stroke-opacity', style.hull.strokeOpacity)
    .attr('stroke-width', style.hull.strokeWidth)
    .attr('stroke-dasharray', style.hull.strokeDashArray || null);

  this._recomputeHullPaths();
};

BSMHypergraphRenderer.prototype.setVisualPreset = function (presetName) {
  if (!this._visualStylePresets[presetName]) return;
  this._visualStylePreset = presetName;
  this._visualStyle = this._resolveVisualStyle(presetName);
  this._applyVisualStyle();
};

// ──────────────────────────────────────────────
//  Core Rendering
// ──────────────────────────────────────────────

BSMHypergraphRenderer.prototype.render = function (graph) {
  if (this.simulation) this.simulation.stop();
  this.currentGraph = graph;

  var container = d3.select(this.containerSelector);
  container.selectAll('svg').remove();
  container.selectAll('.hg-tooltip').remove();

  // Use window dimensions — getBoundingClientRect returns 0 before first layout
  var W = window.innerWidth;
  var H = window.innerHeight;

  // If the container has a known width (e.g. sidebar offset), measure it
  var containerNode = container.node();
  if (containerNode) {
    var r = containerNode.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      W = r.width;
      H = r.height;
    }
  }
  this.width = W;
  this.height = H;

  // SVG with explicit pixel dimensions — no viewBox
  this.svg = container.append('svg')
    .attr('width', W)
    .attr('height', H);

  // Glow filter
  var defs = this.svg.append('defs');
  var filter = defs.append('filter').attr('id', 'glow');
  filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
  var feMerge = filter.append('feMerge');
  feMerge.append('feMergeNode').attr('in', 'coloredBlur');
  feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

  // Main group (zoom target)
  var g = this.svg.append('g').attr('class', 'graph-layer');
  this._g = g;

  // Zoom + pan
  var zoom = d3.zoom()
    .scaleExtent([0.1, 8])
    .on('zoom', function (event) { g.attr('transform', event.transform); });
  this.svg.call(zoom);

  // Tooltip
  this._tooltip = container.append('div')
    .attr('class', 'hg-tooltip')
    .style('opacity', 0);

  // --- Prepare data ---
  var nodes = graph.nodes.slice();
  var nodeById = {};
  for (var i = 0; i < nodes.length; i++) {
    nodeById[nodes[i].uid] = nodes[i];
    // Pre-spread initial positions around center
    nodes[i].x = W / 2 + (Math.random() - 0.5) * W * 0.5;
    nodes[i].y = H / 2 + (Math.random() - 0.5) * H * 0.5;
  }

  var links = this._buildLinks(graph.edges, nodeById);

  // --- Force simulation (pure CPU) ---
  this.simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(function (d) { return d.uid; }).distance(100).strength(0.1))
    .force('charge', d3.forceManyBody().strength(-400))
    .force('x', d3.forceX(W / 2).strength(0.05))
    .force('y', d3.forceY(H / 2).strength(0.05))
    .force('collision', d3.forceCollide(14));

  // --- Draw layers ---
  var linkLayer = g.append('g').attr('class', 'link-layer');
  var hullLayer = g.append('g').attr('class', 'hull-layer');
  var nodeLayer = g.append('g').attr('class', 'node-layer');
  var labelLayer = g.append('g').attr('class', 'label-layer');

  this._nodeLayer = nodeLayer;
  this._linkLayer = linkLayer;
  this._hullLayer = hullLayer;
  this._labelLayer = labelLayer;
  this._nodeById = nodeById;

  // Links
  var linkSel = linkLayer.selectAll('line')
    .data(links)
    .enter().append('line');

  // Nodes
  var self = this;
  var nodeSel = nodeLayer.selectAll('circle')
    .data(nodes)
    .enter().append('circle')
    .attr('r', function (d) { return self._radius(d); })
    .attr('fill', function (d) { return self._colors[d.type] || '#999'; })
    .attr('stroke', function (d) {
      return d3.color(self._colors[d.type] || '#999').darker(0.5);
    })
    .attr('stroke-width', 1)
    .attr('cursor', 'grab')
    .call(d3.drag()
      .on('start', function (event, d) {
        if (!event.active) self.simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', function (event, d) {
        d.fx = event.x; d.fy = event.y;
      })
      .on('end', function (event, d) {
        if (!event.active) self.simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      }))
    .on('mouseover', function (event, d) { self._showTooltip(event, d); })
    .on('mouseout', function () { self._hideTooltip(); })
    .on('click', function (event, d) {
      if (self._onNodeClick) self._onNodeClick(d);
      self._highlightConnected(d);
    });

  // Labels
  var labelSel = labelLayer.selectAll('text')
    .data(nodes)
    .enter().append('text')
    .text(function (d) { return d.name; })
    .attr('text-anchor', 'middle')
    .attr('dy', function (d) { return self._radius(d) + 14; })
    .attr('fill', '#64748b')
    .attr('font-size', '7px')
    .attr('pointer-events', 'none');

  // Hulls — colored convex hull paths around hyperedge groups
  var hullRiskColors = { Critical: '#ff5252', High: '#ff9800', Medium: '#ffc107', Low: '#4caf50' };
  var hullEdges = graph.edges.filter(function (e) { return e.elements.length >= 3; });
  var hullSel = hullLayer.selectAll('path')
    .data(hullEdges)
    .enter().append('path')
    .attr('class', 'hg-hull')
    .attr('fill', function (e) { return hullRiskColors[e.risk] || '#94a3b8'; })
    .attr('stroke', function (e) { return hullRiskColors[e.risk] || '#94a3b8'; })
    .on('mouseover', function (event, e) { self._showHullTooltip(event, e); })
    .on('mouseout', function () { self._hideTooltip(); })
    .on('click', function (event, e) {
      event.stopPropagation();
      if (self._onHullClick) self._onHullClick(e);
    });
  this._hullSel = hullSel;
  this._hullEdges = hullEdges;
  this._linkSel = linkSel;

  this._applyVisualStyle();

  // Tick
  this.simulation.on('tick', function () {
    linkSel
      .attr('x1', function (d) { return d.source.x; })
      .attr('y1', function (d) { return d.source.y; })
      .attr('x2', function (d) { return d.target.x; })
      .attr('y2', function (d) { return d.target.y; });
    nodeSel
      .attr('cx', function (d) { return d.x; })
      .attr('cy', function (d) { return d.y; });
    labelSel
      .attr('x', function (d) { return d.x; })
      .attr('y', function (d) { return d.y; });
    // Update hull paths
    self._recomputeHullPaths();
  });

  // Notify stats
  if (this._onStatsUpdate) {
    this._onStatsUpdate(graph.stats, graph.isTransposed);
  }

  console.log('[BSM] Rendered ' + nodes.length + ' nodes, ' + links.length + ' links (' + W + 'x' + H + ')');
};

// ──────────────────────────────────────────────
//  Link Builder (hyperedge → pairwise links)
// ──────────────────────────────────────────────

BSMHypergraphRenderer.prototype._buildLinks = function (edges, nodeById) {
  var linkMap = {};
  var links = [];
  this._maxLinkWeight = 1;
  for (var e = 0; e < edges.length; e++) {
    var members = edges[e].elements;
    for (var a = 0; a < members.length; a++) {
      for (var b = a + 1; b < members.length; b++) {
        var key = members[a] < members[b]
          ? members[a] + '|' + members[b]
          : members[b] + '|' + members[a];
        if (nodeById[members[a]] && nodeById[members[b]]) {
          if (!linkMap[key]) {
            linkMap[key] = {
              source: members[a],
              target: members[b],
              weight: 0
            };
          }
          linkMap[key].weight++;
        }
      }
    }
  }

  for (var pairKey in linkMap) {
    if (Object.prototype.hasOwnProperty.call(linkMap, pairKey)) {
      var link = linkMap[pairKey];
      links.push(link);
      if (link.weight > this._maxLinkWeight) this._maxLinkWeight = link.weight;
    }
  }

  return links;
};

BSMHypergraphRenderer.prototype._recomputeHullPaths = function () {
  if (!this._hullSel || !this._nodeById) return;
  var style = this._getVisualStyle();
  var self = this;
  var padding = (style && style.hull && style.hull.padding) || 20;
  this._hullSel.attr('d', function (e) {
    var pts = [];
    for (var hi = 0; hi < e.elements.length; hi++) {
      var n = self._nodeById[e.elements[hi]];
      if (n && n.x != null && n.y != null) pts.push([n.x, n.y]);
    }
    return self._hullPath(pts, padding);
  });
};

BSMHypergraphRenderer.prototype._hullPath = function (points, padding) {
  if (points.length < 3) return '';
  var hull = d3.polygonHull(points);
  if (!hull || hull.length < 3) return '';

  // Compute centroid
  var cx = 0, cy = 0;
  for (var i = 0; i < hull.length; i++) {
    cx += hull[i][0];
    cy += hull[i][1];
  }
  cx /= hull.length;
  cy /= hull.length;

  // Pad each vertex outward from centroid
  var padded = [];
  for (var j = 0; j < hull.length; j++) {
    var dx = hull[j][0] - cx;
    var dy = hull[j][1] - cy;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    padded.push([
      hull[j][0] + (dx / dist) * padding,
      hull[j][1] + (dy / dist) * padding
    ]);
  }

  return d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5))(padded);
};

// ──────────────────────────────────────────────
//  Node sizing
// ──────────────────────────────────────────────

BSMHypergraphRenderer.prototype._radius = function (d) {
  if (d.type === 'service') return 12;
  if (d.type === 'group') return 10;
  if (d.type === 'change') return 9;
  return 7;
};

// ──────────────────────────────────────────────
//  Tooltip
// ──────────────────────────────────────────────

BSMHypergraphRenderer.prototype._showTooltip = function (event, d) {
  var lines = ['<strong>' + d.name + '</strong>'];
  lines.push('<span class="hg-tooltip-type">' + d.type + '</span>');
  if (d.className) lines.push('Class: ' + d.className);
  if (d.ipAddress) lines.push('IP: ' + d.ipAddress);
  if (d.role) lines.push('Role: ' + d.role);
  if (d.os) lines.push('OS: ' + d.os);
  if (d.risk) lines.push('Risk: ' + d.risk);
  if (d.businessService) lines.push('Service: ' + d.businessService);

  if (this.currentGraph && this.currentGraph.incidence[d.uid]) {
    lines.push('Degree: ' + this.currentGraph.incidence[d.uid].size);
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

BSMHypergraphRenderer.prototype._showHullTooltip = function (event, e) {
  var lines = ['<strong>' + (e.number || e.uid) + '</strong>'];
  lines.push('<span class="hg-tooltip-type">Hyperedge</span>');
  lines.push('Members: ' + (e.elements ? e.elements.length : 0));
  if (e.risk) lines.push('Risk: ' + e.risk);
  if (e.impact) lines.push('Impact: ' + e.impact);
  if (e.assignmentGroup) lines.push('Group: ' + e.assignmentGroup);
  if (e.businessService) lines.push('Service: ' + e.businessService);
  if (e.createdAt) lines.push('Created: ' + e.createdAt);

  this._tooltip
    .html(lines.join('<br>'))
    .style('left', (event.pageX + 12) + 'px')
    .style('top', (event.pageY - 12) + 'px')
    .transition().duration(150).style('opacity', 1);
};

// ──────────────────────────────────────────────
//  Highlight connected nodes on click
// ──────────────────────────────────────────────

BSMHypergraphRenderer.prototype._highlightConnected = function (d) {
  var connected = new Set();
  connected.add(d.uid);
  var self = this;

  var connectedEdges = new Set();
  if (this.currentGraph && this.currentGraph.incidence[d.uid]) {
    var edgeUids = Array.from(this.currentGraph.incidence[d.uid]);
    for (var i = 0; i < this.currentGraph.edges.length; i++) {
      var edge = this.currentGraph.edges[i];
      if (edgeUids.indexOf(edge.uid) !== -1) {
        connectedEdges.add(edge.uid);
        for (var j = 0; j < edge.elements.length; j++) {
          connected.add(edge.elements[j]);
        }
      }
    }
  }

  this._nodeLayer.selectAll('circle')
    .attr('opacity', function (n) { return connected.has(n.uid) ? 1 : 0.15; })
    .attr('filter', function (n) { return n.uid === d.uid ? 'url(#glow)' : null; });
  this._labelLayer.selectAll('text')
    .attr('opacity', function (n) { return connected.has(n.uid) ? 1 : 0.1; });
  this._linkLayer.selectAll('line')
    .attr('stroke-opacity', function (l) {
      var style = self._getVisualStyle();
      var active = style.link.strokeOpacity * (style.highlight.linkActiveScale || 1.2);
      var inactive = style.link.strokeOpacity * (style.highlight.linkInactiveScale || 0.1);
      var s = l.source.uid || l.source;
      var t = l.target.uid || l.target;
      return connected.has(s) && connected.has(t) ? Math.min(1, active) : Math.max(0.01, inactive);
    });
  // Hulls
  if (this._hullSel) {
    var style = this._getVisualStyle();
    this._hullSel.attr('fill-opacity', function (e) {
      return connectedEdges.has(e.uid) ? style.hull.fillOpacity * (style.highlight.hullFillScale || 1.6) : style.hull.fillOpacity * 0.08;
    }).attr('stroke-opacity', function (e) {
      return connectedEdges.has(e.uid) ? style.hull.strokeOpacity * (style.highlight.hullStrokeScale || 1.15) : style.hull.strokeOpacity * 0.15;
    });
  }
};

BSMHypergraphRenderer.prototype.highlightHyperedge = function (edge) {
  if (!edge || !this._nodeLayer) return;
  if (!this._hullSel) {
    this.clearHighlight();
    return;
  }

  var style = this._getVisualStyle();
  this._selectedHullUid = edge.uid || null;

  var connected = new Set(edge.elements || []);
  var connectedEdges = new Set([edge.uid]);

  this._nodeLayer.selectAll('circle')
    .attr('opacity', function (n) { return connected.has(n.uid) ? 1 : 0.08; })
    .attr('filter', function (n) { return connected.has(n.uid) ? 'url(#glow)' : null; });
  this._labelLayer.selectAll('text')
    .attr('opacity', function (n) { return connected.has(n.uid) ? 1 : 0.1; });
  this._linkLayer.selectAll('line')
    .attr('stroke-opacity', function (l) {
      var sUid = l.source.uid || l.source;
      var tUid = l.target.uid || l.target;
      return connected.has(sUid) && connected.has(tUid)
        ? Math.min(1, style.link.strokeOpacity * (style.highlight.linkActiveScale || 1.25))
        : Math.max(0.01, style.link.strokeOpacity * (style.highlight.linkInactiveScale || 0.1));
    });
  this._hullSel
    .attr('fill-opacity', function (e) {
      return connectedEdges.has(e.uid) ? style.hull.fillOpacity * (style.highlight.hullFillScale || 1.6) : style.hull.fillOpacity * 0.08;
    })
    .attr('stroke-opacity', function (e) {
      return connectedEdges.has(e.uid) ? style.hull.strokeOpacity * (style.highlight.hullStrokeScale || 1.15) : style.hull.strokeOpacity * 0.15;
    });
};

BSMHypergraphRenderer.prototype.clearHighlight = function () {
  if (!this._nodeLayer) return;
  this._selectedHullUid = null;
  this._nodeLayer.selectAll('circle').attr('opacity', 1).attr('filter', null);
  this._labelLayer.selectAll('text').attr('opacity', 1);
  this._linkLayer.selectAll('line').attr('stroke-opacity', this._getVisualStyle().link.strokeOpacity);
  if (this._hullSel) {
    var baseStyle = this._getVisualStyle();
    this._hullSel.attr('fill-opacity', baseStyle.hull.fillOpacity).attr('stroke-opacity', baseStyle.hull.strokeOpacity);
  }
};

BSMHypergraphRenderer.prototype.highlightNodes = function (nodeUids) {
  var set = new Set(nodeUids || []);
  var self = this;
  if (set.size === 0) { this.clearHighlight(); return; }
  this._nodeLayer.selectAll('circle')
    .attr('opacity', function (n) { return set.has(n.uid) ? 1 : 0.12; })
    .attr('filter', function (n) { return set.has(n.uid) ? 'url(#glow)' : null; });
  this._labelLayer.selectAll('text')
    .attr('opacity', function (n) { return set.has(n.uid) ? 1 : 0.05; });
  this._linkLayer.selectAll('line')
    .attr('stroke-opacity', function (l) {
      var style = self._getVisualStyle();
      var active = style.link.strokeOpacity * (style.highlight.linkActiveScale || 1.2);
      var inactive = style.link.strokeOpacity * (style.highlight.linkInactiveScale || 0.1);
      var s = l.source.uid || l.source;
      var t = l.target.uid || l.target;
      return set.has(s) && set.has(t) ? Math.min(1, active) : Math.max(0.01, inactive);
    });
  // Fade hulls that don't contain any highlighted nodes
  if (this._hullSel) {
    var style = this._getVisualStyle();
    this._hullSel.attr('fill-opacity', function (e) {
      for (var i = 0; i < e.elements.length; i++) {
        if (set.has(e.elements[i])) return style.hull.fillOpacity * (style.highlight.hullFillScale || 1.6);
      }
      return style.hull.fillOpacity * 0.08;
    }).attr('stroke-opacity', function (e) {
      for (var i = 0; i < e.elements.length; i++) {
        if (set.has(e.elements[i])) return style.hull.strokeOpacity * (style.highlight.hullStrokeScale || 1.15);
      }
      return style.hull.strokeOpacity * 0.15;
    });
  }
};

// ──────────────────────────────────────────────
//  Search & Filters
// ──────────────────────────────────────────────

BSMHypergraphRenderer.prototype.setSearch = function (term) {
  if (!this._nodeLayer) return;
  var t = (term || '').toLowerCase();
  this._nodeLayer.selectAll('circle')
    .attr('display', function (d) {
      if (!t) return null;
      var name = (d.name || '').toLowerCase();
      return name.indexOf(t) !== -1 ? null : 'none';
    });
  this._labelLayer.selectAll('text')
    .attr('display', function (d) {
      if (!t) return null;
      var name = (d.name || '').toLowerCase();
      return name.indexOf(t) !== -1 ? null : 'none';
    });
  // Hide hulls that don't contain any matching nodes
  if (this._hullSel) {
    var nodeById = this._nodeById;
    this._hullSel.attr('display', function (e) {
      if (!t) return null;
      for (var i = 0; i < e.elements.length; i++) {
        var n = nodeById[e.elements[i]];
        if (n && (n.name || '').toLowerCase().indexOf(t) !== -1) return null;
      }
      return 'none';
    });
  }
};

BSMHypergraphRenderer.prototype.setHullsEnabled = function (enabled) {
  if (this._hullLayer) {
    this._hullLayer.style('display', enabled ? null : 'none');
  }
};

BSMHypergraphRenderer.prototype.toggleType = function (type) {
  if (!this._hiddenTypes) this._hiddenTypes = new Set();
  if (this._hiddenTypes.has(type)) {
    this._hiddenTypes.delete(type);
  } else {
    this._hiddenTypes.add(type);
  }
  var hidden = this._hiddenTypes;
  this._nodeLayer.selectAll('circle')
    .attr('display', function (d) { return hidden.has(d.type) ? 'none' : null; });
  this._labelLayer.selectAll('text')
    .attr('display', function (d) { return hidden.has(d.type) ? 'none' : null; });
};

BSMHypergraphRenderer.prototype.isTypeVisible = function (type) {
  return !this._hiddenTypes || !this._hiddenTypes.has(type);
};

// ──────────────────────────────────────────────
//  Force Controls
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
//  Analytics stubs (API surface for BSMDiscovery)
// ──────────────────────────────────────────────

BSMHypergraphRenderer.prototype.setVizMode = function () {};
BSMHypergraphRenderer.prototype.setCentralityData = function () {};
BSMHypergraphRenderer.prototype.setClusterData = function () {};
BSMHypergraphRenderer.prototype.setRiskData = function () {};
BSMHypergraphRenderer.prototype.setAnomalyNodes = function () {};
BSMHypergraphRenderer.prototype.setCascadeOverlays = function () {};
BSMHypergraphRenderer.prototype.clearAnalyticsOverlays = function () {
  this.clearHighlight();
};

// ──────────────────────────────────────────────
//  Lifecycle
// ──────────────────────────────────────────────

BSMHypergraphRenderer.prototype.resize = function () {
  if (this.currentGraph) this.render(this.currentGraph);
};

BSMHypergraphRenderer.prototype.destroy = function () {
  if (this.simulation) this.simulation.stop();
  d3.select(this.containerSelector).selectAll('*').remove();
};
