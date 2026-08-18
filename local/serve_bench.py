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
import http.server, functools, os, re

class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        """POST /__ev  -> runs/dealglimpse/events_<clip>.json

        The replay harvester needs the page's event list on disk. A browser
        download lands in the user's Downloads folder (and headless it lands
        nowhere), so the page POSTs it here instead and it is written straight
        beside the clips where replay_harvest.py expects it.
        """
        if self.path != "/__ev":
            return self.send_error(404)
        import json as _json
        n = int(self.headers.get("Content-Length") or 0)
        try:
            data = _json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            return self.send_error(400, str(e))
        clip = (data.get("clip") or "clip").rsplit(".", 1)[0]
        dest = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "..", "Magic Pipeline", "magic_pipeline",
                            "stack_reader", "runs", "dealglimpse")
        dest = os.path.normpath(dest)
        if not os.path.isdir(dest):
            dest = os.path.dirname(os.path.abspath(__file__))
        out = os.path.join(dest, f"events_{clip}.json")
        with open(out, "w") as fh:
            _json.dump(data, fh)
        body = out.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    """SimpleHTTPRequestHandler + HTTP Range support.

    Range matters: python's stock handler ignores the Range header and always
    returns 200 with the whole file. Chrome's media pipeline cannot seek a
    <video> without ranges — it reports the seek as complete and silently
    keeps rendering frame 0 forever. That made dealbench's ?replay= mode look
    like it ran (scans counted, score rendered) while every frame it "read"
    was the first one: 0 events from 52 clean passes, on any clip, since the
    day replay was added. Found 2026-08-12.
    """
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not (rng and os.path.isfile(path)):
            return super().send_head()
        m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
        size = os.path.getsize(path)
        if not m or (not m.group(1) and not m.group(2)):
            return super().send_head()
        start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2)))
        end = min(int(m.group(2)), size - 1) if (m.group(1) and m.group(2)) else size - 1
        if start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        # cap what copyfile can read so we honour the range end
        data = f.read(end - start + 1)
        f.close()
        import io
        return io.BytesIO(data)

os.chdir(os.path.dirname(os.path.abspath(__file__)))
http.server.ThreadingHTTPServer(("", 8935), H).serve_forever()
