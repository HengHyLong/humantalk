#!/usr/bin/env python3
"""Small project-owned reverse proxy for Vidu Live.

The original proof-of-concept lived in a sibling ``vidu`` directory. Keeping
the proxy here makes the OpenTalking deployment self-contained. Provider keys
are supplied by the API server per request and are never embedded in this
process, its command line, or the browser bundle.
"""

from __future__ import annotations

import argparse
import http.client
import json
import select
import socket
import ssl
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ENV_BASES = {
    "cn": "https://api.vidu.cn",
    "ovs": "https://api.vidu.com",
}

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


class ViduProxyHandler(BaseHTTPRequestHandler):
    """HTTP and WebSocket reverse proxy restricted to known Vidu hosts."""

    verbose = False

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/", "/index.html", "/health"}:
            self._health()
            return
        if self.path.startswith("/proxy/"):
            if self.headers.get("Upgrade", "").lower() == "websocket":
                self._proxy_websocket()
            else:
                self._proxy_http()
            return
        self.send_error(404)

    def do_POST(self) -> None:  # noqa: N802
        self._proxy_http()

    def do_PUT(self) -> None:  # noqa: N802
        self._proxy_http()

    def do_PATCH(self) -> None:  # noqa: N802
        self._proxy_http()

    def do_DELETE(self) -> None:  # noqa: N802
        self._proxy_http()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._proxy_http()

    def log_message(self, fmt: str, *args: object) -> None:
        if self.verbose or not self.path.startswith("/proxy/"):
            super().log_message(fmt, *args)

    def _health(self) -> None:
        body = json.dumps({"status": "ok", "service": "opentalking-vidu-proxy"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _route(self) -> tuple[urllib.parse.SplitResult, str, str] | None:
        parsed = urllib.parse.urlsplit(self.path)
        rest = parsed.path.removeprefix("/proxy/")
        environment, separator, upstream_rest = rest.partition("/")
        base = ENV_BASES.get(environment)
        if not separator or not upstream_rest or not base:
            self.send_error(400, "usage: /proxy/{cn|ovs}/live/...")
            return None
        return urllib.parse.urlsplit(base), "/" + upstream_rest, parsed.query

    def _proxy_http(self) -> None:
        route = self._route()
        if route is None:
            return
        target, upstream_path, query = route
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = self._http_headers(target, query)
        uri = self._join_query(upstream_path, self._query_without_auth(query, headers.get("Authorization")))
        connection_class = http.client.HTTPSConnection if target.scheme == "https" else http.client.HTTPConnection
        connection = connection_class(target.hostname, target.port or self._default_port(target), timeout=60)
        try:
            connection.request(self.command, uri, body=body, headers=headers)
            response = connection.getresponse()
            response_body = response.read()
        except Exception:  # noqa: BLE001
            self.send_error(502, "Vidu upstream unavailable")
            return
        finally:
            connection.close()
        self.send_response(response.status, response.reason)
        for key, value in response.getheaders():
            if key.lower() not in HOP_BY_HOP_HEADERS | {"content-length"}:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def _proxy_websocket(self) -> None:
        route = self._route()
        if route is None:
            return
        target, upstream_path, query = route
        query_values = urllib.parse.parse_qs(query)
        auth = self._normalize_auth(
            self.headers.get("Authorization"),
            query_values.get("authorization", [""])[0],
        )
        uri = self._join_query(upstream_path, self._query_without_auth(query, auth))
        upstream: socket.socket | None = None
        upgraded = False
        try:
            upstream = self._dial(target)
            upstream.sendall(self._websocket_handshake(target, uri, auth))
            response = self._read_websocket_handshake(upstream)
            self.connection.sendall(response)
            if not response.startswith((b"HTTP/1.1 101", b"HTTP/1.0 101")):
                return
            self.close_connection = True
            upgraded = True
            self._tunnel(upstream)
        except Exception:  # noqa: BLE001
            if not upgraded:
                try:
                    self.send_error(502, "Vidu WebSocket upstream unavailable")
                except Exception:  # noqa: BLE001
                    pass
        finally:
            if upstream is not None and not upgraded:
                upstream.close()

    def _http_headers(self, target: urllib.parse.SplitResult, query: str) -> dict[str, str]:
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in HOP_BY_HOP_HEADERS | {"host", "content-length"}
        }
        headers["Host"] = target.netloc
        query_auth = urllib.parse.parse_qs(query).get("authorization", [""])[0]
        auth = self._normalize_auth(headers.get("Authorization"), query_auth)
        if auth:
            headers["Authorization"] = auth
        return headers

    def _websocket_handshake(self, target: urllib.parse.SplitResult, uri: str, auth: str) -> bytes:
        lines = [f"GET {uri} HTTP/1.1", f"Host: {target.netloc}", "Upgrade: websocket", "Connection: Upgrade"]
        for key in (
            "Sec-WebSocket-Key",
            "Sec-WebSocket-Version",
            "Sec-WebSocket-Protocol",
            "Sec-WebSocket-Extensions",
            "Origin",
            "User-Agent",
        ):
            if value := self.headers.get(key):
                lines.append(f"{key}: {value}")
        if auth:
            lines.append(f"Authorization: {auth}")
        return "\r\n".join([*lines, "", ""]).encode()

    @staticmethod
    def _normalize_auth(header_value: str | None, query_value: str | None) -> str:
        value = (header_value or "").strip() or (query_value or "").strip()
        if not value or value.startswith(("Bearer ", "Token ")):
            return value
        return f"Token {value}" if value.startswith("vda_") else value

    @staticmethod
    def _query_without_auth(query: str, auth: str | None) -> str:
        if not auth:
            return query
        pairs = urllib.parse.parse_qsl(query, keep_blank_values=True)
        return urllib.parse.urlencode([(key, value) for key, value in pairs if key.lower() != "authorization"])

    @staticmethod
    def _join_query(path: str, query: str) -> str:
        return path if not query else f"{path}?{query}"

    @staticmethod
    def _default_port(target: urllib.parse.SplitResult) -> int:
        return 443 if target.scheme == "https" else 80

    def _dial(self, target: urllib.parse.SplitResult) -> socket.socket:
        raw = socket.create_connection((target.hostname, target.port or self._default_port(target)), timeout=30)
        if target.scheme != "https":
            return raw
        return ssl.create_default_context().wrap_socket(raw, server_hostname=target.hostname)

    @staticmethod
    def _read_websocket_handshake(upstream: socket.socket) -> bytes:
        response = bytearray()
        while b"\r\n\r\n" not in response:
            chunk = upstream.recv(4096)
            if not chunk:
                break
            response.extend(chunk)
            if len(response) > 64 * 1024:
                break
        return bytes(response)

    def _tunnel(self, upstream: socket.socket) -> None:
        sockets = [self.connection, upstream]
        try:
            while True:
                readable, _, _ = select.select(sockets, [], [], 60)
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    (upstream if source is self.connection else self.connection).sendall(data)
        finally:
            upstream.close()


def parse_address(value: str) -> tuple[str, int]:
    host, separator, raw_port = value.rpartition(":")
    if not separator:
        return value, 18088
    return host or "127.0.0.1", int(raw_port)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="OpenTalking Vidu Live proxy")
    parser.add_argument("--addr", default="127.0.0.1:18088")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)
    host, port = parse_address(args.addr)
    ViduProxyHandler.verbose = args.verbose
    server = ThreadingHTTPServer((host, port), ViduProxyHandler)
    print(f"OpenTalking Vidu proxy: http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
