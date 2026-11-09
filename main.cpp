#include <Arduino.h>
#include <math.h>
#include <driver/i2s.h>      // legacy I2S driver (deprecated warning on core 3.x is OK)
#include <TinyGPS++.h>
#include <RadioLib.h>
#include <ArduinoJson.h>     // v7+

// ============================================================================
//  CONFIGURATION
//  NOTE: pins 40/41/42 exist ONLY on ESP32-S3 (and S2). Select an ESP32-S3
//  board in the Arduino IDE. If you are on a classic ESP32 (WROOM-32), remap
//  the I2S pins to valid GPIOs (see FALLBACK block below) or it will NOT run.
// ============================================================================
#define NODE_ID           "ECHONET-NODE-01"
#define FW_VERSION        "1.0.1-unified"

// --- I2S microphone (INMP441) --- ESP32-S3 pins
#define I2S_SCK_PIN       40
#define I2S_WS_PIN        42
#define I2S_SD_PIN        41
// --- FALLBACK for classic ESP32 (uncomment these three, comment the above):
// #define I2S_SCK_PIN    26
// #define I2S_WS_PIN     25
// #define I2S_SD_PIN     33
#define I2S_PORT          I2S_NUM_0
#define AUDIO_BUFFER_LEN  1024
#define I2S_SAMPLE_RATE   16000

// --- GPS (Neo-6M on UART2) ---
#define GPS_RX_PIN        16
#define GPS_TX_PIN        17
#define GPS_BAUD          9600

// --- LoRa (SX1276) ---
#define LORA_NSS          5
#define LORA_DIO0         2
#define LORA_RST          14
#define LORA_FREQ_MHZ     868.0

// --- Scheduler intervals (ms) ---
#define AUDIO_INTERVAL      500
#define VISION_INTERVAL    1000
#define GPS_REPORT_INTERVAL 2000
#define TELEMETRY_INTERVAL 8000

// --- Fusion thresholds ---
#define AUDIO_RMS_HIGH    8000.0
#define AUDIO_RMS_MID     4000.0
#define LEVEL_RED_AT        0.75
#define LEVEL_AMBER_AT      0.45

// ============================================================================
//  SHARED NODE STATE
// ============================================================================
struct NodeState {
  double  audioRms          = 0.0;
  float   audioScore        = 0.0f;
  float   visionScore       = 0.0f;
  String  visionActivities  = "";
  bool    hasFix            = false;
  double  lat               = 0.0;
  double  lng               = 0.0;
  double  altitude          = 0.0;
  uint32_t satellites       = 0;
  float   threatScore       = 0.0f;
  String  level             = "GREEN";
  String  previousLevel     = "GREEN";
};

NodeState state;

// forward declare so LoRa TX can drain GPS after a blocking transmit
namespace GpsModule { void feed(); }

// ============================================================================
//  MODULE 1 — AUDIO (INMP441 over I2S)
// ============================================================================
namespace AudioModule {

  void begin() {
    i2s_config_t i2s_config = {
      .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
      .sample_rate = I2S_SAMPLE_RATE,
      .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
      .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
      .communication_format = I2S_COMM_FORMAT_STAND_I2S,
      .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
      .dma_buf_count = 4,
      .dma_buf_len = AUDIO_BUFFER_LEN
    };
    i2s_pin_config_t pin_config = {
      .bck_io_num   = I2S_SCK_PIN,
      .ws_io_num    = I2S_WS_PIN,
      .data_out_num = I2S_PIN_NO_CHANGE,
      .data_in_num  = I2S_SD_PIN
    };
    i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
    i2s_set_pin(I2S_PORT, &pin_config);
    Serial.println("[INMP441 Mic] I2S driver installed.");
  }

  void sample() {
    static int32_t buffer[AUDIO_BUFFER_LEN];
    size_t bytes_read = 0;

    esp_err_t err = i2s_read(I2S_PORT, buffer, sizeof(buffer),
                             &bytes_read, pdMS_TO_TICKS(50));
    if (err != ESP_OK || bytes_read == 0) return;

    int samples = bytes_read / sizeof(int32_t);
    double sum = 0.0;
    for (int i = 0; i < samples; i++) {
      // INMP441 gives a 24-bit sample MSB-aligned in a 32-bit frame.
      // >>8 recovers the full 24-bit value; >>14 scales it down so the
      // RMS thresholds above stay in a convenient range. Keep the shift
      // and the AUDIO_RMS_* thresholds in sync if you retune.
      double s = buffer[i] >> 14;
      sum += s * s;
    }

    state.audioRms   = sqrt(sum / samples);
    state.audioScore = (state.audioRms > AUDIO_RMS_HIGH) ? 0.95f
                     : ((state.audioRms > AUDIO_RMS_MID) ? 0.85f : 0.08f);

    Serial.printf("[INMP441 Mic] RMS: %.2f | Audio Confidence Score: %.2f\n",
                  state.audioRms, state.audioScore);
  }

} // namespace AudioModule

