import http.server
import socketserver
import os

class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', 'http://localhost:8080')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        super().end_headers()

if __name__ == '__main__':
    port = 8081
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    # Fix 5 & 19: Bind explicitly to 127.0.0.1 (Localhost Only)
    with socketserver.TCPServer(("127.0.0.1", port), NoCacheHTTPRequestHandler) as httpd:
        print(f"Serving Staff Hub securely at http://localhost:{port}")
        httpd.serve_forever()
