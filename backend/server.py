#!/usr/bin/env python3
"""Simple backend for local SN BSM Discovery preview.

Serves static files from a directory (defaults to ./dist) and exposes
a couple of tiny JSON endpoints:
- /api/health
- /api/sample-graph
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from http import HTTPStatus
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

ROOT_DIR = Path(__file__).resolve().parent.parent
SAMPLE_GRAPH_PATH = ROOT_DIR / 'data' / 'sample-graph.json'


class BackendHandler(SimpleHTTPRequestHandler):
    """Tiny static + JSON API handler.

    Keeps things intentionally minimal; this is intentionally not a "real"
    production server, just a predictable local backend.
    """

    def _send_json(self, status, payload):
        body = json.dumps(payload, indent=2).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/health':
            self._send_json(HTTPStatus.OK, {
                'status': 'ok',
                'service': 'sn-itil-bsm-discovery-backend',
                'message': 'alive',
            })
            return

        if parsed.path == '/api/sample-graph':
            if not SAMPLE_GRAPH_PATH.exists():
                self._send_json(HTTPStatus.NOT_FOUND, {
                    'error': 'sample graph missing',
                    'path': str(SAMPLE_GRAPH_PATH)
                })
                return

            with SAMPLE_GRAPH_PATH.open('r', encoding='utf-8') as fp:
                payload = json.load(fp)
            self._send_json(HTTPStatus.OK, payload)
            return

        # Fallback to static file serving
        return super().do_GET()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='Run dead-simple backend server')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', 3000)))
    parser.add_argument('--root', default=os.environ.get('BACKEND_ROOT', 'dist'))
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    root_dir = ROOT_DIR / args.root
    if not root_dir.exists() or not root_dir.is_dir():
        print(f"Error: static root not found: {root_dir}", file=sys.stderr)
        return 1

    os.chdir(root_dir)
    handler_class = BackendHandler

    httpd = HTTPServer((args.host, args.port), handler_class)
    print(f"Backend serving on http://{args.host}:{args.port}")
    print(f"Static root: {root_dir}")
    print("API endpoints:")
    print("  - GET /api/health")
    print("  - GET /api/sample-graph")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        print("Shutting down")
        httpd.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
