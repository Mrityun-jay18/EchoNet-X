#!/usr/bin/env python3
"""
EchoNet X Hardware Serial Bridge & Detector
Directly interfaces with physical ESP32 / ESP32-S3 boards via USB Serial (115200 baud).
"""

import sys
import time
import serial
import serial.tools.list_ports

# Force UTF-8 stdout encoding on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BAUD_RATE = 115200

def list_available_ports():
    return serial.tools.list_ports.comports()

def find_esp32_port():
    ports = list_available_ports()
    esp_ports = []
    
    for p in ports:
        desc = p.description.lower()
        hwid = p.hwid.lower()
        if any(chip in desc or chip in hwid for chip in ['cp210', 'ch340', 'ch341', 'ftdi', 'esp32', 'usb serial', 'uart', 'silicon labs']):
            esp_ports.append(p)
            
    if esp_ports:
        return esp_ports[0].device
    return None

def monitor_esp32(target_port=None):
    print("==================================================")
    print("  EchoNet X Hardware Serial Interface Utility")
    print("==================================================")
    
    ports = list_available_ports()
    print("Currently detected serial ports on system:")
    if not ports:
        print("  [No COM ports found]")
    else:
        for p in ports:
            print(f"  -> {p.device}: {p.description} [{p.hwid}]")
    print("--------------------------------------------------")

    port_name = target_port if target_port else find_esp32_port()

    if not port_name:
        print("\n[*] No USB-to-UART ESP32 port automatically matched.")
        print("    Please connect your ESP32 board to a USB port.")
        print("    Waiting for device plug-in...\n")
        
        known_devices = {p.device for p in ports}
        while True:
            time.sleep(1.5)
            current_ports = list_available_ports()
            current_devices = {p.device for p in current_ports}
            new_devices = current_devices - known_devices
            
            if new_devices:
                new_port = list(new_devices)[0]
                print(f"[+] NEW DEVICE DETECTED: {new_port}")
                port_name = new_port
                break
            known_devices = current_devices
            
    print(f"\n[*] Connecting to ESP32 hardware on {port_name} at {BAUD_RATE} Baud...")
    
    try:
        ser = serial.Serial(port_name, BAUD_RATE, timeout=1)
        print(f"[+] SUCCESS: Connected to {port_name}!")
        print("================ ESP32 LIVE SERIAL STREAM ================\n")
        
        while True:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='replace').strip()
                if line:
                    timestamp = time.strftime("%H:%M:%S")
                    print(f"[{timestamp}] {line}")
            time.sleep(0.01)
            
    except serial.SerialException as e:
        print(f"\n[-] ERROR opening port {port_name}: {e}")
        print("    Tip: Check if the port is busy in Arduino IDE Serial Monitor or PuTTY.")
    except KeyboardInterrupt:
        print("\nDisconnected from ESP32.")

if __name__ == "__main__":
    port_arg = sys.argv[1] if len(sys.argv) > 1 else None
    monitor_esp32(port_arg)
