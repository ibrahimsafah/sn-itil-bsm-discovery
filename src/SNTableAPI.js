/**
 * ServiceNow REST Table API Client-Side Wrapper (Read-Only)
 *
 * Usage (in UI Scripts, Client Scripts, or Service Portal widgets):
 *
 *   var api = new SNTableAPI();
 *
 *   // List incidents
 *   api.getRecords('incident', {
 *     query: 'active=true^priority=1',
 *     fields: ['number', 'short_description', 'state'],
 *     limit: 20
 *   }).then(function(result) {
 *     console.log(result.records);
 *     console.log(result.totalCount);
 *   });
 *
 *   // Get a single record
 *   api.getRecord('incident', 'sys_id_here', {
 *     fields: ['number', 'short_description'],
 *     displayValue: 'true'
 *   }).then(function(record) {
 *     console.log(record);
 *   });
 */

function SNTableAPI(options) {
  options = options || {};
  this.baseUrl = options.baseUrl || '/api/now/table';
  this.defaultLimit = options.defaultLimit || 100;
  this.apiVersion = options.apiVersion || null; // e.g. 'v2'
}

/**
 * Build the API URL for a given table and optional sys_id.
 */
SNTableAPI.prototype._buildUrl = function (table, sysId) {
  var url = this.baseUrl + '/' + encodeURIComponent(table);
  if (sysId) {
    url += '/' + encodeURIComponent(sysId);
  }
  return url;
};

/**
 * Build query string parameters from an options object.
 *
 * @param {Object} opts
 * @param {string}   opts.query          - Encoded query string (e.g. 'active=true^priority=1')
 * @param {string[]} opts.fields         - Array of field names to return
 * @param {number}   opts.limit          - Max records to return
 * @param {number}   opts.offset         - Starting record index for pagination
 * @param {string}   opts.displayValue   - 'true', 'false', or 'all'
 * @param {string}   opts.orderBy        - Field to order by (prefix with '-' for descending)
 * @param {boolean}  opts.excludeRefLink - Exclude reference link URLs from response
 * @param {boolean}  opts.suppressCount  - Suppress row count header (improves performance)
 * @param {string}   opts.view           - UI view to determine fields returned
 * @param {string}   opts.category       - Category of columns to return
 * @returns {string}
 */
SNTableAPI.prototype._buildParams = function (opts) {
  opts = opts || {};
  var params = [];

  if (opts.query) {
    params.push('sysparm_query=' + encodeURIComponent(opts.query));
  }
  if (opts.fields && opts.fields.length) {
    params.push('sysparm_fields=' + encodeURIComponent(opts.fields.join(',')));
  }
  if (opts.limit != null) {
    params.push('sysparm_limit=' + opts.limit);
  } else {
    params.push('sysparm_limit=' + this.defaultLimit);
  }
  if (opts.offset != null) {
    params.push('sysparm_offset=' + opts.offset);
  }
  if (opts.displayValue) {
    params.push('sysparm_display_value=' + encodeURIComponent(opts.displayValue));
  }
  if (opts.orderBy) {
    if (opts.orderBy.charAt(0) === '-') {
      params.push('sysparm_orderby=' + encodeURIComponent(opts.orderBy.substring(1)) + '&sysparm_orderbydesc=true');
    } else {
      params.push('sysparm_orderby=' + encodeURIComponent(opts.orderBy));
    }
  }
  if (opts.excludeRefLink) {
    params.push('sysparm_exclude_reference_link=true');
  }
  if (opts.suppressCount) {
    params.push('sysparm_suppress_pagination_header=true');
  }
  if (opts.view) {
    params.push('sysparm_view=' + encodeURIComponent(opts.view));
  }
  if (opts.category) {
    params.push('sysparm_query_category=' + encodeURIComponent(opts.category));
  }

  return params.length ? '?' + params.join('&') : '';
};

