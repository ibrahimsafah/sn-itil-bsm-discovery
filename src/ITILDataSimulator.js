/**
 * ITIL Data Simulator
 *
 * Generates realistic simulated ServiceNow ITIL data for BSM discovery:
 *   - Change requests with assignment groups, business services, and CIs
 *   - Configuration items across multiple CMDB classes
 *   - Support groups and business services with natural clustering
 *   - Incidents with cascading failure modeling and CI clustering
 *
 * Usage:
 *   var sim = new ITILDataSimulator({ changeCount: 50, incidentCount: 30 });
 *   var data = sim.generate();
 *   // data.changes   — map of CHG number -> change record
 *   // data.entities  — map of entity uid -> entity descriptor
 *   // data.incidents — map of INC number -> incident record
 */

function ITILDataSimulator(options) {
  options = options || {};
  this.changeCount = options.changeCount || 50;
  this.incidentCount = options.incidentCount || 30;
  this.seed = options.seed || 42;
  this._rng = this._createRng(this.seed);
  this.baseDate = new Date('2025-01-15T00:00:00Z');
}

// ---------- Deterministic PRNG (mulberry32) ----------

ITILDataSimulator.prototype._createRng = function (seed) {
  var s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

ITILDataSimulator.prototype._pick = function (arr) {
  return arr[Math.floor(this._rng() * arr.length)];
};

ITILDataSimulator.prototype._pickN = function (arr, min, max) {
  var count = min + Math.floor(this._rng() * (max - min + 1));
  var copy = arr.slice();
  var result = [];
  for (var i = 0; i < count && copy.length > 0; i++) {
    var idx = Math.floor(this._rng() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
};

ITILDataSimulator.prototype._uuid = function () {
  var hex = '0123456789abcdef';
  var s = '';
  for (var i = 0; i < 32; i++) {
    s += hex[Math.floor(this._rng() * 16)];
    if (i === 7 || i === 11 || i === 15 || i === 19) s += '-';
  }
  return s;
};

/**
 * Generate a random date within a range using the deterministic PRNG.
 * @param {Date} start - Start of the range (inclusive)
 * @param {Date} end   - End of the range (exclusive)
 * @returns {Date}
 */
ITILDataSimulator.prototype._randomDate = function (start, end) {
  var startMs = start.getTime();
  var endMs = end.getTime();
  var randomMs = startMs + Math.floor(this._rng() * (endMs - startMs));
  return new Date(randomMs);
};

// ---------- Reference Data ----------

ITILDataSimulator.GROUPS = [
  { name: 'Network Operations',    focus: ['network_gear'] },
  { name: 'Linux Engineering',     focus: ['linux_server'] },
  { name: 'Windows Engineering',   focus: ['windows_server'] },
  { name: 'Storage Admin',         focus: ['storage'] },
  { name: 'Application Support',   focus: ['application'] },
  { name: 'Database Admin',        focus: ['linux_server', 'windows_server'] },
  { name: 'Cloud Infrastructure',  focus: ['linux_server', 'application'] },
  { name: 'Service Desk',          focus: ['application', 'windows_server'] }
];

ITILDataSimulator.SERVICES = [
  { name: 'Email Service',           ciClasses: ['linux_server', 'application', 'network_gear'] },
  { name: 'ERP Platform',            ciClasses: ['linux_server', 'windows_server', 'storage', 'application'] },
  { name: 'Customer Portal',         ciClasses: ['linux_server', 'application', 'network_gear'] },
  { name: 'HR Management System',    ciClasses: ['windows_server', 'application', 'storage'] },
  { name: 'Data Analytics Platform', ciClasses: ['linux_server', 'storage', 'application'] },
  { name: 'Corporate Network',       ciClasses: ['network_gear', 'linux_server'] }
];

ITILDataSimulator.CI_TEMPLATES = {
  linux_server: {
    names: ['web-lnx', 'app-lnx', 'db-lnx', 'api-lnx', 'batch-lnx', 'cache-lnx', 'mq-lnx', 'etl-lnx', 'log-lnx', 'mon-lnx',
            'proxy-lnx', 'auth-lnx', 'search-lnx', 'report-lnx', 'vault-lnx', 'ci-lnx'],
    osOptions: ['RHEL 8.6', 'RHEL 9.1', 'Ubuntu 22.04', 'CentOS 7.9'],
    models: ['Dell PowerEdge R640', 'Dell PowerEdge R740', 'HP ProLiant DL380 Gen10', 'VMware vSphere VM']
  },
  windows_server: {
    names: ['dc-win', 'file-win', 'print-win', 'app-win', 'sql-win', 'iis-win', 'exchange-win', 'sccm-win', 'rds-win', 'wsus-win',
            'ad-win', 'dns-win'],
    osOptions: ['Windows Server 2019', 'Windows Server 2022'],
    models: ['Dell PowerEdge R640', 'HP ProLiant DL360 Gen10', 'VMware vSphere VM']
  },
  network_gear: {
    names: ['core-sw', 'dist-sw', 'access-sw', 'fw', 'lb', 'router', 'vpn-gw', 'wlan-ctrl', 'edge-sw', 'mgmt-sw'],
    osOptions: ['IOS-XE 17.6', 'NX-OS 10.2', 'FortiOS 7.2', 'PAN-OS 11.0'],
    models: ['Cisco Catalyst 9300', 'Cisco Nexus 9000', 'Fortinet FortiGate 600E', 'Palo Alto PA-5250', 'F5 BIG-IP i5800']
  },
  storage: {
    names: ['san', 'nas', 'backup-store', 'archive', 'object-store', 'block-store'],
    osOptions: ['ONTAP 9.12', 'PowerStore OS 3.0', 'Veeam B&R 12'],
    models: ['NetApp FAS8700', 'Dell PowerStore 500T', 'Pure Storage FlashArray//X70', 'HPE Nimble HF40']
  },
  application: {
    names: ['erp-app', 'crm-app', 'portal-app', 'bi-app', 'hrms-app', 'email-app', 'collab-app', 'workflow-app',
            'analytics-app', 'payment-app', 'inventory-app', 'ticketing-app'],
    osOptions: ['Java 17 / Tomcat 10', 'Node.js 20 LTS', '.NET 8', 'Python 3.11 / Django 5'],
    models: ['Kubernetes Pod', 'Docker Container', 'Azure App Service', 'AWS ECS Task']
  }
};

ITILDataSimulator.REGIONS = ['US-East', 'US-West', 'EU-West', 'EU-Central', 'APAC'];
ITILDataSimulator.RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
ITILDataSimulator.CHANGE_MODELS = ['Standard', 'Normal', 'Emergency'];

/**
 * Maps CI class names to change categories.
 * When a change touches multiple CI classes, the first matching category wins.
 */
ITILDataSimulator.CLASS_TO_CATEGORY = {
  network_gear: 'Network',
  storage: 'Hardware',
  linux_server: 'Maintenance',
  windows_server: 'Software',
  application: 'Software'
};

/**
 * Category priority order for selecting a single category when multiple CI
 * classes are present in a change. Lower index = higher priority.
 */
ITILDataSimulator.CATEGORY_PRIORITY = ['Security', 'Network', 'Hardware', 'Software', 'Maintenance'];

// ---------- Generation ----------

ITILDataSimulator.prototype.generate = function () {
  var groups = this._generateGroups();
  var services = this._generateServices();
  var cis = this._generateCIs();
  var changes = this._generateChanges(groups, services, cis);
  var incidents = this._generateIncidents(groups, services, cis, changes);

  // Build entity map (keyed by uid)
  var entities = {};
  var i;
  for (i = 0; i < groups.length; i++) {
    var g = groups[i];
    entities['group:' + g.id] = { type: 'group', id: g.id, name: g.name, focus: g.focus };
  }
  for (i = 0; i < services.length; i++) {
    var s = services[i];
    entities['service:' + s.id] = { type: 'service', id: s.id, name: s.name, ciClasses: s.ciClasses };
  }
  for (i = 0; i < cis.length; i++) {
    var c = cis[i];
    entities['ci:' + c.id] = { type: 'ci', id: c.id, name: c.name, className: c.className, ipAddress: c.ipAddress, role: c.role, os: c.os, model: c.model };
  }

  return { changes: changes, entities: entities, incidents: incidents };
};

ITILDataSimulator.prototype._generateGroups = function () {
  var result = [];
  for (var i = 0; i < ITILDataSimulator.GROUPS.length; i++) {
    var g = ITILDataSimulator.GROUPS[i];
    result.push({ id: this._uuid(), name: g.name, focus: g.focus });
  }
  return result;
};

ITILDataSimulator.prototype._generateServices = function () {
  var result = [];
  for (var i = 0; i < ITILDataSimulator.SERVICES.length; i++) {
    var s = ITILDataSimulator.SERVICES[i];
    result.push({ id: this._uuid(), name: s.name, ciClasses: s.ciClasses });
  }
  return result;
};

ITILDataSimulator.prototype._generateCIs = function () {
  var cis = [];
  var classes = Object.keys(ITILDataSimulator.CI_TEMPLATES);
  var ipCounter = 1;

  for (var c = 0; c < classes.length; c++) {
    var cls = classes[c];
    var tpl = ITILDataSimulator.CI_TEMPLATES[cls];
    for (var n = 0; n < tpl.names.length; n++) {
      var baseName = tpl.names[n];
      var suffix = String(Math.floor(this._rng() * 90) + 10);
      var octet3 = 10 + c;
      var ip = '10.' + octet3 + '.' + Math.floor(ipCounter / 255) + '.' + (ipCounter % 255);
      ipCounter++;
      cis.push({
        id: this._uuid(),
        name: baseName + '-' + suffix,
        className: cls,
        ipAddress: ip,
        role: baseName.split('-')[0],
        os: this._pick(tpl.osOptions),
        model: this._pick(tpl.models)
      });
    }
  }
  return cis;
};

/**
 * Determine the change category based on the CI classes involved.
 * Uses a priority system: Security and Network take precedence over
 * Hardware, Software, and Maintenance. Emergency changes to network_gear
 * are categorized as Security.
 */
ITILDataSimulator.prototype._determineCategory = function (ciClassNames, changeModel) {
  var candidateCategories = {};
  var i, cls, cat;

  for (i = 0; i < ciClassNames.length; i++) {
    cls = ciClassNames[i];
    cat = ITILDataSimulator.CLASS_TO_CATEGORY[cls];
    if (cat) {
      candidateCategories[cat] = true;
    }
  }

  // Emergency changes involving network gear are categorized as Security
  if (changeModel === 'Emergency' && candidateCategories['Network']) {
    return 'Security';
  }

  // Return highest-priority category found
  var priorities = ITILDataSimulator.CATEGORY_PRIORITY;
  for (i = 0; i < priorities.length; i++) {
    if (candidateCategories[priorities[i]]) {
      return priorities[i];
    }
  }

  return 'Maintenance';
};

ITILDataSimulator.prototype._generateChanges = function (groups, services, cis) {
  var changes = {};
  var cisByClass = {};
  var i, ci;
  var self = this;

  var windowEnd = new Date(this.baseDate.getTime() + 90 * 24 * 60 * 60 * 1000);

  for (i = 0; i < cis.length; i++) {
    ci = cis[i];
    if (!cisByClass[ci.className]) cisByClass[ci.className] = [];
    cisByClass[ci.className].push(ci);
  }

  for (i = 0; i < this.changeCount; i++) {
    var number = 'CHG' + String(i + 1).padStart(4, '0');
    var service = this._pick(services);
    // Prefer groups whose focus overlaps with the service's CI classes
    var compatibleGroups = groups.filter(function (g) {
      return g.focus.some(function (f) { return service.ciClasses.indexOf(f) !== -1; });
    });
    var group = compatibleGroups.length > 0 ? this._pick(compatibleGroups) : this._pick(groups);

    // Pick CIs: prefer classes that match the service
    var candidateCIs = [];
    for (var c = 0; c < service.ciClasses.length; c++) {
      var classPool = cisByClass[service.ciClasses[c]];
      if (classPool) candidateCIs = candidateCIs.concat(classPool);
    }
    if (candidateCIs.length === 0) candidateCIs = cis;
    var selectedCIs = this._pickN(candidateCIs, 1, 5);

    // Timestamps
    var createdAt = this._randomDate(self.baseDate, windowEnd);
    var closeDaysMs = (1 + Math.floor(this._rng() * 14)) * 24 * 60 * 60 * 1000;
    var closedAt = new Date(createdAt.getTime() + closeDaysMs);

    // Change model
    var model = this._pick(ITILDataSimulator.CHANGE_MODELS);

    // Determine category from CI classes involved
    var involvedClasses = [];
    for (var k = 0; k < selectedCIs.length; k++) {
      if (involvedClasses.indexOf(selectedCIs[k].className) === -1) {
        involvedClasses.push(selectedCIs[k].className);
      }
    }
    var category = this._determineCategory(involvedClasses, model);

    changes[number] = {
      number: number,
      region: this._pick(ITILDataSimulator.REGIONS),
      risk: this._pick(ITILDataSimulator.RISK_LEVELS),
      model: model,
      category: category,
      assignmentGroup: { id: group.id, name: group.name },
      businessService: { id: service.id, name: service.name },
      createdAt: createdAt.toISOString(),
      closedAt: closedAt.toISOString(),
      cis: selectedCIs.map(function (ci) {
        return { id: ci.id, name: ci.name, className: ci.className, ipAddress: ci.ipAddress, role: ci.role, os: ci.os, model: ci.model };
      })
    };
  }

  return changes;
};

/**
 * Generate incident records with realistic clustering and cascading behavior.
 *
 * - Some CIs are marked as "problematic" and attract more incidents.
 * - When a problematic CI gets an incident, related CIs (those that share
 *   changes) have a ~40% chance of receiving a cascading incident 1-4 hours later.
 * - Priority affects resolution time: P1 = 1-6h, P2 = 2-12h, P3 = 4-24h, P4 = 8-48h.
 */
ITILDataSimulator.prototype._generateIncidents = function (groups, services, cis, changes) {
  var incidents = {};
  var self = this;
  var windowEnd = new Date(this.baseDate.getTime() + 90 * 24 * 60 * 60 * 1000);

  // Build a map of CI id -> list of other CI ids that share at least one change
  var ciNeighbors = {};
  var changeKeys = Object.keys(changes);
  var i, j, chg, ciId;

  for (i = 0; i < changeKeys.length; i++) {
    chg = changes[changeKeys[i]];
    var chgCiIds = [];
    for (j = 0; j < chg.cis.length; j++) {
      chgCiIds.push(chg.cis[j].id);
    }
    // Every pair of CIs in this change are neighbors
    for (j = 0; j < chgCiIds.length; j++) {
      if (!ciNeighbors[chgCiIds[j]]) ciNeighbors[chgCiIds[j]] = {};
      for (var k = 0; k < chgCiIds.length; k++) {
        if (j !== k) {
          ciNeighbors[chgCiIds[j]][chgCiIds[k]] = true;
        }
      }
    }
  }

  // Build a lookup from CI id to CI object
  var ciById = {};
  for (i = 0; i < cis.length; i++) {
    ciById[cis[i].id] = cis[i];
  }

  // Select ~20% of CIs as "problematic" — they will attract more incidents
  var problematicCount = Math.max(3, Math.floor(cis.length * 0.2));
  var problematicCIs = this._pickN(cis, problematicCount, problematicCount);
  var problematicIds = {};
  for (i = 0; i < problematicCIs.length; i++) {
    problematicIds[problematicCIs[i].id] = true;
  }

  // Build a weighted CI pool: problematic CIs appear 4x more often
  var weightedCIPool = [];
  for (i = 0; i < cis.length; i++) {
    weightedCIPool.push(cis[i]);
    if (problematicIds[cis[i].id]) {
      weightedCIPool.push(cis[i]);
      weightedCIPool.push(cis[i]);
      weightedCIPool.push(cis[i]);
    }
  }

  // Find services that a CI belongs to (via changes)
  var ciToServices = {};
  for (i = 0; i < changeKeys.length; i++) {
    chg = changes[changeKeys[i]];
    for (j = 0; j < chg.cis.length; j++) {
      ciId = chg.cis[j].id;
      if (!ciToServices[ciId]) ciToServices[ciId] = {};
      ciToServices[ciId][chg.businessService.id] = chg.businessService;
    }
  }

  // Resolution time ranges by priority (in hours): [min, max]
  var resolutionRanges = {
    1: [1, 6],
    2: [2, 12],
    3: [4, 24],
    4: [8, 48]
  };

  var incidentNumber = 0;
  var pendingIncidents = []; // queue of incidents to create (including cascading)

  // Seed the queue with primary incidents
  var primaryCount = this.incidentCount;
  for (i = 0; i < primaryCount; i++) {
    var affectedCI = this._pick(weightedCIPool);
    var priority = this._rng() < 0.15 ? 1 : (this._rng() < 0.3 ? 2 : (this._rng() < 0.6 ? 3 : 4));
    var createdAt = this._randomDate(self.baseDate, windowEnd);

    pendingIncidents.push({
      affectedCI: affectedCI,
      priority: priority,
      createdAt: createdAt,
      isCascade: false
    });
  }

  // Process the queue: for each incident, potentially spawn cascading incidents
  var allIncidentNumbers = [];
  var processedCount = 0;

  while (processedCount < pendingIncidents.length) {
    var pending = pendingIncidents[processedCount];
    processedCount++;

    incidentNumber++;
    var incNum = 'INC' + String(incidentNumber).padStart(4, '0');
    allIncidentNumbers.push(incNum);

    var ci = pending.affectedCI;
    var prio = pending.priority;
    var created = pending.createdAt;

    // Resolution time based on priority
    var range = resolutionRanges[prio];
    var resolveHours = range[0] + Math.floor(this._rng() * (range[1] - range[0] + 1));
    var resolvedAt = new Date(created.getTime() + resolveHours * 60 * 60 * 1000);

    // Find a business service for this CI
    var serviceRef;
    if (ciToServices[ci.id]) {
      var serviceKeys = Object.keys(ciToServices[ci.id]);
      var svcKey = serviceKeys[Math.floor(this._rng() * serviceKeys.length)];
      var svc = ciToServices[ci.id][svcKey];
      serviceRef = { id: svc.id, name: svc.name };
    } else {
      // Fallback: pick a random service
      var fallbackSvc = this._pick(services);
      serviceRef = { id: fallbackSvc.id, name: fallbackSvc.name };
    }

    // Pick an assignment group whose focus matches the CI class
    var matchingGroups = groups.filter(function (g) {
      return g.focus.indexOf(ci.className) !== -1;
    });
    var assignedGroup = matchingGroups.length > 0 ? this._pick(matchingGroups) : this._pick(groups);

    incidents[incNum] = {
      number: incNum,
      priority: prio,
      affectedCI: { id: ci.id, name: ci.name },
      businessService: serviceRef,
      createdAt: created.toISOString(),
      resolvedAt: resolvedAt.toISOString(),
      relatedIncidents: [],
      assignmentGroup: { id: assignedGroup.id, name: assignedGroup.name }
    };

    // Cascading failure: ~40% chance for each neighbor CI (only from non-cascade incidents
    // and only if we haven't exceeded a reasonable total)
    if (!pending.isCascade && ciNeighbors[ci.id] && pendingIncidents.length < primaryCount * 3) {
      var neighborIds = Object.keys(ciNeighbors[ci.id]);
      for (j = 0; j < neighborIds.length; j++) {
        if (this._rng() < 0.4) {
          var neighborCI = ciById[neighborIds[j]];
          if (!neighborCI) continue;

          // Cascading incident occurs 1-4 hours after the original
          var cascadeDelayHours = 1 + Math.floor(this._rng() * 4);
          var cascadeCreated = new Date(created.getTime() + cascadeDelayHours * 60 * 60 * 1000);

          // Cascading incidents tend to be same priority or one level lower
          var cascadePrio = prio;
          if (this._rng() < 0.4 && cascadePrio < 4) {
            cascadePrio = cascadePrio + 1;
          }

          pendingIncidents.push({
            affectedCI: neighborCI,
            priority: cascadePrio,
            createdAt: cascadeCreated,
            isCascade: true,
            parentIncNum: incNum
          });
        }
      }
    }
  }

  // Wire up relatedIncidents: cascading incidents reference their parent,
  // and parents reference their cascades
  for (i = 0; i < pendingIncidents.length; i++) {
    if (pendingIncidents[i].isCascade && pendingIncidents[i].parentIncNum) {
      // The cascade incident number is i+1 (1-indexed)
      var cascadeNum = 'INC' + String(i + 1).padStart(4, '0');
      var parentNum = pendingIncidents[i].parentIncNum;

      if (incidents[cascadeNum] && incidents[parentNum]) {
        // Add parent to cascade's relatedIncidents (max 2)
        if (incidents[cascadeNum].relatedIncidents.length < 2) {
          incidents[cascadeNum].relatedIncidents.push(parentNum);
        }
        // Add cascade to parent's relatedIncidents (max 2)
        if (incidents[parentNum].relatedIncidents.length < 2) {
          incidents[parentNum].relatedIncidents.push(cascadeNum);
        }
      }
    }
  }

  return incidents;
};
