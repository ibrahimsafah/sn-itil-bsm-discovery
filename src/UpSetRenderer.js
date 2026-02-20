/**
 * UpSet Plot Renderer -- D3-based Set Intersection Visualization
 *
 * Renders a HypergraphCore graph as an UpSet plot showing which combinations
 * of CIs (or other entity types) appear together in change requests, how
 * frequently each combination occurs, and superset/subset relationships.
 *
 * The UpSet plot has three visual components:
 *   1. Intersection Size bar chart (top)   -- vertical bars per combination
 *   2. Matrix dot grid (middle)            -- entity membership indicator
 *   3. Set Size bar chart (left)           -- horizontal bars per entity
 *
 * Usage:
 *   var upset = new UpSetRenderer('#graph-container', {
 *     onIntersectionClick: function (intersection) { ... }
 *   });
 *   upset.render(hypergraphData);
 *   upset.destroy();
 *
 * @constructor
 * @param {string} containerSelector - CSS selector for the container div
 * @param {Object} [options]
 * @param {Function} [options.onIntersectionClick] - callback(intersection) on bar click
 */

/* global d3 */

function UpSetRenderer(containerSelector, options) {
  options = options || {};
  this.containerSelector = containerSelector;
  this._onIntersectionClick = options.onIntersectionClick || null;

  this.svg = null;
  this._tooltip = null;
  this._currentGraph = null;
  this._lastRenderOptions = null;

  // Color scheme (light theme)
  this._colors = {
    ci: '#4fc3f7',
    group: '#ffb74d',
    service: '#81c784',
    change: '#ce93d8',
    bar: '#0ea5e9',
    barMuted: 'rgba(14, 165, 233, 0.45)',
    dotEmpty: '#d6deea',
    connector: '#94a3b8',
    text: '#0f172a',
    textSecondary: '#334155',
    textMuted: '#64748b',
    gridLine: '#d1d9e6',
    rowEven: 'rgba(148, 163, 184, 0.08)',
    rowOdd: 'transparent'
  };

  // Layout constants
  this._layout = {
    margin: { top: 20, right: 20, bottom: 10, left: 200 },
    barHeight: 200,
    dotRowHeight: 16,
    dotRadius: 5,
    barWidth: 18,
    gap: 4,
    setSizeBarWidth: 120
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the UpSet plot from a HypergraphCore graph.
 *
 * @param {Object} graph - { nodes, edges, incidence }
 * @param {Object} [options]
 * @param {number} [options.maxIntersections=30] - max combinations to show
 * @param {string|null} [options.filterType='ci'] - only include nodes of this type (null = all)
 * @param {number} [options.minSetSize=1] - minimum intersection size to include
 */
UpSetRenderer.prototype.render = function (graph, options) {
  options = options || {};
  var maxIntersections = options.maxIntersections != null ? options.maxIntersections : 30;
  var filterType = options.filterType !== undefined ? options.filterType : 'ci';
  var minSetSize = options.minSetSize != null ? options.minSetSize : 1;
  var topN = options.topEntities != null ? options.topEntities : 0;

  this._currentGraph = graph;
  this._lastRenderOptions = options;

  // -- 1. Build node lookup ------------------------------------------------
  var nodeById = {};
  var i, j;
  for (i = 0; i < graph.nodes.length; i++) {
    nodeById[graph.nodes[i].uid] = graph.nodes[i];
  }

  // -- 1b. If topEntities is set, find the N most-connected entities -------
  //    This prevents the "all intersections = 1" problem when the entity
  //    space is too large relative to the number of edges.
  var topEntitySet = null;
  if (topN > 0) {
    var degreeList = [];
    for (i = 0; i < graph.nodes.length; i++) {
      var nd = graph.nodes[i];
      if (filterType && nd.type !== filterType) continue;
      var inc = graph.incidence[nd.uid];
      degreeList.push({ uid: nd.uid, deg: inc ? inc.size : 0 });
    }
    degreeList.sort(function (a, b) { return b.deg - a.deg; });
    topEntitySet = {};
    for (i = 0; i < Math.min(topN, degreeList.length); i++) {
      topEntitySet[degreeList[i].uid] = true;
    }
  }

  // -- 2. Build intersection fingerprints ----------------------------------
  var fingerprints = {}; // key -> { members: [uid,...], edges: [edgeObj,...] }
  for (i = 0; i < graph.edges.length; i++) {
    var edge = graph.edges[i];
    var filteredMembers = [];
    for (j = 0; j < edge.elements.length; j++) {
      var uid = edge.elements[j];
      var node = nodeById[uid];
      if (!node) continue;
      if (filterType && node.type !== filterType) continue;
      if (topEntitySet && !topEntitySet[uid]) continue;
      filteredMembers.push(uid);
    }
    if (filteredMembers.length < minSetSize) continue;
    filteredMembers.sort();
    var key = filteredMembers.join('|');
    if (!fingerprints[key]) {
      fingerprints[key] = { members: filteredMembers, edges: [] };
    }
    fingerprints[key].edges.push(edge);
  }

  // -- 3. Count and sort by frequency --------------------------------------
  var fpKeys = Object.keys(fingerprints);
  var intersections = [];
  for (i = 0; i < fpKeys.length; i++) {
    var fp = fingerprints[fpKeys[i]];
    intersections.push({
      members: fp.members,
      count: fp.edges.length,
      edges: fp.edges
    });
  }
  intersections.sort(function (a, b) { return b.count - a.count; });
  intersections = intersections.slice(0, maxIntersections);

  // -- 4. Identify active entities -----------------------------------------
  var activeSet = {};
  for (i = 0; i < intersections.length; i++) {
    for (j = 0; j < intersections[i].members.length; j++) {
      var mUid = intersections[i].members[j];
      if (!activeSet[mUid]) activeSet[mUid] = 0;
      activeSet[mUid] += intersections[i].count;
    }
  }

  // Build entity frequency map (total changes containing this entity)
  var entityFreq = {};
  var entityUids = Object.keys(activeSet);
  for (i = 0; i < entityUids.length; i++) {
    var eUid = entityUids[i];
    var incSet = graph.incidence[eUid];
    entityFreq[eUid] = incSet ? incSet.size : 0;
  }

  // -- 5. Sort entities by total frequency (most frequent at top) ----------
  var entities = [];
  for (i = 0; i < entityUids.length; i++) {
    entities.push({
      uid: entityUids[i],
      node: nodeById[entityUids[i]],
      freq: entityFreq[entityUids[i]]
    });
  }
  entities.sort(function (a, b) { return b.freq - a.freq; });

  // Entity index lookup (uid -> row index)
  var entityIndex = {};
  for (i = 0; i < entities.length; i++) {
    entityIndex[entities[i].uid] = i;
  }

  // -- 6. Render -----------------------------------------------------------
  this._renderSVG(intersections, entities, entityIndex, nodeById);
};

/**
 * Remove the SVG, tooltip, and event listeners.
 */
UpSetRenderer.prototype.destroy = function () {
  if (this._tooltip) {
    this._tooltip.remove();
    this._tooltip = null;
  }
  var container = d3.select(this.containerSelector);
  container.select('svg.upset-svg').remove();
  this.svg = null;
  this._currentGraph = null;
};

/**
 * Re-render with new container dimensions (preserving last data and options).
 */
UpSetRenderer.prototype.resize = function () {
  if (this._currentGraph) {
    this.render(this._currentGraph, this._lastRenderOptions);
  }
};

// ---------------------------------------------------------------------------
// Internal rendering
// ---------------------------------------------------------------------------

/**
 * @private
 */
UpSetRenderer.prototype._renderSVG = function (intersections, entities, entityIndex, nodeById) {
  var self = this;
  var L = this._layout;
  var C = this._colors;

  // Clean up previous render
  var container = d3.select(this.containerSelector);
  container.select('svg.upset-svg').remove();
  if (this._tooltip) this._tooltip.remove();

  // Handle empty data
  if (intersections.length === 0 || entities.length === 0) {
    this._renderEmpty(container);
    return;
  }

  // Compute dimensions
  var numCols = intersections.length;
  var numRows = entities.length;

  var colWidth = L.barWidth + L.gap;
  var matrixWidth = numCols * colWidth;
  var matrixHeight = numRows * L.dotRowHeight;

  var totalWidth = L.margin.left + L.setSizeBarWidth + 10 + matrixWidth + L.margin.right;
  var totalHeight = L.margin.top + L.barHeight + 12 + matrixHeight + L.margin.bottom;

  var containerRect = container.node().getBoundingClientRect();
  var svgWidth = Math.max(totalWidth, containerRect.width || totalWidth);
  var svgHeight = Math.max(totalHeight, containerRect.height || totalHeight);

  // Create SVG
  this.svg = container.append('svg')
    .attr('class', 'upset-svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', '0 0 ' + svgWidth + ' ' + svgHeight)
    .style('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif");

  // Origin for the matrix (top-left of dot grid)
  var matrixX = L.margin.left + L.setSizeBarWidth + 10;
  var matrixY = L.margin.top + L.barHeight + 12;

  // Tooltip
  this._tooltip = container.append('div')
    .attr('class', 'hg-tooltip upset-tooltip')
    .style('opacity', 0);

  // -- Scales --------------------------------------------------------------
  var maxCount = d3.max(intersections, function (d) { return d.count; }) || 1;
  var yBarScale = d3.scaleLinear()
    .domain([0, maxCount])
    .range([L.barHeight, 0]);

  var maxFreq = d3.max(entities, function (d) { return d.freq; }) || 1;
  var xSetScale = d3.scaleLinear()
    .domain([0, maxFreq])
    .range([0, L.setSizeBarWidth]);

  // -- 1. Intersection Size Bar Chart (top) --------------------------------
  var barGroup = this.svg.append('g')
    .attr('class', 'upset-bar-chart')
    .attr('transform', 'translate(' + matrixX + ',' + L.margin.top + ')');

  // Axis label
  barGroup.append('text')
    .attr('x', matrixWidth / 2)
    .attr('y', -6)
    .attr('text-anchor', 'middle')
    .attr('fill', C.textSecondary)
    .attr('font-size', '10px')
    .text('Intersection Size');

  // Y-axis grid lines
  var tickValues = yBarScale.ticks(5);
  for (var t = 0; t < tickValues.length; t++) {
    var yTick = yBarScale(tickValues[t]);
    barGroup.append('line')
      .attr('x1', 0)
      .attr('y1', yTick)
      .attr('x2', matrixWidth)
      .attr('y2', yTick)
      .attr('stroke', C.gridLine)
      .attr('stroke-width', 0.5);
    barGroup.append('text')
      .attr('x', -4)
      .attr('y', yTick + 3)
      .attr('text-anchor', 'end')
      .attr('fill', C.textMuted)
      .attr('font-size', '9px')
      .text(tickValues[t]);
  }

  // Bars
  for (var bi = 0; bi < intersections.length; bi++) {
    var inter = intersections[bi];
    var bx = bi * colWidth + L.gap / 2;
    var barH = L.barHeight - yBarScale(inter.count);

    (function (idx, intersection, xPos) {
      var bar = barGroup.append('rect')
        .attr('x', xPos)
        .attr('y', yBarScale(intersection.count))
        .attr('width', L.barWidth)
        .attr('height', barH)
        .attr('fill', C.bar)
        .attr('opacity', 0.8)
        .attr('rx', 2)
        .style('cursor', 'pointer');

      bar.on('mouseover', function (event) {
        d3.select(this).attr('opacity', 1);
        self._showBarTooltip(event, intersection, nodeById);
        self._highlightColumn(idx, numRows, matrixX, matrixY, colWidth, L.dotRowHeight);
      });
      bar.on('mouseout', function () {
        d3.select(this).attr('opacity', 0.8);
        self._hideTooltip();
        self._clearColumnHighlight();
      });
      bar.on('click', function () {
        if (self._onIntersectionClick) {
          self._onIntersectionClick({
            members: intersection.members,
            count: intersection.count,
            edges: intersection.edges
          });
        }
      });

      // Count label on top
      barGroup.append('text')
        .attr('x', xPos + L.barWidth / 2)
        .attr('y', yBarScale(intersection.count) - 4)
        .attr('text-anchor', 'middle')
        .attr('fill', C.text)
        .attr('font-size', '9px')
        .attr('font-weight', '600')
        .text(intersection.count);
    })(bi, inter, bx);
  }

  // -- 2. Matrix Dots (middle) ---------------------------------------------
  var matrixGroup = this.svg.append('g')
    .attr('class', 'upset-matrix')
    .attr('transform', 'translate(' + matrixX + ',' + matrixY + ')');

  // Alternating row backgrounds
  for (var ri = 0; ri < numRows; ri++) {
    matrixGroup.append('rect')
      .attr('x', -L.setSizeBarWidth - 10)
      .attr('y', ri * L.dotRowHeight)
      .attr('width', matrixWidth + L.setSizeBarWidth + 10)
      .attr('height', L.dotRowHeight)
      .attr('fill', ri % 2 === 0 ? C.rowEven : C.rowOdd);
  }

  // For each column (intersection), draw dots and connectors
  for (var ci = 0; ci < intersections.length; ci++) {
    var colInter = intersections[ci];
    var cx = ci * colWidth + L.gap / 2 + L.barWidth / 2;
    var memberSet = {};
    for (var mi = 0; mi < colInter.members.length; mi++) {
      memberSet[colInter.members[mi]] = true;
    }

    // Find min and max row indices for connector line
    var minRow = numRows;
    var maxRow = -1;
    var activeDots = [];

    for (var ei = 0; ei < entities.length; ei++) {
      var eUid = entities[ei].uid;
      var cy = ei * L.dotRowHeight + L.dotRowHeight / 2;

      if (memberSet[eUid]) {
        // Active dot
        var dotNode = entities[ei].node;
        var dotColor = dotNode ? (C[dotNode.type] || C.bar) : C.bar;

        matrixGroup.append('circle')
          .attr('cx', cx)
          .attr('cy', cy)
          .attr('r', L.dotRadius)
          .attr('fill', dotColor)
          .attr('class', 'upset-dot upset-dot-col-' + ci + ' upset-dot-row-' + ei);

        activeDots.push({ row: ei, cy: cy });
        if (ei < minRow) minRow = ei;
        if (ei > maxRow) maxRow = ei;
      } else {
        // Empty dot
        matrixGroup.append('circle')
          .attr('cx', cx)
          .attr('cy', cy)
          .attr('r', L.dotRadius - 1.5)
          .attr('fill', C.dotEmpty)
          .attr('class', 'upset-dot upset-dot-col-' + ci + ' upset-dot-row-' + ei);
      }
    }

    // Connector line between active dots (multi-entity intersections)
    if (activeDots.length > 1) {
      var lineY1 = activeDots[0].cy;
      var lineY2 = activeDots[activeDots.length - 1].cy;
      matrixGroup.append('line')
        .attr('x1', cx)
        .attr('y1', lineY1)
        .attr('x2', cx)
        .attr('y2', lineY2)
        .attr('stroke', C.connector)
        .attr('stroke-width', 2)
        .attr('class', 'upset-connector upset-connector-col-' + ci);
    }
  }

  // -- 3. Set Size Bar Chart (left) ----------------------------------------
  var setSizeGroup = this.svg.append('g')
    .attr('class', 'upset-set-sizes')
    .attr('transform', 'translate(' + L.margin.left + ',' + matrixY + ')');

  // Axis label
  setSizeGroup.append('text')
    .attr('x', L.setSizeBarWidth / 2)
    .attr('y', -6)
    .attr('text-anchor', 'middle')
    .attr('fill', C.textSecondary)
    .attr('font-size', '10px')
    .text('Set Size');

  for (var si = 0; si < entities.length; si++) {
    var entity = entities[si];
    var barY = si * L.dotRowHeight + 2;
    var barW = xSetScale(entity.freq);
    var setBarHeight = L.dotRowHeight - 4;

    setSizeGroup.append('rect')
      .attr('x', L.setSizeBarWidth - barW)
      .attr('y', barY)
      .attr('width', barW)
      .attr('height', setBarHeight)
      .attr('fill', C.barMuted)
      .attr('rx', 2);

    // Frequency label
    setSizeGroup.append('text')
      .attr('x', L.setSizeBarWidth - barW - 4)
      .attr('y', barY + setBarHeight / 2 + 3)
      .attr('text-anchor', 'end')
      .attr('fill', C.textMuted)
      .attr('font-size', '9px')
      .text(entity.freq);
  }

  // -- 4. Entity Name Labels (left of set size bars) -----------------------
  var labelGroup = this.svg.append('g')
    .attr('class', 'upset-labels')
    .attr('transform', 'translate(' + (L.margin.left - 6) + ',' + matrixY + ')');

  for (var li = 0; li < entities.length; li++) {
    var labelEntity = entities[li];
    var labelNode = labelEntity.node;
    var displayName = labelNode ? (labelNode.name || labelEntity.uid) : labelEntity.uid;

    // Truncate long names
    if (displayName.length > 20) {
      displayName = displayName.substring(0, 18) + '...';
    }

    var labelColor = labelNode ? (C[labelNode.type] || C.textSecondary) : C.textSecondary;

    (function (rowIdx, entityObj) {
      var label = labelGroup.append('text')
        .attr('x', 0)
        .attr('y', rowIdx * L.dotRowHeight + L.dotRowHeight / 2 + 3)
        .attr('text-anchor', 'end')
        .attr('fill', labelColor)
        .attr('font-size', '10px')
        .style('cursor', 'default');

      label.text(displayName);

      label.on('mouseover', function (event) {
        self._highlightRow(rowIdx, numCols, matrixX, matrixY, colWidth, L.dotRowHeight, matrixWidth);
        self._showEntityTooltip(event, entityObj, nodeById);
      });
      label.on('mouseout', function () {
        self._clearRowHighlight();
        self._hideTooltip();
      });
    })(li, labelEntity);
  }
};

// ---------------------------------------------------------------------------
// Tooltip helpers
// ---------------------------------------------------------------------------

/**
 * @private
 */
UpSetRenderer.prototype._showBarTooltip = function (event, intersection, nodeById) {
  var lines = [];
  lines.push('<strong>Intersection (' + intersection.count + ' changes)</strong>');
  for (var i = 0; i < intersection.members.length; i++) {
    var node = nodeById[intersection.members[i]];
    var name = node ? node.name : intersection.members[i];
    var type = node ? node.type : '?';
    lines.push('<span class="hg-tooltip-type">' + type + '</span> ' + name);
  }

  this._tooltip
    .html(lines.join('<br>'))
    .style('left', (event.pageX + 12) + 'px')
    .style('top', (event.pageY - 12) + 'px')
    .transition().duration(150).style('opacity', 1);
};

/**
 * @private
 */
UpSetRenderer.prototype._showEntityTooltip = function (event, entityObj, nodeById) {
  var node = entityObj.node;
  var lines = [];
  lines.push('<strong>' + (node ? node.name : entityObj.uid) + '</strong>');
  if (node) {
    lines.push('<span class="hg-tooltip-type">' + node.type + '</span>');
    if (node.className) lines.push('Class: ' + node.className);
  }
  lines.push('Appears in ' + entityObj.freq + ' changes');

  this._tooltip
    .html(lines.join('<br>'))
    .style('left', (event.pageX + 12) + 'px')
    .style('top', (event.pageY - 12) + 'px')
    .transition().duration(150).style('opacity', 1);
};

/**
 * @private
 */
UpSetRenderer.prototype._hideTooltip = function () {
  if (this._tooltip) {
    this._tooltip.transition().duration(200).style('opacity', 0);
  }
};

// ---------------------------------------------------------------------------
// Highlight helpers
// ---------------------------------------------------------------------------

/**
 * @private -- highlight an entire column (intersection)
 */
UpSetRenderer.prototype._highlightColumn = function (colIdx, numRows, matrixX, matrixY, colWidth, rowHeight) {
  if (!this.svg) return;
  // Remove previous highlight
  this.svg.selectAll('.upset-col-highlight').remove();

  var x = colIdx * colWidth;
  var height = numRows * rowHeight;

  this.svg.select('.upset-matrix').append('rect')
    .attr('class', 'upset-col-highlight')
    .attr('x', x)
    .attr('y', 0)
    .attr('width', colWidth)
    .attr('height', height)
    .attr('fill', 'rgba(14, 165, 233, 0.12)')
    .attr('pointer-events', 'none');
};

/**
 * @private
 */
UpSetRenderer.prototype._clearColumnHighlight = function () {
  if (!this.svg) return;
  this.svg.selectAll('.upset-col-highlight').remove();
};

/**
 * @private -- highlight an entire row (entity)
 */
UpSetRenderer.prototype._highlightRow = function (rowIdx, numCols, matrixX, matrixY, colWidth, rowHeight, matrixWidth) {
  if (!this.svg) return;
  this.svg.selectAll('.upset-row-highlight').remove();

  var y = rowIdx * rowHeight;

  this.svg.select('.upset-matrix').append('rect')
    .attr('class', 'upset-row-highlight')
    .attr('x', 0)
    .attr('y', y)
    .attr('width', matrixWidth)
    .attr('height', rowHeight)
    .attr('fill', 'rgba(14, 165, 233, 0.12)')
    .attr('pointer-events', 'none');
};

/**
 * @private
 */
UpSetRenderer.prototype._clearRowHighlight = function () {
  if (!this.svg) return;
  this.svg.selectAll('.upset-row-highlight').remove();
};

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

/**
 * @private -- render a message when there is nothing to display
 */
UpSetRenderer.prototype._renderEmpty = function (container) {
  var rect = container.node().getBoundingClientRect();
  var w = rect.width || 600;
  var h = rect.height || 400;

  this.svg = container.append('svg')
    .attr('class', 'upset-svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', '0 0 ' + w + ' ' + h)
    .style('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif");

  this.svg.append('text')
    .attr('x', w / 2)
    .attr('y', h / 2)
    .attr('text-anchor', 'middle')
    .attr('fill', this._colors.textMuted)
    .attr('font-size', '14px')
    .text('No intersections to display.');

  this.svg.append('text')
    .attr('x', w / 2)
    .attr('y', h / 2 + 22)
    .attr('text-anchor', 'middle')
    .attr('fill', this._colors.textMuted)
    .attr('font-size', '11px')
    .text('Try adjusting filter type or minimum set size.');
};
