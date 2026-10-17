"""Compatibility launcher; never expose repository files with SimpleHTTPRequestHandler."""
import os
from pathlib import Path

if __name__ == '__main__':
    environment = dict(os.environ, HOST='127.0.0.1', PORT='8081')
    os.execvpe('node', ['node', str(Path(__file__).with_name('server.js'))], environment)
