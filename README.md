<div align="center">

# 📡 EchoNet-X
### **Edge-AI Acoustic & Multimodal Threat Telemetry Network**

[![PlatformIO](https://img.shields.io/badge/PlatformIO-Compatible-orange?logo=platformio&style=for-the-badge)](https://platformio.org/)
[![ESP32-S3](https://img.shields.io/badge/Target-ESP32--S3%20%7C%20ESP32-red?logo=espressif&style=for-the-badge)](https://espressif.com/)
[![LoRa 868MHz](https://img.shields.io/badge/Telemetry-LoRa%20868MHz-blue?logo=semtech&style=for-the-badge)](https://semtech.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

*An autonomous tactical edge sensor node engineered for real-time acoustic shock classification, multimodal threat vector fusion, and resilient long-range LoRa incident beaconing across remote and network-denied environments.*

[Architecture](#-system-architecture) • [Fusion Algorithm](#-multimodal-sensor-fusion-engine) • [Hardware Specification](#-hardware-stack--pinout) • [Dashboard](#-tactical-web-dashboard) • [Quickstart](#-quickstart--installation)

</div>

---

## 🎯 Executive Overview

**EchoNet-X** is a decentralized, edge-computed tactical intelligence node designed to operate where cellular and traditional infrastructure fail. Built around the **ESP32-S3** dual-core MCU, the node ingests high-frequency digital audio over **I2S DMA**, runs continuous Root-Mean-Square (**RMS**) energy calculations for gunshot and distress anomaly detection, corroborates acoustic triggers with edge vision vectors, and broadcasts mission-critical telemetry over **Semtech SX1276 LoRa (868 MHz)** alongside geospatial **GPS coordinates**.

Accompanying the embedded node is the **EchoNet-X Tactical Web Dashboard**, a dual-stack IPv4/IPv6 real-time monitoring suite featuring interactive Leaflet geospatial positioning, dynamic acoustic waveforms, serial telemetry bridging, and latched threat visualization.

---

## 📐 System Architecture

```
 ┌─────────────────────────┐     ┌─────────────────────────┐
 │   INMP441 MEMS Mic      │     │  Edge Vision Pipeline   │
 │   (I2S DMA @ 16 kHz)    │     │  (Activity Classifier)  │
 └───────────┬─────────────┘     └───────────┬─────────────┘
             │ 24-bit Audio                  │ Vector Confidence
             ▼                               ▼
 ┌─────────────────────────────────────────────────────────┐
 │                ESP32-S3 Firmware Core                   │
 │                                                         │
 │  • Audio Engine: 1024-Sample DMA Circular Buffer        │
 │  • Energy Calculation: Digital RMS & Adaptive Thresholds│
 │  • Multimodal Fusion Engine: 3-Tier State Machine       │
 │  • Emergency Latch: Edge escalation (GREEN/AMBER/RED)   │
 └───────────┬───────────────────────────────┬─────────────┘
             │ NMEA Sentences                │ Event Telemetry (JSON)
 ┌───────────┴─────────────┐     ┌───────────┴─────────────┐
 │    Neo-6M GPS Module    │     │   Semtech SX1276 LoRa   │
 │  (UART2 + 2KB Ring Buf) │     │ (868 MHz Long-Range TX) │
 └─────────────────────────┘     └───────────┬─────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │ EchoNet-X Base Station    │
                               │ & Real-Time Web Dashboard │
                               └───────────────────────────┘
```

---

## 🧠 Multimodal Sensor Fusion Engine

The node runs an event-driven sensor fusion state machine evaluating environmental threats every loop cycle without blocking audio sampling.

### 1. Mathematical Formulation

$$Score_{\text{threat}} = \left( 0.60 \cdot Score_{\text{vision}} \right) + \left( 0.40 \cdot Score_{\text{audio}} \right) + \text{Bonus}_{\text{corroboration}}$$

Where:
* **$Score_{\text{audio}}$**: Computed from digital RMS energy over 1024-sample windows:
  $$\text{RMS} = \sqrt{\frac{1}{N} \sum_{i=1}^{N} \left(\frac{x[i]}{2^{14}}\right)^2}$$
  * $\text{RMS} > 8000 \implies Score_{\text{audio}} = 0.95$ (Acoustic Shock / Gunshot)
  * $\text{RMS} > 4000 \implies Score_{\text{audio}} = 0.85$ (High Disturbance)
  * $\text{RMS} \le 4000 \implies Score_{\text{audio}} = 0.08$ (Ambient Baseline)
* **$\text{Bonus}_{\text{corroboration}}$**: $+0.15$ added when both vision confidence $\ge 0.60$ and audio confidence $\ge 0.85$.

### 2. Threat Tiers & Latched Emergency Escalation
* **GREEN ($Score < 0.45$):** Normal surveillance baseline. Periodic heartbeat transmitted every 8 seconds.
* **AMBER ($0.45 \le Score < 0.75$):** Elevated disturbance. GPS tracking intervals increased to 2 seconds.
* **RED ($Score \ge 0.75$):** Confirmed critical threat. The node triggers a **software latched interrupt (`redEdge`)**, immediately pre-empting the scheduler to broadcast high-priority LoRa distress packets with exact latitude, longitude, and activity tags.

---

## 🛠️ Hardware Stack & Pinout

| Peripheral | Component | Protocol / Bus | ESP32-S3 GPIO | Function |
| :--- | :--- | :--- | :--- | :--- |
| **Acoustic Sensor** | INMP441 MEMS | I2S0 (Master RX) | `GPIO 40` (SCK), `GPIO 42` (WS), `GPIO 41` (SD) | 24-bit 16 kHz Digital PCM |
| **Geospatial Tracking** | u-blox Neo-6M | UART2 | `GPIO 16` (RX), `GPIO 17` (TX) | 9600 Baud NMEA Telemetry |
| **Long-Range RF** | Semtech SX1276 | SPI | `GPIO 5` (NSS), `GPIO 2` (DIO0), `GPIO 14` (RST) | 868 MHz LoRa Transceiver |
| **Host Processing** | ESP32-S3-WROOM-1 | FreeRTOS / C++ | Standard System Buses | Dual Xtensa LX7 @ 240 MHz |

> *For complete wiring schematics, classic ESP32 fallback pin mappings, and antenna decoupling guidelines, see [PINOUT_AND_WIRING.md](PINOUT_AND_WIRING.md).*

---

## 📊 Tactical Web Dashboard

The repository includes a standalone mission dashboard (`dashboard/`) with zero cloud dependencies:
* **Leaflet GPS Mapping:** Real-time marker tracking with coordinate history and satellite count.
* **Acoustic Visualizer:** Dynamic canvas RMS stream displaying live decibel/energy levels.
* **Multi-Node Incident Log:** Timestamped event feed with threat level badges (`LEVEL: GREEN`, `LEVEL: AMBER`, `LEVEL: RED`).
* **Hardware Serial Bridge:** Python server (`server.py`) auto-detecting USB CP210x/CH340 devices and serving real-time telemetry over WebSockets/HTTP dual-stack localhost (`http://localhost:8080`).

---

## 📁 Repository Structure

```
EchoNet-X/
├── .gitignore                   # PlatformIO, build, and Python artifacts
├── LICENSE                      # MIT Open-Source License
├── README.md                    # Primary technical documentation
├── PINOUT_AND_WIRING.md         # Detailed hardware pin mapping & electrical guidelines
│
├── firmware/                    # Embedded C++ Firmware
│   ├── platformio.ini           # Multi-target configuration (ESP32-S3 & ESP32 Dev)
│   ├── build_and_upload.py      # Automated flash & serial script
│   └── src/
│       └── main.cpp             # Modular firmware (Audio, GPS, Fusion, LoRa, JSON)
│
└── dashboard/                   # Tactical Real-Time Web Interface
    ├── index.html               # Mission control UI
    ├── style.css                # Dark military-grade tactical styling
    ├── app.js                   # Telemetry decoder & Leaflet GPS engine
    ├── server.py                # Dual-stack Python web & serial bridge server
    ├── serial_bridge.py         # Standalone serial parser utility
    ├── check_devices.py         # Hardware COM port diagnostic tool
    └── LAUNCH_DASHBOARD.bat     # Windows one-click launcher
```

---

## 🚀 Quickstart & Installation

### 1. Firmware Flash (PlatformIO)
1. Install [PlatformIO Core](https://platformio.org/) or the PlatformIO VS Code extension.
2. Connect your ESP32-S3 board via USB.
3. Build and flash the firmware:
   ```bash
   cd firmware
   pio run --target upload
   ```
4. Open the serial monitor at 115200 baud to observe the initialization sequence:
   ```bash
   pio device monitor
   ```

### 2. Launching the Tactical Dashboard
1. Install Python prerequisites:
   ```bash
   pip install pyserial
   ```
2. Run the dual-stack server:
   ```bash
   cd dashboard
   python server.py
   ```
   *On Windows, you can simply double-click `LAUNCH_DASHBOARD.bat`.*
3. Open your browser at `http://localhost:8080`.

---

## 👥 Team & Project Credits

This project was engineered collaboratively as a team effort:

* **Girish M** — **Project Lead & System Architect**
  * Overall system ideation, hardware prototyping, and project coordination.
  * **GitHub:** [@girishm3007](https://github.com/girishm3007)

* **Mrityun Jay G** — **Firmware & Embedded Systems Contributor**
  * Engineered the 24-bit I2S DMA continuous audio acquisition pipeline at 16 kHz using the INMP441 digital MEMS microphone.
  * Designed the multimodal threat fusion state engine (synthesizing acoustic energy thresholds with vision confidence vectors).
  * Implemented long-range wireless telemetry over Semtech SX1276 LoRa (868 MHz) with latched emergency priority broadcasting.
  * **GitHub:** [@Mrityun-jay18](https://github.com/Mrityun-jay18) | **Portfolio:** [mrityunjaygportfolio.lovable.app](https://mrityunjaygportfolio.lovable.app/)

---

## 📜 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
