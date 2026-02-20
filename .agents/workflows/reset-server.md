---
description: Reset the server by killing port 3000 and starting python3 server.py
---
// turbo-all

1. Kill any process running on port 3000
`kill -9 $(lsof -t -i:3000) || true`

2. Start the server
`python3 server.py`
