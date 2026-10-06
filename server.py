#!/usr/bin/env python3
"""开发服务器：带 no-store 缓存头的静态文件服务（避免改动后浏览器/ServiceWorker 读到旧文件）。
用法：python3 server.py [端口，默认 8642]"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

class Server(socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print(f"serving at http://0.0.0.0:{PORT}")
        httpd.serve_forever()
