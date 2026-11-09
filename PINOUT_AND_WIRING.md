# EchoNet-X Hardware Pinout & Wiring Specification

This document details the complete hardware pin configuration, signal bus assignments, and power distribution for the **EchoNet-X Edge-AI Multimodal Threat Telemetry Node**.

---

## 1. System Pinout Mapping

The firmware includes out-of-the-box pin configurations for both **ESP32-S3 (Primary)** and **ESP32 Classic / WROOM-32 (Fallback)**.

### A. ESP32-S3 (Default Hardware Target)

| Peripheral / Module | Pin Function | ESP32-S3 GPIO | Bus / Protocol | Notes & Voltage Levels |
| :--- | :--- | :--- | :--- | :--- |
| **INMP441 MEMS Mic** | SCK (BCLK) | **GPIO 40** | I2S0 Master Clock | 3.3V Logic, High-Speed DMA |
| **INMP441 MEMS Mic** | WS (LRCLK) | **GPIO 42** | I2S0 Word Select | Left Channel (L/R tied to GND) |
| **INMP441 MEMS Mic** | SD (DOUT) | **GPIO 41** | I2S0 Serial Data | 24-bit PCM Samples |
| **INMP441 MEMS Mic** | VDD / GND | **3V3 / GND** | Power | Clean Decoupled 3.3V Rail |
| **Neo-6M GPS Module** | TX (Module Out) | **GPIO 16** (RX2) | Hardware UART2 | 9600 Baud, 2048-Byte Ring Buffer |
| **Neo-6M GPS Module** | RX (Module In) | **GPIO 17** (TX2) | Hardware UART2 | 9600 Baud (NMEA parsing) |
| **Neo-6M GPS Module** | VCC / GND | **5V / GND** | Power | On-board 3.3V LDO on GPS module |
| **Semtech SX1276 LoRa** | NSS (CS) | **GPIO 5** | SPI Chip Select | 3.3V SPI Bus |
| **Semtech SX1276 LoRa** | MOSI | **GPIO 23** | SPI MOSI | Master Out Slave In |
| **Semtech SX1276 LoRa** | MISO | **GPIO 19** | SPI MISO | Master In Slave Out |
| **Semtech SX1276 LoRa** | SCK | **GPIO 18** | SPI Clock | Up to 10 MHz SPI Clock |
| **Semtech SX1276 LoRa** | DIO0 | **GPIO 2** | Interrupt (Tx/Rx Done) | Critical for RadioLib events |
| **Semtech SX1276 LoRa** | RESET | **GPIO 14** | Hardware Reset | Active Low |
| **Semtech SX1276 LoRa** | 3.3V / GND | **3V3 / GND** | Power Rail | **DO NOT connect to 5V!** |

---

### B. ESP32 Classic (WROOM-32 Fallback Target)

If compiling for classic ESP32, uncomment the fallback pin definition block in `firmware/src/main.cpp`:

```cpp
// --- FALLBACK for classic ESP32 WROOM-32:
#define I2S_SCK_PIN       26
#define I2S_WS_PIN        25
#define I2S_SD_PIN        33
#define GPS_RX_PIN        16
#define GPS_TX_PIN        17
#define LORA_NSS          5
#define LORA_DIO0         2
#define LORA_RST          14
```

---

## 2. Power Distribution & Signal Integrity

1. **Power Supply Requirements:**
   - Supply stable **5V DC (min 2A)** via USB-C or external regulator.
   - The SX1276 LoRa radio draws up to **120 mA** during transmission bursts at +20 dBm (PA_BOOST).
   - Place a **100 µF electrolytic capacitor + 0.1 µF ceramic capacitor** across the 3.3V rail close to the SX1276 module to eliminate brownout resets.

2. **I2S Microphone Grounding:**
   - INMP441 `L/R` pin **MUST be tied to GND** for Left-channel operation.
   - Keep I2S signal traces (`SCK`, `WS`, `SD`) short (< 10 cm) to minimize RF interference from the 868 MHz LoRa antenna.

3. **RF Antenna Connection:**
   - **Never power the SX1276 module without an 868 MHz tuned antenna attached!** Transmitting into an open circuit will permanently damage the RF power amplifier.
