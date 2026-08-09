#!/usr/bin/env python3
"""Serve the local/ bench pages with COOP/COEP headers so ORT-web can use
multi-threaded wasm (≈4x faster inference than the single-thread fallback).

Run:  python3 serve_bench.py            (port 8935, serves this directory)

Phone access (getUserMedia needs a secure context — two easy options):
  A) adb reverse tcp:8935 tcp:8935   → open http://localhost:8935/dealbench.html
     on the phone (localhost is always a secure context).
  B) chrome://flags/#unsafely-treat-insecure-origin-as-secure on the phone,
     add http://<mac-lan-ip>:8935, relaunch Chrome, open that URL.
"""
import http.server, functools, os

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))
http.server.ThreadingHTTPServer(("", 8935), H).serve_forever()
