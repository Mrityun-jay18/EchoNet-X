#!/usr/bin/env python3
"""
EchoNet X Dashboard & ESP32 Hardware Serial Server
Hosts the web interface on Dual-Stack (IPv4 & IPv6 localhost) at http://localhost:8080
and http://127.0.0.1:8080 with direct pyserial hardware support.
"""

import http.server
import socketserver
import socket
import os
import sys
import json
import time
import threading
import serial
import serial.tools.list_ports
import webbrowser

PORTS_TO_TRY = [8080, 8081, 3000, 5000]
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# Global serial state
active_serial = None
serial_lines_buffer = []
serial_lock = threading.Lock()
connected_port_name = None

def list_ports():
    ports = serial.tools.list_ports.comports()
    return [{"device": p.device, "description": p.description, "hwid": p.hwid} for p in ports]

def find_esp32_port():
    ports = serial.tools.list_ports.comports()
    for p in ports:
        desc = p.description.lower()
        hwid = p.hwid.lower()
        if any(chip in desc or chip in hwid for chip in ['cp210', 'ch340', 'ch341', 'ftdi', 'esp32', 'usb serial', 'uart', 'silicon labs']):
            return p.device
    return None

def serial_reader_thread(port_name, baud=115200):
    global active_serial, connected_port_name, serial_lines_buffer
    try:
        active_serial = serial.Serial(port_name, baud, timeout=1)
        connected_port_name = port_name
        print(f"[+] Physical ESP32 hardware connected on {port_name} @ {baud} baud!")
        
        while active_serial and active_serial.is_open:
            if active_serial.in_waiting > 0:
                line = active_serial.readline().decode('utf-8', errors='replace').strip()
                if line:
                    with serial_lock:
                        serial_lines_buffer.append(line)
                        if len(serial_lines_buffer) > 100:
                            serial_lines_buffer.pop(0)
            time.sleep(0.01)
    except Exception as e:
        print(f"[-] Serial error on {port_name}: {e}")
    finally:
        connected_port_name = None
        if active_serial:
            try: active_serial.close()
            except: pass
            active_serial = None

class EchoNetHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path == '/api/ports':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            ports_info = {
                "ports": list_ports(),
                "connected_port": connected_port_name,
                "auto_detected": find_esp32_port()
            }
            self.wfile.write(json.dumps(ports_info).encode())
            return
            
        elif self.path == '/api/serial/stream':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            with serial_lock:
                lines = list(serial_lines_buffer)
                serial_lines_buffer.clear()
            self.wfile.write(json.dumps({"lines": lines, "port": connected_port_name}).encode())
            return

        super().do_GET()

    def do_POST(self):
        global active_serial
        if self.path == '/api/serial/connect':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode() if content_length > 0 else '{}'
            data = json.loads(body) if body else {}
            port = data.get('port') or find_esp32_port()
            
            if active_serial:
                try: active_serial.close()
                except: pass
                active_serial = None

            if port:
                t = threading.Thread(target=serial_reader_thread, args=(port, 115200), daemon=True)
                t.start()
                resp = {"status": "connecting", "port": port}
            else:
                resp = {"status": "error", "message": "No port specified or auto-detected"}
                
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(resp).encode())
            return

        elif self.path == '/api/serial/disconnect':
            if active_serial:
                try: active_serial.close()
                except: pass
                active_serial = None
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "disconnected"}).encode())
            return

        super().do_POST()

class DualStackServer(socketserver.TCPServer):
    address_family = socket.AF_INET6
    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except Exception:
            pass
        super().server_bind()

def run():
    os.chdir(DIRECTORY)
    socketserver.TCPServer.allow_reuse_address = True
    
    server = None
    chosen_port = 8080
    for p in PORTS_TO_TRY:
        try:
            server = DualStackServer(("", p), EchoNetHandler)
            chosen_port = p
            break
        except Exception:
            try:
                server = socketserver.TCPServer(("0.0.0.0", p), EchoNetHandler)
                chosen_port = p
                break
            except Exception:
                continue

    if not server:
        print("[-] Could not bind to any port.")
        sys.exit(1)

    url_localhost = f"http://localhost:{chosen_port}"
    url_ip = f"http://127.0.0.1:{chosen_port}"
    print("==================================================")
    print(" EchoNet X — Dual-Stack Server Running")
    print(f" Localhost URL: {url_localhost}")
    print(f" Direct IP URL: {url_ip}")
    print("==================================================")

    esp_port = find_esp32_port()
    if esp_port:
        t = threading.Thread(target=serial_reader_thread, args=(esp_port, 115200), daemon=True)
        t.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        sys.exit(0)

if __name__ == "__main__":
    run()
