/*
 * VoiceQL — Arduino R4 WiFi Client
 * Hardware: Arduino Uno R4 WiFi + EchoKit
 *
 * Flow:
 *   1. Wait for button press (EchoKit onboard button or Sunfounder button on D2)
 *   2. Record audio via EchoKit microphone
 *   3. POST WAV file to FastAPI backend over WiFi
 *   4. Parse response headers for transcript + summary
 *   5. Play MP3 audio response through EchoKit speaker
 *   6. Display summary on OLED (if connected via I2C)
 *
 * Wiring (EchoKit connects via UART/SPI — follow EchoKit docs):
 *   Button    -> D2 (with 10k pull-down to GND)
 *   LED       -> D13 (built-in, status indicator)
 *   OLED SDA  -> A4
 *   OLED SCL  -> A5
 *
 * Libraries needed (install via Arduino Library Manager):
 *   - WiFiS3          (built-in for R4 WiFi)
 *   - ArduinoHttpClient
 *   - Adafruit_SSD1306
 *   - Adafruit_GFX
 *   - EchoKit SDK     (install from EchoKit documentation)
 */

#include <WiFiS3.h>
#include <ArduinoHttpClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "EchoKit.h"  // EchoKit SDK header

// ── WiFi credentials ────────────────────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// ── Backend server ────────────────────────────────────────────────────────────
// Replace with your laptop/server IP where FastAPI is running
// Find it with: ipconfig (Windows) or ifconfig (Mac/Linux)
const char* SERVER_HOST = "192.168.1.100";
const int   SERVER_PORT = 8000;
const char* ENDPOINT    = "/query/voice";

// ── Pin definitions ───────────────────────────────────────────────────────────
const int BTN_PIN = 2;   // Push-to-talk button
const int LED_PIN = 13;  // Status LED (built-in)

// ── OLED display ──────────────────────────────────────────────────────────────
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT  64
#define OLED_RESET     -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ── State machine ─────────────────────────────────────────────────────────────
enum State { IDLE, RECORDING, SENDING, PLAYING, ERROR_STATE };
State currentState = IDLE;

// ── Audio buffer ──────────────────────────────────────────────────────────────
// EchoKit stores audio in its own buffer; we read it out after recording
uint8_t  audioBuffer[64000];  // ~4 seconds at 16kHz mono 16-bit
uint32_t audioLength = 0;

// ── WiFi + HTTP clients ───────────────────────────────────────────────────────
WiFiClient wifiClient;
HttpClient  httpClient(wifiClient, SERVER_HOST, SERVER_PORT);

// ─────────────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  pinMode(BTN_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);

  // OLED init
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("[OLED] Not found — continuing without display");
  } else {
    oledMessage("VoiceQL", "Connecting...");
  }

  // EchoKit init
  EchoKit.begin();
  EchoKit.setSampleRate(16000);
  EchoKit.setChannels(1);
  EchoKit.setBitDepth(16);
  Serial.println("[EchoKit] Ready");

  // WiFi connect
  connectWiFi();

  oledMessage("VoiceQL", "Ready. Press button.");
  Serial.println("[System] VoiceQL ready.");
}