// ============================================================================
//  MODULE 2 — GPS (Neo-6M via TinyGPS++)
// ============================================================================
namespace GpsModule {

  HardwareSerial gpsSerial(2);
  TinyGPSPlus    gps;

  void begin() {
    // Larger RX buffer so a blocking LoRa TX cannot overflow the UART and
    // corrupt NMEA sentences while we are busy transmitting.
    gpsSerial.setRxBufferSize(2048);
    gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
    Serial.println("[GPS Block] Neo-6M Module Initialized.");
  }

  void feed() {
    while (gpsSerial.available() > 0) {
      gps.encode(gpsSerial.read());
    }
    if (gps.location.isValid()) {
      state.hasFix     = true;
      state.lat        = gps.location.lat();
      state.lng        = gps.location.lng();
      state.altitude   = gps.altitude.meters();
      state.satellites = gps.satellites.value();
    }
  }

  void report() {
    if (state.hasFix) {
      Serial.printf("[GPS Fix] Satellites: %u | Lat: %.6f | Lng: %.6f | Alt: %.1fm\n",
                    state.satellites, state.lat, state.lng, state.altitude);
    } else {
      Serial.println("[GPS Searching] Waiting for Satellite Lock...");
    }
  }

} // namespace GpsModule

// ============================================================================
//  MODULE 3 — VISION (stub: replace fetchDetections with your detector)
// ============================================================================
namespace VisionModule {

  struct Activity { const char *name; float confidence; };

  static const Activity ACTIVITIES[] = {
    { "Human presence",                   0.05f },
    { "Continuous waving for assistance", 0.60f },
    { "Physical struggle",                0.85f },
    { "Possible assault",                 0.92f }
  };
  static const size_t ACTIVITY_COUNT = sizeof(ACTIVITIES) / sizeof(ACTIVITIES[0]);

  float scoreOf(const char *activity) {
    for (size_t i = 0; i < ACTIVITY_COUNT; i++) {
      if (strcmp(ACTIVITIES[i].name, activity) == 0) return ACTIVITIES[i].confidence;
    }
    return 0.0f;
  }

  // --- STUB: currently always returns high-threat activities, so the node
  //     will sit at RED. Wire in your camera pipeline here. ---
  size_t fetchDetections(const char *out[], size_t maxOut) {
    static const char *detected[] = { "Physical struggle", "Possible assault" };
    size_t n = min(sizeof(detected) / sizeof(detected[0]), maxOut);
    for (size_t i = 0; i < n; i++) out[i] = detected[i];
    return n;
  }

  void begin() {
    Serial.println("[VisionBlock] VisionAnalysisModule ready.");
  }

  void processFrame() {
    const char *detected[8];
    size_t n = fetchDetections(detected, 8);

    float visionScore = 0.0f;
    String names = "";
    for (size_t i = 0; i < n; i++) {
      visionScore = max(visionScore, scoreOf(detected[i]));
      if (i) names += ", ";
      names += detected[i];
    }

    state.visionScore      = visionScore;
    state.visionActivities = names;

    Serial.printf("[VisionBlock] Vision Confidence Score: %.2f | Detected: %s\n",
                  visionScore, names.c_str());
  }

} // namespace VisionModule

// ============================================================================
//  MODULE 4 — SENSOR FUSION ENGINE
//  FIX: the RED transition is now LATCHED in redEdge and cleared only after
//  the uplink is actually sent, so calling evaluate() multiple times per loop
//  can no longer swallow the emergency packet.
// ============================================================================
namespace FusionEngine {

  bool redEdge = false;

