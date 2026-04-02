# VoiceQL — Wiring Guide

## Components
| Component | Purpose |
|-----------|---------|
| Arduino Uno R4 WiFi | WiFi, HTTP client, orchestration |
| EchoKit | Microphone array, Whisper STT, TTS speaker, MP3 playback |
| SSD1306 OLED 128x64 | Displays query transcript + result summary |
| Push button (Sunfounder kit) | Push-to-talk trigger |
| 10kΩ resistor | Pull-down for button |
| LED (optional) | Recording status indicator |

---

## Wiring Diagram

```
Arduino R4 WiFi
┌─────────────────────────────────┐
│                                 │
│  D2  ──────────── [BUTTON] ─── 5V
│                       │
│                    [10kΩ]
│                       │
│  GND ─────────────────┘
│
│  D13 ──────────── [LED+] ─── [220Ω] ─── GND
│
│  A4 (SDA) ─────── OLED SDA
│  A5 (SCL) ─────── OLED SCL
│  3.3V ──────────── OLED VCC
│  GND ──────────── OLED GND
│
│  [EchoKit connects via its own header/UART]
│  Follow EchoKit official pinout documentation
│  for your specific EchoKit board version
│
└─────────────────────────────────┘
```

---

## OLED I2C Address
Most SSD1306 OLEDs use address `0x3C`. If your display does not initialize, try `0x3D` in the sketch.

## Button Wiring Detail
```
5V ──── [BUTTON] ──── D2
                         │
                      [10kΩ]
                         │
                        GND
```
When button is pressed: D2 reads HIGH.
When button is released: D2 reads LOW (pulled down by resistor).

## Power
Power the Arduino via USB from your laptop (same machine running FastAPI).
EchoKit is powered from Arduino's 5V/3.3V pin — check EchoKit docs for your board.

---

## Libraries to Install (Arduino IDE → Tools → Manage Libraries)
1. `ArduinoHttpClient` by Arduino
2. `Adafruit SSD1306` by Adafruit
3. `Adafruit GFX Library` by Adafruit
4. EchoKit SDK — download from EchoKit official documentation and install as .zip