/**
 * Execute a GET request to the Table API.
 *
 * @param {string} url - Full API URL with query parameters
 * @returns {Promise<{status: number, headers: Object, body: Object}>}
 */
SNTableAPI.prototype._request = function (url) {
  var headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (this.apiVersion) {
    headers['X-ServiceNow-API-Version'] = this.apiVersion;
  }

  // Fetch the CSRF token if available (g_ck is set by ServiceNow on the client)
  if (typeof g_ck !== 'undefined') {
    headers['X-UserToken'] = g_ck;
  }

  return fetch(url, {
    method: 'GET',
    headers: headers,
    credentials: 'same-origin',
  }).then(function (response) {
    if (!response.ok) {
      return response.json().then(
        function (errorBody) {
          var msg =
            (errorBody.error && errorBody.error.message) ||
            'HTTP ' + response.status;
          var err = new Error(msg);
          err.status = response.status;
          err.detail = errorBody.error && errorBody.error.detail;
          throw err;
        },
        function () {
          var err = new Error('HTTP ' + response.status);
          err.status = response.status;
          throw err;
        }
      );
    }

    var totalCount = response.headers.get('X-Total-Count');

    return response.json().then(function (body) {
      return {
        status: response.status,
        totalCount: totalCount ? parseInt(totalCount, 10) : null,
        body: body,
      };
    });
  });
};

/**
 * Retrieve multiple records from a table.
 *
 * @param {string} table - Table name (e.g. 'incident', 'cmdb_ci')
 * @param {Object} [opts] - Query options (see _buildParams)
 * @returns {Promise<{records: Object[], totalCount: number|null}>}
 */
SNTableAPI.prototype.getRecords = function (table, opts) {
  var url = this._buildUrl(table) + this._buildParams(opts);

  return this._request(url).then(function (res) {
    return {
      records: res.body.result || [],
      totalCount: res.totalCount,
    };
  });
};

/**
 * Retrieve a single record by sys_id.
 *
 * @param {string} table - Table name
 * @param {string} sysId - Record sys_id
 * @param {Object} [opts] - Query options (fields, displayValue, etc.)
 * @returns {Promise<Object>} - The record object
 */
SNTableAPI.prototype.getRecord = function (table, sysId, opts) {
  var url = this._buildUrl(table, sysId) + this._buildParams(opts);

  return this._request(url).then(function (res) {
    return res.body.result || null;
  });
};

/**
 * Paginate through all records matching a query.
 * Calls the callback with each page of results.
 *
 * @param {string} table - Table name
 * @param {Object} opts - Query options
 * @param {Function} onPage - Callback: function(records, pageInfo) where
 *   pageInfo = { page, offset, totalCount, hasMore }
 *   Return false from the callback to stop pagination early.
 * @returns {Promise<void>}
 */
SNTableAPI.prototype.paginate = function (table, opts, onPage) {
  opts = Object.assign({}, opts);
  var limit = opts.limit || this.defaultLimit;
  opts.limit = limit;
  var offset = opts.offset || 0;
  var page = 0;
  var self = this;

  function nextPage() {
    opts.offset = offset;

    return self.getRecords(table, opts).then(function (result) {
      page++;
      var hasMore =
        result.records.length === limit &&
        (result.totalCount == null || offset + limit < result.totalCount);

      var shouldContinue = onPage(result.records, {
        page: page,
        offset: offset,
        totalCount: result.totalCount,
        hasMore: hasMore,
      });

      if (shouldContinue !== false && hasMore) {
        offset += limit;
        return nextPage();
      }
    });
  }

  return nextPage();
};

/**
 * Get the count of records matching a query (without fetching record data).
 *
 * @param {string} table - Table name
 * @param {string} [query] - Encoded query string
 * @returns {Promise<number>}
 */
SNTableAPI.prototype.getCount = function (table, query) {
  return this.getRecords(table, {
    query: query,
    limit: 1,
    fields: ['sys_id'],
  }).then(function (result) {
    return result.totalCount || 0;
  });
};