  void evaluate() {
    float fused = (0.60f * state.visionScore) + (0.40f * state.audioScore);

    if (state.visionScore >= 0.60f && state.audioScore >= 0.85f) {
      fused += 0.15f;   // corroboration bonus
    }
    if (fused > 1.0f) fused = 1.0f;

    String newLevel = (fused >= LEVEL_RED_AT)   ? "RED"
                    : (fused >= LEVEL_AMBER_AT) ? "AMBER" : "GREEN";

    if (newLevel != state.level) {
      Serial.printf("[Fusion] LEVEL CHANGE %s -> %s (score %.2f)\n",
                    state.level.c_str(), newLevel.c_str(), fused);
      if (newLevel == "RED" && state.level != "RED") {
        redEdge = true;   // latch — cleared only after uplink
      }
    }

    state.previousLevel = state.level;
    state.level         = newLevel;
    state.threatScore   = fused;
  }

  bool escalated()  { return redEdge; }
  void clearEdge()  { redEdge = false; }

} // namespace FusionEngine

// ============================================================================
//  MODULE 5 — LoRa UPLINK (SX1276)
// ============================================================================
namespace LoRaModule {

  SX1276 radio = new Module(LORA_NSS, LORA_DIO0, LORA_RST);
  bool   ready = false;

  void begin() {
    Serial.print("[LoRa Block] Initializing SX1276 868 MHz...");
    int st = radio.begin(LORA_FREQ_MHZ);
    if (st == RADIOLIB_ERR_NONE) {
      ready = true;
      Serial.println(" Success!");
    } else {
      Serial.printf(" FAILED (code %d)\n", st);
    }
  }

  void transmitTelemetry() {
    if (!ready) return;

    JsonDocument doc;                       // ArduinoJson v7
    doc["node_id"]      = NODE_ID;
    doc["fw"]           = FW_VERSION;
    doc["uptime_s"]     = millis() / 1000;
    doc["level"]        = state.level;
    doc["score"]        = roundf(state.threatScore * 100) / 100.0;
    doc["audio_score"]  = state.audioScore;
    doc["audio_rms"]    = roundf(state.audioRms * 10) / 10.0;
    doc["vision_score"] = state.visionScore;
    doc["activities"]   = state.visionActivities;
    doc["gps_fix"]      = state.hasFix;
    doc["lat"]          = state.hasFix ? state.lat : 0.0;
    doc["lng"]          = state.hasFix ? state.lng : 0.0;
    doc["sats"]         = state.satellites;

    String payload;
    serializeJson(doc, payload);

    Serial.println("[LoRa TX] Broadcasting Packet: " + payload);
    int st = radio.transmit(payload);       // blocking a few hundred ms
    if (st != RADIOLIB_ERR_NONE) {
      Serial.printf("[LoRa TX] Transmit failed (code %d)\n", st);
    }

    // Catch up on any NMEA that streamed in while TX was blocking.
    GpsModule::feed();
  }

} // namespace LoRaModule

// ============================================================================
//  SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("==================================================");
  Serial.println("  EchoNet X Edge Node  |  " NODE_ID);
  Serial.println("  A Network That Listens and Responds");
  Serial.println("==================================================");

  AudioModule::begin();
  GpsModule::begin();
  VisionModule::begin();
  LoRaModule::begin();

  Serial.println("[Node] All subsystems online.\n");
}

// ============================================================================
//  LOOP — cooperative scheduler
// ============================================================================
void loop() {
  const unsigned long now = millis();

  static unsigned long tAudio     = 0;
  static unsigned long tVision    = 0;
  static unsigned long tGpsReport = 0;
  static unsigned long tTelemetry = 0;

  // Highest priority: drain the GPS UART every pass.
  GpsModule::feed();

  if (now - tAudio >= AUDIO_INTERVAL) {
    tAudio = now;
    AudioModule::sample();
    FusionEngine::evaluate();
  }

  if (now - tVision >= VISION_INTERVAL) {
    tVision = now;
    VisionModule::processFrame();
    FusionEngine::evaluate();
  }

  if (now - tGpsReport >= GPS_REPORT_INTERVAL) {
    tGpsReport = now;
    GpsModule::report();
  }

  // Heartbeat uplink, plus an immediate uplink the moment we latch RED.
  if (now - tTelemetry >= TELEMETRY_INTERVAL || FusionEngine::escalated()) {
    tTelemetry = now;
    LoRaModule::transmitTelemetry();
    FusionEngine::clearEdge();   // consume the escalation edge here, once sent
  }
}
