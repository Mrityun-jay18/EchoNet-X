#!/usr/bin/env python3
"""
EchoNet X ESP32 Automated Builder & Flasher Script
Compiles and uploads C++ firmware directly without needing Arduino IDE UI.
"""

import sys
import subprocess
import os

FIRMWARE_DIR = os.path.dirname(os.path.abspath(__file__))

def run_pio_command(args):
    cmd = [sys.executable, "-m", "platformio"] + args
    print(f"Running PlatformIO command: {' '.join(cmd)}")
    res = subprocess.run(cmd, cwd=FIRMWARE_DIR)
    return res.returncode

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "build"
    board_env = sys.argv[2] if len(sys.argv) > 2 else "esp32s3dev"

    if mode == "build":
        print(f"[*] Compiling ESP32 firmware for environment [{board_env}]...")
        code = run_pio_command(["run", "-e", board_env])
        if code == 0:
            print("\n[+] SUCCESS: Firmware compilation successful!")
        else:
            print("\n[-] ERROR: Build failed.")
            sys.exit(code)

    elif mode == "upload":
        print(f"[*] Flashing ESP32 board [{board_env}]...")
        code = run_pio_command(["run", "-e", board_env, "-t", "upload"])
        if code == 0:
            print("\n[+] SUCCESS: Firmware flashed successfully to ESP32!")
        else:
            print("\n[-] ERROR: Upload failed. Ensure ESP32 is connected to USB.")
            sys.exit(code)

    elif mode == "monitor":
        print(f"[*] Starting PlatformIO serial monitor @ 115200 baud...")
        run_pio_command(["device", "monitor", "-b", "115200"])

    else:
        print("Usage: python build_and_upload.py [build|upload|monitor] [esp32s3dev|esp32dev]")

if __name__ == "__main__":
    main()