void loop() {
  switch (currentState) {

    case IDLE:
      if (digitalRead(BTN_PIN) == HIGH) {
        delay(50);  // debounce
        startRecording();
      }
      break;

    case RECORDING:
      // Hold button to record, release to stop
      if (digitalRead(BTN_PIN) == LOW) {
        stopRecording();
      }
      break;

    case SENDING:
      sendAudio();
      break;

    case PLAYING:
      // EchoKit handles MP3 playback asynchronously
      if (!EchoKit.isPlaying()) {
        currentState = IDLE;
        oledMessage("VoiceQL", "Ready. Press button.");
        digitalWrite(LED_PIN, LOW);
      }
      break;

    case ERROR_STATE:
      delay(2000);
      currentState = IDLE;
      oledMessage("VoiceQL", "Ready. Press button.");
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

void startRecording() {
  Serial.println("[REC] Starting...");
  currentState = RECORDING;
  digitalWrite(LED_PIN, HIGH);
  oledMessage("VoiceQL", "Listening...");
  EchoKit.startRecording();
}

void stopRecording() {
  EchoKit.stopRecording();
  audioLength = EchoKit.getAudioData(audioBuffer, sizeof(audioBuffer));
  Serial.printf("[REC] Captured %u bytes\n", audioLength);

  if (audioLength < 1000) {
    Serial.println("[REC] Too short — ignoring");
    currentState = IDLE;
    oledMessage("VoiceQL", "Too short. Try again.");
    digitalWrite(LED_PIN, LOW);
    return;
  }

  currentState = SENDING;
  oledMessage("VoiceQL", "Processing...");
}

void sendAudio() {
  Serial.printf("[HTTP] Posting %u bytes to %s%s\n", audioLength, SERVER_HOST, ENDPOINT);

  // Build multipart/form-data body manually
  String boundary = "VoiceQLBoundary";
  String partHeader =
    "--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"audio\"; filename=\"query.wav\"\r\n"
    "Content-Type: audio/wav\r\n\r\n";
  String partFooter = "\r\n--" + boundary + "--\r\n";

  uint32_t contentLength = partHeader.length() + audioLength + partFooter.length();

  httpClient.beginRequest();
  httpClient.post(ENDPOINT);
  httpClient.sendHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
  httpClient.sendHeader("Content-Length", contentLength);
  httpClient.beginBody();
  httpClient.print(partHeader);
  httpClient.write(audioBuffer, audioLength);
  httpClient.print(partFooter);
  httpClient.endRequest();

  int statusCode = httpClient.responseStatusCode();
  Serial.printf("[HTTP] Status: %d\n", statusCode);

  if (statusCode != 200) {
    Serial.printf("[HTTP] Error: %d\n", statusCode);
    oledMessage("Error", "Server error " + String(statusCode));
    currentState = ERROR_STATE;
    return;
  }

  // Read headers for display content
  String summary   = httpClient.header("X-Summary");
  String transcript = httpClient.header("X-Transcript");
  String rowCount  = httpClient.header("X-Row-Count");
  String latency   = httpClient.header("X-Latency-Ms");

  Serial.printf("[RESULT] %s | rows=%s | %sms\n",
    summary.c_str(), rowCount.c_str(), latency.c_str());

  // Show on OLED
  oledResult(transcript, summary, rowCount, latency);

  // Stream MP3 response body to EchoKit
  int bodyLen = httpClient.contentLength();
  if (bodyLen > 0) {
    uint8_t mp3Buf[8192];
    EchoKit.beginPlayback();
    int received = 0;
    while (received < bodyLen) {
      int chunk = httpClient.readBytes(mp3Buf,
        min((int)sizeof(mp3Buf), bodyLen - received));
      if (chunk <= 0) break;
      EchoKit.writePlayback(mp3Buf, chunk);
      received += chunk;
    }
    EchoKit.endPlayback();
    currentState = PLAYING;
  } else {
    currentState = IDLE;
    oledMessage("Done", summary);
    digitalWrite(LED_PIN, LOW);
  }
}

void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] FAILED. Check credentials.");
    oledMessage("WiFi Error", "Check credentials");
    while (true) delay(1000);
  }
}

void oledMessage(String title, String body) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(title);
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  display.setCursor(0, 14);
  display.setTextSize(1);
  display.println(body);
  display.display();
}

void oledResult(String transcript, String summary, String rows, String ms) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Q: " + transcript.substring(0, 20));
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  display.setCursor(0, 14);
  display.println(summary.substring(0, 60));
  display.setCursor(0, 54);
  display.setTextSize(1);
  display.printf("rows:%s  %sms", rows.c_str(), ms.c_str());
  display.display();
}
